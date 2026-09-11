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
  // A rota de upload vive na raiz, sem prefixo proprio. Sem ela nesta lista,
  // "/api/uploads" nao era reescrito e o envio de arquivo pelo painel caia em
  // 404 - quebrado em silencio, porque nada no servidor registrava erro.
  '/uploads',
  '/webhooks',
  '/health',
  '/socket.io',
  // Qualquer coisa sob /api pertence a API, mesmo que nao exista rota: assim
  // um caminho errado devolve JSON, e nao o index.html - o frontend receberia
  // HTML onde espera dados e quebraria de um jeito dificil de diagnosticar.
  '/api',
] as const;

/**
 * Normaliza o caminho antes de compara-lo.
 *
 * Tres tratamentos, cada um fechando um jeito de escapar da comparacao:
 *
 *  - DECODIFICA o percent-encoding: "%2f" e "/" e "%2e" e "."; sem decodificar,
 *    "/media%2f..%2fx" nao casaria com nenhum prefixo e a rota seria
 *    classificada errado.
 *  - RESOLVE os ".." para a forma canonica, para "/assets/../auth" ser
 *    reconhecido como o que realmente e: "/auth".
 *  - COLAPSA barras repetidas, que servem para o mesmo disfarce.
 *
 * Esta funcao decide o que e publico e o que exige sessao. Uma comparacao
 * ingenua aqui vira bypass de autorizacao.
 */
function normalizarCaminho(url: string): string {
  let caminho = url.split('?')[0] ?? '/';

  // Decodifica ate estabilizar: codificacao dupla ("%252f") tambem e disfarce.
  for (let i = 0; i < 3; i += 1) {
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(caminho);
    } catch {
      break; // Sequencia invalida: fica com o que ja temos.
    }
    if (decodificado === caminho) break;
    caminho = decodificado;
  }

  // Contrabarra vira barra (disfarce comum no Windows) e barras repetidas
  // colapsam. `split/join` evita escapar contrabarra dentro de regex.
  caminho = caminho.split(String.fromCharCode(92)).join('/').replace(/\/{2,}/g, '/');

  const partes: string[] = [];
  for (const parte of caminho.split('/')) {
    if (parte === '' || parte === '.') continue;
    if (parte === '..') partes.pop();
    else partes.push(parte);
  }

  return `/${partes.join('/')}`.replace(/\/+$/, '') || '/';
}

/** Caminho que pertence a API (e portanto nunca deve devolver o index.html). */
export function isApiPath(url: string): boolean {
  const path = normalizarCaminho(url);
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
