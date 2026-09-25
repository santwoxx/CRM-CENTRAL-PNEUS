import { beforeEach, describe, expect, it, vi } from 'vitest';

const socketMocks = vi.hoisted(() => ({
  refreshSocketAuthentication: vi.fn(),
}));

vi.mock('./socket.js', () => socketMocks);

import { ApiClient, resolverBaseDaApi } from './api.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  vi.restoreAllMocks();
  socketMocks.refreshSocketAuthentication.mockClear();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('window', {
    location: { pathname: '/inbox', href: '/inbox' },
  });
});

describe('cliente HTTP e renovacao de sessao', () => {
  it('inclui cookies no login sem expor um corpo JSON vazio no logout', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: 'token', user: {} }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient();
    await client.post('/auth/login', { email: 'ana@example.com', password: 'Senha12345' });
    await client.post('/auth/logout');

    const loginInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const loginHeaders = new Headers(loginInit.headers);
    expect(loginInit.credentials).toBe('include');
    expect(loginHeaders.get('X-Refresh-Token-Transport')).toBe('cookie');

    const logoutInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(logoutInit.credentials).toBe('include');
    expect(new Headers(logoutInit.headers).has('Content-Type')).toBe(false);
  });

  it('faz um unico refresh para varias respostas 401 concorrentes', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return json({ accessToken: 'new-token' });
      }

      const authorization = new Headers(init?.headers).get('Authorization');
      return authorization === 'Bearer new-token'
        ? json({ url })
        : json({ error: { message: 'Expirado' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient();
    client.setToken('old-token');

    const [first, second] = await Promise.all([client.get('/first'), client.get('/second')]);

    expect(first).toMatchObject({ url: expect.stringContaining('/first') });
    expect(second).toMatchObject({ url: expect.stringContaining('/second') });
    expect(refreshCalls).toBe(1);
    expect(client.getToken()).toBe('new-token');
    expect(socketMocks.refreshSocketAuthentication).toHaveBeenCalledOnce();
    expect(socketMocks.refreshSocketAuthentication).toHaveBeenCalledWith('new-token');
  });

  it('rejeita todos os aguardando quando o refresh falha e permite nova tentativa depois', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/refresh')) {
        refreshCalls += 1;
        return json({ error: { message: 'Sessao expirada' } }, 401);
      }
      return json({ error: { message: 'Expirado' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient();
    client.setToken('old-token');

    const results = await Promise.allSettled([client.get('/first'), client.get('/second')]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(refreshCalls).toBe(1);
    expect(client.getToken()).toBeNull();
    expect(window.location.href).toBe('/login');

    await expect(client.get('/third')).rejects.toThrow('Sessao expirada');
    expect(refreshCalls).toBe(2);
  });

  it('nao entra em ciclo quando a requisicao repetida continua retornando 401', async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/refresh')) {
        refreshCalls += 1;
        return json({ accessToken: 'new-token' });
      }
      protectedCalls += 1;
      return json({ error: { message: 'Ainda nao autorizado' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ApiClient();
    client.setToken('old-token');

    await expect(client.get('/protected')).rejects.toThrow('Ainda nao autorizado');
    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(2);
  });
});

describe('endereco base da API', () => {
  it('usa /api quando a variavel esta vazia ou ausente', () => {
    // O .env do projeto traz "VITE_API_URL=" sem valor: e o caso real que
    // deixava a tela de login com "Not Found" no servidor de desenvolvimento.
    expect(resolverBaseDaApi('')).toBe('/api');
    expect(resolverBaseDaApi('   ')).toBe('/api');
    expect(resolverBaseDaApi(undefined)).toBe('/api');
  });

  it('respeita um endereco configurado, sem barra no fim', () => {
    expect(resolverBaseDaApi('https://api.exemplo.com.br')).toBe('https://api.exemplo.com.br');
    expect(resolverBaseDaApi('https://api.exemplo.com.br/')).toBe('https://api.exemplo.com.br');
    expect(resolverBaseDaApi('https://api.exemplo.com.br///')).toBe('https://api.exemplo.com.br');
  });
});
