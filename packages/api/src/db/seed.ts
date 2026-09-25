import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AgentPresence, RoutingStrategy } from '@crm/shared';
import { hashPassword } from '../lib/crypto.js';
import { describeActiveProvider } from '../modules/ai/provider.js';
import { DEFAULT_CENTRAL_PNEUS_PROMPT, DEFAULT_QUALIFICATION_GOALS } from '../modules/ai/persona.js';
import { ACESSOS_AUTORIZADOS } from '../config/acessos.js';
import { SEED_SERVICES, SEED_TIRES } from './seed-data/tires.js';

/**
 * Dados iniciais do CRM.
 *
 * DUAS CAMADAS, E ELAS NAO SE MISTURAM
 *
 * Base - o que qualquer instalacao precisa para funcionar: a organizacao (sem
 * ela o login com Google recusa todo mundo), os setores, a persona da IA e as
 * pessoas da lista de acessos (config/acessos.ts).
 *
 * Demonstracao - o que so existe para testar: quatro contas com senha
 * conhecida, um catalogo com precos inventados e atalhos com dados falsos.
 * Em producao, cada item disso e um estrago real:
 *   - a senha do dono esta escrita neste repositorio;
 *   - a IA cotaria preco e estoque ficticios para cliente de verdade;
 *   - o atalho /pix enviaria uma chave PIX que nao e da loja.
 * Nenhum desses dados tem tela para editar, entao o que entra fica.
 *
 * Por isso a demonstracao e recusada com NODE_ENV=production, mesmo que
 * alguem peca.
 */

export interface OpcoesSemeadura {
  demonstracao: boolean;
}

export async function semear(prisma: PrismaClient, opcoes: OpcoesSemeadura): Promise<void> {
  if (opcoes.demonstracao && process.env.NODE_ENV === 'production') {
    throw new Error(
      'Dados de demonstracao recusados em producao: criariam contas com senha publica, ' +
        'precos ficticios e uma chave PIX falsa.',
    );
  }

  const org = await prisma.organization.upsert({
    where: { slug: 'central-pneus' },
    update: {},
    create: {
      name: 'Central Pneus',
      slug: 'central-pneus',
      timezone: 'America/Sao_Paulo',
      // CNPJ, telefone e endereco ficticios so na demonstracao.
      settings: opcoes.demonstracao
        ? {
            companyName: 'Central Pneus Comércio e Serviços Automotivos Ltda',
            cnpj: '12.345.678/0001-90',
            phone: '(31) 3333-0000',
            address: 'Av. Principal dos Pneus, 1500 - Belo Horizonte / MG',
          }
        : {},
    },
  });

  const setores = await criarSetores(prisma, org.id);
  await criarPersona(prisma, org.id);
  await garantirAcessosAutorizados(prisma, org.id, setores);

  if (opcoes.demonstracao) {
    await criarDemonstracao(prisma, org.id, setores);
  }
}

type MapaSetores = Record<'vendas' | 'financeiro' | 'oficina', string>;

async function criarSetores(prisma: PrismaClient, orgId: string): Promise<MapaSetores> {
  const vendas = await prisma.department.upsert({
    where: { orgId_slug: { orgId, slug: 'vendas' } },
    update: {},
    create: {
      orgId,
      name: 'Comercial & Vendas',
      slug: 'vendas',
      description: 'Cotação e venda de pneus novos, marcas nacionais e importadas',
      color: '#2563eb',
      menuLabel: '1 - Vendas de Pneus',
      showInMenu: true,
      order: 1,
      routingStrategy: RoutingStrategy.LEAST_BUSY,
      aiEnabled: true,
      offlineMessage:
        'Nosso setor comercial atende de Seg a Sex das 08:00 às 18:00. Deixe sua medida que responderemos logo cedo!',
    },
  });

  const financeiro = await prisma.department.upsert({
    where: { orgId_slug: { orgId, slug: 'financeiro' } },
    update: {},
    create: {
      orgId,
      name: 'Financeiro',
      slug: 'financeiro',
      description: 'Boletos, notas fiscais, faturamento e contas a pagar',
      color: '#16a34a',
      menuLabel: '2 - Financeiro & Boletos',
      showInMenu: true,
      order: 2,
      routingStrategy: RoutingStrategy.ROUND_ROBIN,
      aiEnabled: false,
    },
  });

  const oficina = await prisma.department.upsert({
    where: { orgId_slug: { orgId, slug: 'oficina' } },
    update: {},
    create: {
      orgId,
      name: 'Oficina & Agendamento',
      slug: 'oficina',
      description: 'Alinhamento 3D, balanceamento, cambagem, freios e suspensão',
      color: '#d97706',
      menuLabel: '3 - Oficina & Serviços',
      showInMenu: true,
      order: 3,
      routingStrategy: RoutingStrategy.LEAST_BUSY,
      aiEnabled: true,
    },
  });

  return { vendas: vendas.id, financeiro: financeiro.id, oficina: oficina.id };
}

async function criarPersona(prisma: PrismaClient, orgId: string): Promise<void> {
  const ativo = describeActiveProvider();

  await prisma.aiPersona.upsert({
    where: { id: 'seed-persona-central-pneus' },
    // Reexecutar realinha a persona com o provedor configurado agora.
    update: { provider: ativo.provider, model: ativo.chatModel },
    create: {
      id: 'seed-persona-central-pneus',
      orgId,
      name: 'Atendente Virtual Central Pneus',
      systemPrompt: DEFAULT_CENTRAL_PNEUS_PROMPT,
      greeting: 'Olá! Seja bem-vindo(a) à Central Pneus. Como podemos ajudar seu veículo hoje?',
      // Segue o provedor do .env em vez de fixar um pago. Gravar "anthropic"
      // aqui fazia toda conversa falhar por falta de credencial numa
      // instalacao que roda IA local.
      provider: ativo.provider,
      model: ativo.chatModel,
      temperature: 0.4,
      maxTokens: 220,
      maxTurnsBeforeHandoff: 5,
      qualificationGoals: DEFAULT_QUALIFICATION_GOALS as never,
      isActive: true,
      isDefault: true,
    },
  });
}

