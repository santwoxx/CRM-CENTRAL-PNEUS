import { UserRole } from '@prisma/client';

/**
 * Quem pode entrar no CRM, e com qual cargo.
 *
 * ESTA LISTA E O CONTROLE DE ACESSO DO SISTEMA.
 *
 * O login com Google prova QUEM a pessoa e. Quem decide se ela entra - e o
 * que ela pode fazer - e esta lista. Um e-mail que nao esteja aqui recebe
 * "nao esta cadastrado" e nao passa, mesmo com conta Google valida.
 *
 * Depois de editar, aplique com:
 *     npm run acessos
 *
 * O comando cria quem falta, corrige o cargo de quem mudou e DESATIVA quem
 * saiu da lista - e assim que uma demissao vira bloqueio de acesso.
 */

export interface AcessoAutorizado {
  email: string;
  nome: string;
  cargo: UserRole;
  /** Slugs dos setores. Vazio = ve apenas o que o cargo permite. */
  setores?: string[];
  /** Teto de conversas simultaneas. Só faz sentido para quem atende. */
  maxConversas?: number;
}

/**
 * O que cada cargo pode fazer (resumo; a matriz completa esta em
 * packages/shared/src/permissions.ts):
 *
 *   OWNER       Tudo. Unico que pode mexer em outros administradores.
 *   ADMIN       Configura setores, equipe, canais e IA. Ve todas as
 *               conversas ao vivo. Apaga conversa. Ve auditoria.
 *   SUPERVISOR  Ve e distribui as conversas dos setores dele. Acompanha a
 *               equipe. NAO configura o sistema.
 *   AGENT       Atende. Ve as proprias conversas e a fila dos setores dele.
 */
export const ACESSOS_AUTORIZADOS: AcessoAutorizado[] = [
  // --- Administracao ---
  {
    email: 'brisasofc@gmail.com',
    nome: 'Rhuan (Dono)',
    cargo: UserRole.OWNER,
    maxConversas: 10,
  },
  {
    email: 'admin@centralpneus.com.br',
    nome: 'Administrador Central Pneus',
    cargo: UserRole.OWNER,
    maxConversas: 10,
  },

  // --- Atendimento ---
  {
    email: 'carlos@centralpneus.com.br',
    nome: 'Carlos Mendes (Vendas)',
    cargo: UserRole.AGENT,
    setores: ['vendas'],
    maxConversas: 5,
  },
  {
    email: 'mariana@centralpneus.com.br',
    nome: 'Mariana Costa (Financeiro)',
    cargo: UserRole.AGENT,
    setores: ['financeiro'],
    maxConversas: 5,
  },
  {
    email: 'roberto@centralpneus.com.br',
    nome: 'Roberto Mecânica (Oficina)',
    cargo: UserRole.AGENT,
    setores: ['oficina'],
    maxConversas: 5,
  },

  // --- Exemplos: descomente e troque pelos e-mails reais ---
  // {
  //   email: 'supervisor@centralpneus.com.br',
  //   nome: 'Supervisor de Vendas',
  //   cargo: UserRole.SUPERVISOR,
  //   setores: ['vendas', 'oficina'],
  // },
  // {
  //   email: 'amigo@gmail.com',
  //   nome: 'Amigo (teste)',
  //   cargo: UserRole.AGENT,
  //   setores: ['vendas'],
  //   maxConversas: 3,
  // },
];
