import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Direito de eliminacao (LGPD, art. 18, VI).
 *
 * O que nao pode acontecer, em ordem de gravidade:
 *  1. dizer que apagou e deixar o arquivo de audio ou a foto no disco;
 *  2. registrar o telefone do cliente dentro do registro da exclusao,
 *     anulando a propria exclusao;
 *  3. deixar a operacao pela metade porque um arquivo ja nao existia.
 */

const contatoEncontrado = vi.fn(async () => ({ id: 'contato-1' }));
const conversasDoContato = vi.fn(async () => [{ id: 'conversa-1' }, { id: 'conversa-2' }]);
const mensagensComMidia = vi.fn(async () => [
  { media: { id: 'midia-1', storageKey: 'org/audio-1.ogg' } },
  { media: { id: 'midia-2', storageKey: 'org/foto-1.jpg' } },
]);
const apagarContato = vi.fn();
const apagarMidias = vi.fn();
const apagarArquivo = vi.fn(async () => undefined);
const registrarAuditoria = vi.fn();

vi.mock('../db/prisma.js', () => ({
  prisma: {
    contact: { findFirst: (...a: unknown[]) => contatoEncontrado(...a), delete: (...a: unknown[]) => apagarContato(...a) },
    conversation: { findMany: (...a: unknown[]) => conversasDoContato(...a) },
    message: { findMany: (...a: unknown[]) => mensagensComMidia(...a), count: vi.fn(async () => 7) },
    mediaAsset: { deleteMany: (...a: unknown[]) => apagarMidias(...a) },
  },
}));
vi.mock('../modules/media/storage.js', () => ({
  storage: { delete: (...a: unknown[]) => apagarArquivo(...a) },
}));
vi.mock('../modules/audit/service.js', () => ({
  recordAudit: (...a: unknown[]) => registrarAuditoria(...a),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { apagarDadosDoContato } = await import('../modules/contacts/lgpd.js');

const ATOR = { userId: 'admin-1', ipAddress: '200.150.10.20' };

beforeEach(() => {
  apagarContato.mockReset();
  apagarMidias.mockReset();
  apagarArquivo.mockReset().mockResolvedValue(undefined);
  registrarAuditoria.mockReset();
});

describe('apagar os dados de um cliente', () => {
  it('apaga o contato, e a cascata leva conversas e mensagens', async () => {
    const r = await apagarDadosDoContato('org-1', 'contato-1', ATOR);

    expect(apagarContato).toHaveBeenCalledWith({ where: { id: 'contato-1' } });
    expect(r.conversas).toBe(2);
    expect(r.mensagens).toBe(7);
  });

  it('apaga os arquivos do disco, que a cascata do banco nao alcanca', async () => {
    const r = await apagarDadosDoContato('org-1', 'contato-1', ATOR);

    const apagados = apagarArquivo.mock.calls.map((c) => c[0]);
    expect(apagados).toContain('org/audio-1.ogg');
    expect(apagados).toContain('org/foto-1.jpg');
    expect(r.arquivos).toBe(2);
  });

  it('um arquivo que ja sumiu nao interrompe a exclusao', async () => {
    apagarArquivo.mockRejectedValueOnce(new Error('ENOENT'));

    const r = await apagarDadosDoContato('org-1', 'contato-1', ATOR);

    // O outro arquivo foi apagado e a operacao terminou.
    expect(apagarArquivo).toHaveBeenCalledTimes(2);
    expect(r.arquivos).toBe(1);
  });

  it('a trilha registra a exclusao sem guardar dado pessoal', async () => {
    await apagarDadosDoContato('org-1', 'contato-1', ATOR);

    const registro = registrarAuditoria.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(registro.action).toBe('contact.erased');
    expect(registro.entityId).toBe('contato-1');
    // Nem telefone, nem nome: guardar isso aqui anularia a exclusao.
    const texto = JSON.stringify(registro);
    expect(texto).not.toMatch(/\d{10,}/);
    expect(registro.before).toBeUndefined();
  });

  it('contato de outra empresa nao e apagado', async () => {
    contatoEncontrado.mockResolvedValueOnce(null as never);

    await expect(apagarDadosDoContato('org-1', 'de-outra-empresa', ATOR)).rejects.toThrow();
    expect(apagarContato).not.toHaveBeenCalled();
  });
});