/**
 * Garante que cada pessoa de config/acessos.ts exista.
 *
 * So CRIA quem falta; nunca altera nem revoga quem ja existe. Quem quiser
 * aplicar mudancas de cargo e revogacoes usa `sincronizar-acessos`, que e o
 * comando explicito para isso. Aqui, sobrescrever desfaria em silencio o que
 * o admin mudou pela tela de Equipe.
 */
async function garantirAcessosAutorizados(
  prisma: PrismaClient,
  orgId: string,
  setores: MapaSetores,
): Promise<void> {
  for (const acesso of ACESSOS_AUTORIZADOS) {
    const email = acesso.email.toLowerCase();
    const existe = await prisma.user.findFirst({ where: { orgId, email }, select: { id: true } });
    if (existe) continue;

    const vinculos = (acesso.setores ?? [])
      .map((slug) => setores[slug as keyof MapaSetores])
      .filter((id): id is string => Boolean(id));

    await prisma.user.create({
      data: {
        orgId,
        name: acesso.nome,
        email,
        // Quem entra pelo Google nunca usa senha, mas o campo e obrigatorio e
        // nao pode ficar previsivel.
        passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
        role: acesso.cargo,
        maxConcurrentChats: acesso.maxConversas ?? 5,
        presence: AgentPresence.OFFLINE,
        departments: { create: vinculos.map((departmentId) => ({ departmentId })) },
      },
    });
  }
}

async function criarDemonstracao(
  prisma: PrismaClient,
  orgId: string,
  setores: MapaSetores,
): Promise<void> {
  const senhaAdmin = await hashPassword('AdminPassword123!');
  const senhaAtendente = await hashPassword('Atendente123!');

  const contas = [
    { email: 'admin@centralpneus.com.br', name: 'Administrador Central Pneus', role: 'OWNER', max: 15, senha: senhaAdmin, setor: null },
    { email: 'carlos@centralpneus.com.br', name: 'Carlos Mendes (Vendas)', role: 'AGENT', max: 6, senha: senhaAtendente, setor: setores.vendas },
    { email: 'mariana@centralpneus.com.br', name: 'Mariana Costa (Financeiro)', role: 'AGENT', max: 5, senha: senhaAtendente, setor: setores.financeiro },
    { email: 'roberto@centralpneus.com.br', name: 'Roberto Mecânica (Oficina)', role: 'AGENT', max: 5, senha: senhaAtendente, setor: setores.oficina },
  ] as const;

  for (const conta of contas) {
    await prisma.user.upsert({
      where: { orgId_email: { orgId, email: conta.email } },
      update: {},
      create: {
        orgId,
        name: conta.name,
        email: conta.email,
        passwordHash: conta.senha,
        role: conta.role,
        maxConcurrentChats: conta.max,
        presence: AgentPresence.ONLINE,
        ...(conta.setor ? { departments: { create: [{ departmentId: conta.setor }] } } : {}),
      },
    });
  }

  const atalhos = [
    {
      shortcut: 'pneus',
      content:
        'Temos pneus novos a pronta entrega das principais marcas (Pirelli, Michelin, Goodyear, Continental) com 5 anos de garantia. Qual a medida do seu aro?',
    },
    {
      shortcut: 'orcamento',
      content:
        'Condições especiais hoje: 7% de desconto à vista no PIX ou parcelamento em até 10x sem juros no cartão de crédito com montagem grátis!',
    },
    {
      shortcut: 'horario',
      content:
        'Nosso horário de atendimento é de Segunda a Sexta das 08h às 18h e aos Sábados das 08h às 12h30.',
    },
    {
      shortcut: 'pix',
      content:
        'Chave PIX CNPJ da Central Pneus: 12.345.678/0001-90 (Central Pneus Comércio de Peças e Serviços Ltda). Favor enviar o comprovante assim que concluir.',
    },
    {
      shortcut: 'alinhamento',
      content:
        'Nosso alinhamento é 100% computadorizado 3D de alta precisão. O pacote inclui alinhamento + balanceamento das 4 rodas + revisão visual da suspensão.',
    },
  ];

  for (const atalho of atalhos) {
    await prisma.quickReply.upsert({
      where: { orgId_shortcut: { orgId, shortcut: atalho.shortcut } },
      update: {},
      create: { orgId, ...atalho },
    });
  }

  // A IA so cita precos que existirem aqui. Precos e estoque INVENTADOS.
  for (const tire of SEED_TIRES) {
    await prisma.tireProduct.upsert({
      where: {
        orgId_brand_model_sizeKey: {
          orgId,
          brand: tire.brand,
          model: tire.model,
          sizeKey: tire.sizeKey,
        },
      },
      // Reexecutar atualiza preco e estoque sem duplicar produto.
      update: { priceCents: tire.priceCents, stockQuantity: tire.stockQuantity },
      create: { orgId, ...tire },
    });
  }

  for (const service of SEED_SERVICES) {
    await prisma.serviceItem.upsert({
      where: { orgId_slug: { orgId, slug: service.slug } },
      update: { priceCents: service.priceCents },
      create: { orgId, ...service },
    });
  }
}
