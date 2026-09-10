/**
 * Fronteira entre a API e o painel.
 *
 * Tres lugares precisam concordar sobre o que e "rota de API": a reescrita de
 * /api, o plugin de autenticacao e o fallback de pagina unica. Se cada um
 * tivesse a propria lista, um caminho protegido em um seria publico em outro
 * - por isso a lista mora aqui, sozinha.
 */

export const API_PREFIXES = [
  '/auth',
  '/users',
  '/departments',
  '/contacts',
  '/conversations',
  '/messages',
  '/channels',
  '/ai',
  '/dashboard',
  '/simulator',
  '/media',
  '/webhooks',
  '/health',
  '/socket.io',
  // Qualquer coisa sob /api pertence a API, mesmo que nao exista rota: assim
  // um caminho errado devolve JSON, e nao o index.html - o frontend receberia
  // HTML onde espera dados e quebraria de um jeito dificil de diagnosticar.
  '/api',
] as const;

/** Caminho que pertence a API (e portanto nunca deve devolver o index.html). */
export function isApiPath(url: string): boolean {
  const path = (url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
