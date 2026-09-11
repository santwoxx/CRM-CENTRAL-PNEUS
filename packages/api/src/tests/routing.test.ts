import { describe, expect, it } from 'vitest';
import { RoutingStrategy } from '@crm/shared';
import {
  pickAgent,
  findEligibleAgents,
  type AgentCandidate,
} from '../modules/routing/router.js';
import type { Db } from '../db/prisma.js';

/**
 * Roteamento: para QUEM vai cada conversa.
 *
 * Este e o caminho que nao pode falhar. Falha aqui nao aparece como erro -
 * aparece como cliente esperando resposta que nunca chega. Foi exatamente o
 * que aconteceu: um dono ONLINE, com vaga, e duas conversas paradas na fila,
 * porque ele nao pertencia a setor nenhum. Nada quebrou; o sistema so ficou
 * quieto.
 *
 * As tres garantias que o router precisa sustentar, segundo o proprio
 * cabecalho dele, e que os testes abaixo exercem:
 *   1. Nunca dois atendentes na mesma conversa.
 *   2. Nunca passar do teto de conversas do atendente.
 *   3. Nunca perder a conversa.
 */

function candidato(over: Partial<AgentCandidate> = {}): AgentCandidate {
  return {
    userId: 'u1',
    name: 'Atendente',
    activeChats: 0,
    maxConcurrentChats: 5,
    priority: 0,
    lastAssignedAt: null,
    ...over,
  };
}

describe('pickAgent: escolha do atendente', () => {
  it('sem candidato, nao inventa ninguem', () => {
    expect(pickAgent([], RoutingStrategy.LEAST_BUSY, {})).toBeNull();
  });

  it('atende o pedido explicito do cliente acima de qualquer estrategia', () => {
    const ocupado = candidato({ userId: 'pedido', activeChats: 4 });
    const livre = candidato({ userId: 'outro', activeChats: 0 });

    const escolhido = pickAgent([livre, ocupado], RoutingStrategy.LEAST_BUSY, {
      preferredUserId: 'pedido',
    });

    // Cliente que escolheu "falar com fulano" nao pode ser desviado so
    // porque outro esta mais livre - quebra a promessa do menu.
    expect(escolhido?.userId).toBe('pedido');
  });

  it('devolve o cliente recorrente para o atendente que ja o conhece', () => {
    const dono = candidato({ userId: 'dono', activeChats: 3 });
    const livre = candidato({ userId: 'livre', activeChats: 0 });

    const escolhido = pickAgent([livre, dono], RoutingStrategy.LEAST_BUSY, {
      contactAgentId: 'dono',
    });

    expect(escolhido?.userId).toBe('dono');
  });

  it('ignora a preferencia quando o preferido nao esta entre os elegiveis', () => {
    // O preferido pode estar offline ou lotado. Neste caso o cliente tem que
    // ser atendido por outro, e nao ficar esperando por alguem indisponivel.
    const livre = candidato({ userId: 'livre' });

    const escolhido = pickAgent([livre], RoutingStrategy.LEAST_BUSY, {
      preferredUserId: 'ausente',
    });

    expect(escolhido?.userId).toBe('livre');
  });

  it('MANUAL nao atribui sozinho, nem com gente disponivel', () => {
    const livre = candidato({ userId: 'livre' });

    expect(pickAgent([livre], RoutingStrategy.MANUAL, {})).toBeNull();
  });

  it('MANUAL ainda respeita o pedido explicito do cliente', () => {
    // A transferencia dirigida e uma decisao humana; a estrategia manual
    // existe para impedir distribuicao automatica, nao para bloquear isso.
    const pedido = candidato({ userId: 'pedido' });

    const escolhido = pickAgent([pedido], RoutingStrategy.MANUAL, {
      preferredUserId: 'pedido',
    });

    expect(escolhido?.userId).toBe('pedido');
  });

  it('LEAST_BUSY manda para quem tem menos conversa aberta', () => {
    const cheio = candidato({ userId: 'cheio', activeChats: 4 });
    const meio = candidato({ userId: 'meio', activeChats: 2 });
    const vazio = candidato({ userId: 'vazio', activeChats: 0 });

    const escolhido = pickAgent([cheio, meio, vazio], RoutingStrategy.LEAST_BUSY, {});

    expect(escolhido?.userId).toBe('vazio');
  });

  it('ROUND_ROBIN manda para quem esta ha mais tempo sem receber', () => {
    const recente = candidato({
      userId: 'recente',
      lastAssignedAt: new Date('2026-09-11T12:00:00Z'),
    });
    const antigo = candidato({
      userId: 'antigo',
      lastAssignedAt: new Date('2026-09-11T08:00:00Z'),
    });

    const escolhido = pickAgent([recente, antigo], RoutingStrategy.ROUND_ROBIN, {});

    expect(escolhido?.userId).toBe('antigo');
  });

  it('quem nunca recebeu entra na frente no rodizio', () => {
    const novato = candidato({ userId: 'novato', lastAssignedAt: null });
    const veterano = candidato({
      userId: 'veterano',
      lastAssignedAt: new Date('2026-09-11T08:00:00Z'),
    });

    const escolhido = pickAgent([veterano, novato], RoutingStrategy.ROUND_ROBIN, {});

    expect(escolhido?.userId).toBe('novato');
  });

  it('a prioridade do admin vence a estrategia automatica', () => {
    // O admin marcou alguem como preferencial no setor. Isso e uma decisao
    // de negocio e precisa passar por cima do criterio de ocupacao.
    const prioritario = candidato({ userId: 'prioritario', priority: 10, activeChats: 3 });
    const ocioso = candidato({ userId: 'ocioso', priority: 0, activeChats: 0 });

    const escolhido = pickAgent([prioritario, ocioso], RoutingStrategy.LEAST_BUSY, {});

    expect(escolhido?.userId).toBe('prioritario');
  });

  it('nao altera a lista que recebeu', () => {
    // A ordenacao acontece numa copia. Se mexesse no array original, a
    // ordem observada mudaria entre chamadas do mesmo roteamento.
    const lista = [
      candidato({ userId: 'a', activeChats: 5 }),
      candidato({ userId: 'b', activeChats: 1 }),
    ];
    const ordemOriginal = lista.map((c) => c.userId);

    pickAgent(lista, RoutingStrategy.LEAST_BUSY, {});

    expect(lista.map((c) => c.userId)).toEqual(ordemOriginal);
  });
});

