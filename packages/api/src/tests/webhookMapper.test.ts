import { describe, expect, it } from 'vitest';
import { MessageStatus, MessageType } from '@crm/shared';
import { parseWebhook as parseMeta } from '../channels/whatsapp-cloud/mapper.js';
import { parseWebhook as parseEvolution } from '../channels/evolution/mapper.js';
import { eventExternalId } from '../channels/registry.js';

/**
 * Traducao do webhook para mensagem.
 *
 * E a porta de entrada de TODA conversa de cliente, e o unico caminho critico
 * que ainda nao tinha teste. Um erro aqui nao derruba nada: a mensagem
 * simplesmente nao existe para o sistema, ninguem responde e nada aparece no
 * log de erro.
 *
 * Os payloads abaixo seguem o formato real de cada provedor.
 */

// --- Meta (API oficial) ------------------------------------------------------

function metaCorpo(valor: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '102290129340398', changes: [{ field: 'messages', value: valor }] }],
  };
}

const CONTATO_META = [{ profile: { name: 'Joao Motorista' }, wa_id: '5531988887777' }];

describe('webhook da Meta', () => {
  it('traduz uma mensagem de texto', () => {
    const eventos = parseMeta(
      metaCorpo({
        contacts: CONTATO_META,
        messages: [
          {
            from: '5531988887777',
            id: 'wamid.HBgNNTUzMTk4ODg4Nzc3Nw',
            timestamp: '1790000000',
            type: 'text',
            text: { body: 'bom dia, preciso de 2 pneus 175/70 R13' },
          },
        ],
      }),
    );

    expect(eventos).toHaveLength(1);
    const [evento] = eventos;
    if (evento?.kind !== 'message') throw new Error('esperava mensagem');
    expect(evento.message.type).toBe(MessageType.TEXT);
    expect(evento.message.content).toContain('175/70 R13');
    expect(evento.message.externalId).toBe('wamid.HBgNNTUzMTk4ODg4Nzc3Nw');
    expect(evento.message.pushName).toBe('Joao Motorista');
    // O telefone entra normalizado: e a chave que liga a mensagem ao contato.
    expect(evento.message.phone).toMatch(/^\d+$/);
  });

  it('reconhece audio como audio, com a midia para baixar', () => {
    // A regra de negocio "audio vai direto para humano" depende deste tipo.
    const eventos = parseMeta(
      metaCorpo({
        contacts: CONTATO_META,
        messages: [
          {
            from: '5531988887777',
            id: 'wamid.AUDIO',
            timestamp: '1790000000',
            type: 'audio',
            audio: { id: '1234567890', mime_type: 'audio/ogg; codecs=opus', voice: true },
          },
        ],
      }),
    );

    const [evento] = eventos;
    if (evento?.kind !== 'message') throw new Error('esperava mensagem');
    expect(evento.message.type).toBe(MessageType.AUDIO);
    expect(evento.message.media?.externalId).toBe('1234567890');
  });

  it('traduz confirmacao de entrega', () => {
    const eventos = parseMeta(
      metaCorpo({
        statuses: [
          {
            id: 'wamid.ENVIADA',
            status: 'delivered',
            timestamp: '1790000000',
            recipient_id: '5531988887777',
          },
        ],
      }),
    );

    const [evento] = eventos;
    if (evento?.kind !== 'status') throw new Error('esperava status');
    expect(evento.status.status).toBe(MessageStatus.DELIVERED);
    expect(evento.status.externalId).toBe('wamid.ENVIADA');
  });

  it('processa lote com varias mensagens', () => {
    // A Meta agrupa eventos: parar na primeira perderia as demais.
    const eventos = parseMeta(
      metaCorpo({
        contacts: CONTATO_META,
        messages: [
          { from: '553199990001', id: 'wamid.A', timestamp: '1790000000', type: 'text', text: { body: 'um' } },
          { from: '553199990002', id: 'wamid.B', timestamp: '1790000001', type: 'text', text: { body: 'dois' } },
        ],
      }),
    );

    expect(eventos.filter((e) => e.kind === 'message')).toHaveLength(2);
  });

  it('ignora corpo que nao e do WhatsApp', () => {
    const [evento] = parseMeta({ object: 'page', entry: [] });

    expect(evento?.kind).toBe('ignored');
  });

  it('descarta mensagem sem identificador em vez de gravar lixo', () => {
    const eventos = parseMeta(
      metaCorpo({ messages: [{ from: '5531988887777', type: 'text', text: { body: 'oi' } }] }),
    );

    expect(eventos.some((e) => e.kind === 'message')).toBe(false);
  });
});

// --- Evolution (QR Code) -----------------------------------------------------

function evolutionCorpo(evento: string, data: Record<string, unknown>) {
  return { event: evento, instance: 'central-pneus', data };
}

function mensagemEvolution(message: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  return evolutionCorpo('messages.upsert', {
    key: { remoteJid: '5531988887777@s.whatsapp.net', fromMe: false, id: '3EB0C767D0' },
    pushName: 'Joao Motorista',
    messageTimestamp: 1790000000,
    message,
    ...extras,
  });
}

