import { createHmac } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { safeCompare } from '../../lib/crypto.js';
import { env } from '../../env.js';

/**
 * Regras de seguranca para arquivos.
 *
 * O arquivo que chega aqui veio de fora - do atendente ou do cliente pelo
 * WhatsApp. Nada do que o remetente afirma sobre ele pode ser aceito sem
 * conferencia: nem o nome, nem o tipo, nem o tamanho.
 */

/**
 * Tipos aceitos.
 *
 * Lista de permissao, nunca de bloqueio: tipo novo perigoso aparece o tempo
 * todo, e uma lista de bloqueio esta sempre desatualizada. O que nao esta
 * aqui e recusado.
 *
 * Repare no que NAO esta: text/html, image/svg+xml e application/xhtml+xml.
 * Todos executam script no navegador. Servidos da mesma origem do painel,
 * virariam roubo de sessao do atendente.
 */
const TIPOS_PERMITIDOS = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav', 'audio/webm',
  'video/mp4', 'video/3gpp', 'video/quicktime', 'video/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

/** Tipos que o navegador pode exibir na propria aba com seguranca. */
const EXIBIVEIS = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm',
  'video/mp4', 'video/webm', 'application/pdf',
]);

export const TAMANHO_MAXIMO_BYTES = 32 * 1024 * 1024;

/** Normaliza e valida o tipo declarado. */
export function validarMimeType(bruto: string | undefined | null): string {
  const tipo = (bruto ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

  if (!TIPOS_PERMITIDOS.has(tipo)) {
    throw new AppError(`Tipo de arquivo nao permitido: ${tipo || 'desconhecido'}`, {
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
  }

  return tipo;
}

/**
 * Limpa o nome do arquivo antes de ele virar parte de um caminho.
 *
 * Tira diretorios, bytes nulos e caracteres de controle. O nome e so um
 * rotulo: nunca deve decidir onde o arquivo vai parar no disco.
 */
export function sanitizarNomeArquivo(bruto: string | undefined | null): string | null {
  if (!bruto) return null;

  const limpo = bruto
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);

  return limpo || null;
}

/**
 * Cabecalho de exibicao.
 *
 * Tudo que nao for seguro exibir vai como anexo. Assim, mesmo que um tipo
 * perigoso passe por engano, o navegador baixa em vez de executar.
 */
export function disposicaoSegura(mimeType: string, fileName: string | null): string {
  const modo = EXIBIVEIS.has(mimeType) ? 'inline' : 'attachment';
  if (!fileName) return modo;

  // RFC 5987: nome em UTF-8 sem quebrar o cabecalho com aspas ou acentos.
  return `${modo}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// --- URLs assinadas --------------------------------------------------------

/**
 * Por que a midia precisa de URL assinada.
 *
 * A rota exige sessao, mas o navegador nao manda o cabecalho Authorization em
 * <img>, <audio> e <video> - esses elementos carregam a URL crua. Sem uma
 * alternativa, ou a midia quebra no painel, ou voltariamos a deixar a rota
 * publica.
 *
 * A assinatura resolve os dois lados: quem pediu a mensagem pela API (ja
 * autenticado) recebe um link que vale por pouco tempo e so para aquele
 * arquivo daquela organizacao. Vazou o link, ele expira sozinho.
 */

const VALIDADE_SEGUNDOS = 30 * 60;

function assinar(mediaId: string, orgId: string, expiraEm: number): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${mediaId}.${orgId}.${expiraEm}`)
    .digest('base64url');
}

/** Gera o trecho de consulta assinado para anexar a URL da midia. */
export function assinarUrlMidia(mediaId: string, orgId: string): string {
  const expiraEm = Math.floor(Date.now() / 1000) + VALIDADE_SEGUNDOS;
  return `exp=${expiraEm}&sig=${assinar(mediaId, orgId, expiraEm)}`;
}

/** Confere a assinatura. Retorna a organizacao quando valida. */
export function validarUrlMidia(
  mediaId: string,
  orgId: string | undefined,
  exp: string | undefined,
  sig: string | undefined,
): boolean {
  if (!orgId || !exp || !sig) return false;

  const expiraEm = Number(exp);
  if (!Number.isFinite(expiraEm) || expiraEm < Math.floor(Date.now() / 1000)) return false;

  const esperada = assinar(mediaId, orgId, expiraEm);

  // Comparacao em tempo constante: comparar com === vaza, pelo tempo de
  // resposta, quantos caracteres iniciais o atacante acertou.
  return safeCompare(sig, esperada);
}
