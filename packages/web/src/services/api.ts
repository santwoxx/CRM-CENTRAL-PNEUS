export const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

class ApiClient {
  private accessToken: string | null = null;
  private isRefreshing = false;
  private refreshSubscribers: ((token: string) => void)[] = [];

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

  private onTokenRefreshed(token: string) {
    this.refreshSubscribers.forEach((callback) => callback(token));
    this.refreshSubscribers = [];
  }

  private addRefreshSubscriber(callback: (token: string) => void) {
    this.refreshSubscribers.push(callback);
  }

  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
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
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(url, {
      ...rest,
      headers: {
        ...defaultHeaders,
        ...(headers as Record<string, string>),
      },
    });

    if (res.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
      if (!this.isRefreshing) {
        this.isRefreshing = true;
        try {
          const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          if (refreshRes.ok) {
            const data = await refreshRes.json();
            this.setToken(data.accessToken);
            this.onTokenRefreshed(data.accessToken);
            this.isRefreshing = false;

            return this.request<T>(endpoint, options);
          } else {
            this.setToken(null);
            this.isRefreshing = false;
            window.location.href = '/login';
            throw new Error('Sessao expirada');
          }
        } catch (err) {
          this.isRefreshing = false;
          this.setToken(null);
          window.location.href = '/login';
          throw err;
        }
      } else {
        return new Promise<T>((resolve) => {
          this.addRefreshSubscriber(() => {
            resolve(this.request<T>(endpoint, options));
          });
        });
      }
    }

    if (!res.ok) {
      let errorData;
      try {
        errorData = await res.json();
      } catch {
        errorData = { error: { message: res.statusText || 'Erro na requisicao' } };
      }
      throw new Error(errorData?.error?.message || 'Erro inesperado');
    }

    if (res.status === 204) return {} as T;
    return res.json();
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