describe('webhook da Evolution', () => {
  it('traduz texto simples', () => {
    const [evento] = parseEvolution(mensagemEvolution({ conversation: 'tem 185/60 R15?' }));

    if (evento?.kind !== 'message') throw new Error('esperava mensagem');
    expect(evento.message.type).toBe(MessageType.TEXT);
    expect(evento.message.content).toBe('tem 185/60 R15?');
    expect(evento.message.pushName).toBe('Joao Motorista');
  });

  it('traduz texto com citacao (extendedTextMessage)', () => {
    const [evento] = parseEvolution(
      mensagemEvolution({ extendedTextMessage: { text: 'e para o meu Gol' } }),
    );

    if (evento?.kind !== 'message') throw new Error('esperava mensagem');
    expect(evento.message.content).toBe('e para o meu Gol');
  });

  it('reconhece audio, com a midia para baixar', () => {
    const [evento] = parseEvolution(
      mensagemEvolution({
        audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 7, fileLength: '4096' },
      }),
    );

    if (evento?.kind !== 'message') throw new Error('esperava mensagem');
    expect(evento.message.type).toBe(MessageType.AUDIO);
    // O mimetype perde os parametros: e o que vai para a validacao de tipo.
    expect(evento.message.media?.mimeType).toBe('audio/ogg');
  });

  it('ignora o que a propria loja enviou', () => {
    // Mensagem nossa volta pelo webhook; grava-la duplicaria a conversa.
    const corpo = mensagemEvolution(
      { conversation: 'Ola! Como posso ajudar?' },
      { key: { remoteJid: '5531988887777@s.whatsapp.net', fromMe: true, id: '3EB0C767D0' } },
    );

    expect(parseEvolution(corpo)[0]?.kind).toBe('ignored');
  });

  it('ignora mensagem de grupo', () => {
    const corpo = mensagemEvolution(
      { conversation: 'bom dia pessoal' },
      { key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: '3EB0C767D0' } },
    );

    expect(parseEvolution(corpo)[0]?.kind).toBe('ignored');
  });

  it('traduz confirmacao de entrega', () => {
    const [evento] = parseEvolution(
      evolutionCorpo('messages.update', {
        keyId: '3EB0C767D0',
        status: 'DELIVERY_ACK',
        messageTimestamp: 1790000000,
      }),
    );

    if (evento?.kind !== 'status') throw new Error('esperava status');
    expect(evento.status.status).toBe(MessageStatus.DELIVERED);
  });

  it('aceita o nome do evento nas duas grafias', () => {
    // A Evolution assina MESSAGES_UPSERT e entrega messages.upsert. Se a
    // instalacao entregar a grafia da assinatura, ignorar tudo seria uma
    // falha silenciosa: nenhuma mensagem chega e nada aparece no log.
    const corpo = mensagemEvolution({ conversation: 'oi' });

    expect(parseEvolution({ ...corpo, event: 'MESSAGES_UPSERT' })[0]?.kind).toBe('message');
    expect(parseEvolution({ ...corpo, event: 'messages.upsert' })[0]?.kind).toBe('message');
  });

  it('ignora payload sem data', () => {
    expect(parseEvolution({ event: 'messages.upsert' })[0]?.kind).toBe('ignored');
  });
});

describe('chave de deduplicacao dos eventos', () => {
  it('mensagem e status com o mesmo id nao colidem', () => {
    // No WhatsApp a mensagem e o status dela compartilham o id. Sem prefixo,
    // o "entregue" seria descartado como repeticao da mensagem.
    const [mensagem] = parseMeta(
      metaCorpo({
        contacts: CONTATO_META,
        messages: [
          { from: '5531988887777', id: 'wamid.X', timestamp: '1790000000', type: 'text', text: { body: 'oi' } },
        ],
      }),
    );
    const [status] = parseMeta(
      metaCorpo({ statuses: [{ id: 'wamid.X', status: 'delivered', timestamp: '1790000000' }] }),
    );

    const chaveMensagem = eventExternalId(mensagem!);
    const chaveStatus = eventExternalId(status!);

    expect(chaveMensagem).toBe('msg:wamid.X');
    expect(chaveStatus).not.toBe(chaveMensagem);
  });

  it('status diferentes da mesma mensagem sao eventos diferentes', () => {
    // "enviada" e "entregue" chegam separados e os dois precisam ser gravados.
    const entregue = parseMeta(
      metaCorpo({ statuses: [{ id: 'wamid.Y', status: 'delivered', timestamp: '1790000000' }] }),
    )[0];
    const lida = parseMeta(
      metaCorpo({ statuses: [{ id: 'wamid.Y', status: 'read', timestamp: '1790000001' }] }),
    )[0];

    expect(eventExternalId(entregue!)).not.toBe(eventExternalId(lida!));
  });
});
