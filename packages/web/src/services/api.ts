/**
 * Endereco da API.
 *
 * O padrao e o caminho relativo "/api": no servidor de desenvolvimento o
 * proxy do Vite o encaminha para a porta 3333, e em producao o proprio
 * backend serve o painel e responde nesse prefixo. VITE_API_URL so e
 * necessaria quando o painel fica num dominio diferente do backend.
 */
import { refreshSocketAuthentication } from './socket.js';

/**
 * Exportada para teste. A armadilha e a string VAZIA: `VITE_API_URL=` no
 * .env nao e `undefined`, entao `?? '/api'` nao valia e a base ficava vazia.
 * Toda chamada saia sem o prefixo - no 3333 funcionava por acaso (a API
 * responde na raiz tambem), e no 5173 nada respondia nesse caminho: a tela
 * de login mostrava "Not Found" em vez de entrar.
 */
export function resolverBaseDaApi(configurado: string | undefined): string {
  const limpo = configurado?.trim().replace(/\/+$/, '');
  return limpo ? limpo : '/api';
}

export const API_BASE = resolverBaseDaApi(import.meta.env.VITE_API_URL);

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

const COOKIE_TRANSPORT_HEADER = 'X-Refresh-Token-Transport';
const AUTH_ENDPOINTS_WITHOUT_REFRESH = new Set([
  '/auth/login',
  '/auth/google',
  '/auth/refresh',
  '/auth/logout',
]);

export class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string> | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
    if (token) {
      localStorage.setItem('crm_access_token', token);
    } else {
      localStorage.removeItem('crm_access_token');
    }
  }

  getToken(): string | null {
    if (!this.accessToken) {
      this.accessToken = localStorage.getItem('crm_access_token');
    }
    return this.accessToken;
  }

  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return this.requestInternal<T>(endpoint, options, true);
  }

  private async requestInternal<T>(
    endpoint: string,
    options: RequestOptions,
    mayRefresh: boolean,
  ): Promise<T> {
    const { params, headers = {}, ...rest } = options;

    let url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    if (params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          search.append(key, String(value));
        }
      }
      const qs = search.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    const token = this.getToken();
    const defaultHeaders: Record<string, string> = {
      ...(options.body !== undefined && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(usesCookieSessionTransport(endpoint)
        ? { [COOKIE_TRANSPORT_HEADER]: 'cookie' }
        : {}),
    };
    const requestHeaders = new Headers(defaultHeaders);
    new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));

    const res = await fetch(url, {
      ...rest,
      // Necessario tanto para armazenar o Set-Cookie do login quanto para
      // enviar o refresh token quando painel e API estao em origens distintas.
      credentials: rest.credentials ?? 'include',
      headers: requestHeaders,
    });

    if (res.status === 401 && mayRefresh && canAttemptRefresh(endpoint)) {
      await this.refreshAccessToken();
      // Uma segunda resposta 401 e devolvida ao chamador. Isso impede um loop
      // de rotacoes caso a nova sessao nao autorize o recurso solicitado.
      return this.requestInternal<T>(endpoint, options, false);
    }

    if (!res.ok) {
      throw await errorFromResponse(res, 'Erro inesperado');
    }

    if (res.status === 204) return {} as T;
    return res.json();
  }

  private refreshAccessToken(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
            headers: { [COOKIE_TRANSPORT_HEADER]: 'cookie' },
          });

          if (!refreshRes.ok) {
            const error = await errorFromResponse(refreshRes, 'Nao foi possivel renovar a sessao');
            if (refreshRes.status === 401 || refreshRes.status === 403) {
              this.expireSession();
            }
            throw error;
          }

          const data = (await refreshRes.json()) as { accessToken?: unknown };
          if (typeof data.accessToken !== 'string' || !data.accessToken) {
            throw new Error('Resposta invalida ao renovar a sessao');
          }

          this.setToken(data.accessToken);
          refreshSocketAuthentication(data.accessToken);
          return data.accessToken;
        } finally {
          // A mesma Promise e compartilhada por todas as respostas 401. Ela e
          // sempre liberada, inclusive na falha, para nao deixar chamadas
          // concorrentes penduradas nem bloquear uma tentativa futura.
          this.refreshPromise = null;
        }
      })();
    }

    return this.refreshPromise;
  }

  private expireSession() {
    this.setToken(null);
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  get<T = any>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T = any>(endpoint: string, body?: any, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  }

  put<T = any>(endpoint: string, body?: any, options?: RequestOptions) {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  }

  delete<T = any>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiClient();

function endpointPath(endpoint: string): string {
  try {
    return new URL(endpoint, 'http://crm.local').pathname.replace(/^\/api(?=\/)/, '');
  } catch {
    return endpoint.split(/[?#]/, 1)[0] ?? endpoint;
  }
}

function usesCookieSessionTransport(endpoint: string): boolean {
  const path = endpointPath(endpoint);
  return path === '/auth/login' || path === '/auth/google' || path === '/auth/refresh';
}

function canAttemptRefresh(endpoint: string): boolean {
  return !AUTH_ENDPOINTS_WITHOUT_REFRESH.has(endpointPath(endpoint));
}

async function errorFromResponse(response: Response, fallback: string): Promise<Error> {
  try {
    const data = (await response.json()) as { error?: { message?: unknown } };
    if (typeof data.error?.message === 'string' && data.error.message) {
      return new Error(data.error.message);
    }
  } catch {
    // Respostas vazias ou nao JSON usam a mensagem HTTP abaixo.
  }

  return new Error(response.statusText || fallback);
}
