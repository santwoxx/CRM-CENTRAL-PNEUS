import { env } from '../env.js';

/**
 * IP real de quem fez a requisicao.
 *
 * Atras de um proxy reverso, `request.ip` e o endereco do PROXY, nao do
 * cliente. Isso importa mais do que parece:
 *
 *  - O limite de tentativas usa o IP como chave. Se todos chegam com o IP do
 *    proxy, a loja inteira divide um balde so. O /refresh tem limite de 10 por
 *    minuto: com varios atendentes, a renovacao de sessao estoura e as pessoas
 *    sao deslogadas no meio do atendimento.
 *  - A auditoria grava o IP de cada login. Com o IP do proxy em todas as
 *    linhas, o registro nao serve para investigar nada.
 *
 * O endereco verdadeiro vem no cabecalho que o proxy acrescenta. Mas so
 * podemos acreditar nesse cabecalho quando a conexao vem de um proxy que NOS
 * controlamos - se aceitassemos de qualquer origem, qualquer um forjaria o
 * cabecalho e escaparia do limite trocando de "IP" a cada tentativa.
 *
 * Confiaveis sao: o loopback (Cloudflare Tunnel na mesma maquina) e os
 * enderecos listados em TRUSTED_PROXY_IPS (o Caddy no docker-compose de
 * producao, que tem IP fixo na rede interna).
 */

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Conexoes IPv4 podem chegar escritas como IPv6 ("::ffff:172.30.0.10"). */
function normalizar(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function resolverIpCliente(
  request: { ip: string; headers: Record<string, unknown> },
  proxiesConfiaveis: readonly string[],
): string {
  const origem = normalizar(request.ip);
  const confiavel = LOOPBACK.has(origem) || proxiesConfiaveis.includes(origem);
  if (!confiavel) return origem;

  const cabecalho =
    (request.headers['cf-connecting-ip'] as string | undefined) ??
    (request.headers['x-forwarded-for'] as string | undefined);

  // No X-Forwarded-For o primeiro endereco e o do cliente; os seguintes sao
  // os proxies pelo caminho.
  const primeiro = cabecalho?.split(',')[0]?.trim();
  return primeiro ? normalizar(primeiro) : origem;
}

/** Atalho com a lista de proxies da configuracao. */
export function ipCliente(request: { ip: string; headers: Record<string, unknown> }): string {
  return resolverIpCliente(request, env.TRUSTED_PROXY_IPS);
}