/**
 * Monta um banco falso com o minimo que findEligibleAgents consulta.
 * Evita subir Postgres so para exercer a regra de elegibilidade.
 */
function bancoFalso(opts: {
  membros?: Array<{
    priority: number;
    user: { id: string; name: string; maxConcurrentChats: number; lastAssignedAt: Date | null };
  }>;
  usuarios?: Array<{
    id: string;
    name: string;
    maxConcurrentChats: number;
    lastAssignedAt: Date | null;
  }>;
  ativas?: Record<string, number>;
}): Db {
  const ativas = opts.ativas ?? {};
  return {
    departmentMember: { findMany: async () => opts.membros ?? [] },
    user: { findMany: async () => opts.usuarios ?? [] },
    conversation: {
      groupBy: async () =>
        Object.entries(ativas).map(([assignedUserId, n]) => ({
          assignedUserId,
          _count: { _all: n },
        })),
    },
  } as unknown as Db;
}

function membro(
  id: string,
  over: { priority?: number; max?: number; lastAssignedAt?: Date | null } = {},
) {
  return {
    priority: over.priority ?? 0,
    user: {
      id,
      name: id,
      maxConcurrentChats: over.max ?? 5,
      lastAssignedAt: over.lastAssignedAt ?? null,
    },
  };
}

describe('findEligibleAgents: quem pode receber agora', () => {
  it('setor sem nenhum membro devolve lista vazia', async () => {
    // E o caso que deixou duas conversas presas na fila: o unico usuario
    // online nao pertencia ao setor. A funcao esta certa em nao devolver
    // ninguem - o defeito era nao haver como vincular o setor pela tela.
    const agentes = await findEligibleAgents(bancoFalso({ membros: [] }), 'setor-1', 'org-1');

    expect(agentes).toEqual([]);
  });

  it('descarta quem ja bateu o teto de conversas', async () => {
    const db = bancoFalso({
      membros: [membro('cheio', { max: 2 }), membro('livre', { max: 5 })],
      ativas: { cheio: 2, livre: 1 },
    });

    const agentes = await findEligibleAgents(db, 'setor-1', 'org-1');

    expect(agentes.map((a) => a.userId)).toEqual(['livre']);
  });

  it('teto e limite estrito: com uma vaga sobrando, continua elegivel', async () => {
    const db = bancoFalso({
      membros: [membro('quase', { max: 3 })],
      ativas: { quase: 2 },
    });

    const agentes = await findEligibleAgents(db, 'setor-1', 'org-1');

    expect(agentes).toHaveLength(1);
    expect(agentes[0]?.activeChats).toBe(2);
  });

  it('atendente sem conversa nenhuma conta como zero, nao como indefinido', async () => {
    // O groupBy so devolve linha para quem tem conversa. Quem nao aparece
    // precisa virar 0 - se virasse undefined, a comparacao com o teto seria
    // sempre falsa e o atendente ocioso nunca receberia nada.
    const db = bancoFalso({ membros: [membro('ocioso')], ativas: {} });

    const agentes = await findEligibleAgents(db, 'setor-1', 'org-1');

    expect(agentes[0]?.activeChats).toBe(0);
  });

  it('sem setor definido, considera qualquer atendente online da empresa', async () => {
    const db = bancoFalso({
      usuarios: [{ id: 'geral', name: 'Geral', maxConcurrentChats: 5, lastAssignedAt: null }],
    });

    const agentes = await findEligibleAgents(db, null, 'org-1');

    expect(agentes.map((a) => a.userId)).toEqual(['geral']);
  });

  it('preserva a prioridade definida pelo admin no setor', async () => {
    const db = bancoFalso({ membros: [membro('chefe', { priority: 7 })] });

    const agentes = await findEligibleAgents(db, 'setor-1', 'org-1');

    expect(agentes[0]?.priority).toBe(7);
  });
});
