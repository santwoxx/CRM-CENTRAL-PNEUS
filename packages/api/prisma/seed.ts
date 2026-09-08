import { PrismaClient, UserRole, AgentPresence, RoutingStrategy } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto.js';
import { SEED_TIRES, SEED_SERVICES } from './data/tires.js';
import { describeActiveProvider } from '../src/modules/ai/provider.js';
import { DEFAULT_CENTRAL_PNEUS_PROMPT, DEFAULT_QUALIFICATION_GOALS } from '../src/modules/ai/persona.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Populando dados iniciais do CRM Central Pneus...');

  // 1. Organização
  const org = await prisma.organization.upsert({
    where: { slug: 'central-pneus' },
    update: {},
    create: {
      name: 'Central Pneus',
      slug: 'central-pneus',
      timezone: 'America/Sao_Paulo',
      settings: {
        companyName: 'Central Pneus Comércio e Serviços Automotivos Ltda',
        cnpj: '12.345.678/0001-90',
        phone: '(31) 3333-0000',
        address: 'Av. Principal dos Pneus, 1500 - Belo Horizonte / MG',
      },
    },
  });

  // 2. Departamentos / Setores
  const deptVendas = await prisma.department.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'vendas' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Comercial & Vendas',
      slug: 'vendas',
      description: 'Cotação e venda de pneus novos, marcas nacionais e importadas',
      color: '#2563eb',
      menuLabel: '1 - Vendas de Pneus',
      showInMenu: true,
      order: 1,
      routingStrategy: RoutingStrategy.LEAST_BUSY,
      aiEnabled: true,
      offlineMessage: 'Nosso setor comercial atende de Seg a Sex das 08:00 às 18:00. Deixe sua medida que responderemos logo cedo!',
    },
  });

  const deptFinanceiro = await prisma.department.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'financeiro' } },
    update: {},
    create: {
      orgId: org.id,
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

  const deptOficina = await prisma.department.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'oficina' } },
    update: {},
    create: {
      orgId: org.id,
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

  // 3. Usuários / Atendentes
  const adminPasswordHash = await hashPassword('AdminPassword123!');
  const agentPasswordHash = await hashPassword('Atendente123!');

  const admin = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: 'admin@centralpneus.com.br' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Administrador Central Pneus',
      email: 'admin@centralpneus.com.br',
      passwordHash: adminPasswordHash,
      role: UserRole.OWNER,
      maxConcurrentChats: 15,
      presence: AgentPresence.ONLINE,
    },
  });

  const carlos = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: 'carlos@centralpneus.com.br' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Carlos Mendes (Vendas)',
      email: 'carlos@centralpneus.com.br',
      passwordHash: agentPasswordHash,
      role: UserRole.AGENT,
      maxConcurrentChats: 6,
      presence: AgentPresence.ONLINE,
      departments: {
        create: [{ departmentId: deptVendas.id }],
      },
    },
  });

  const mariana = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: 'mariana@centralpneus.com.br' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Mariana Costa (Financeiro)',
      email: 'mariana@centralpneus.com.br',
      passwordHash: agentPasswordHash,
      role: UserRole.AGENT,
      maxConcurrentChats: 5,
      presence: AgentPresence.ONLINE,
      departments: {
        create: [{ departmentId: deptFinanceiro.id }],
      },
    },
  });

  const roberto = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: 'roberto@centralpneus.com.br' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Roberto Mecânica (Oficina)',
      email: 'roberto@centralpneus.com.br',
      passwordHash: agentPasswordHash,
      role: UserRole.AGENT,
      maxConcurrentChats: 5,
      presence: AgentPresence.ONLINE,
      departments: {
        create: [{ departmentId: deptOficina.id }],
      },
    },
  });

  // 4. Persona da IA
  const ativo = describeActiveProvider();

  await prisma.aiPersona.upsert({
    where: { id: 'seed-persona-central-pneus' },
    // Reexecutar o seed realinha a persona com o provedor configurado agora.
    update: { provider: ativo.provider, model: ativo.chatModel },
    create: {
      id: 'seed-persona-central-pneus',
      orgId: org.id,
      name: 'Atendente Virtual Central Pneus',
      systemPrompt: DEFAULT_CENTRAL_PNEUS_PROMPT,
      greeting: 'Olá! Seja bem-vindo(a) à Central Pneus. Como podemos ajudar seu veículo hoje?',
      // Segue o provedor do .env em vez de fixar um pago. Gravar "anthropic"
      // aqui fazia toda conversa falhar por falta de credencial numa
      // instalacao que roda IA local.
      provider: ativo.provider,
      model: ativo.chatModel,
      temperature: 0.4,
      maxTokens: 800,
      maxTurnsBeforeHandoff: 10,
      qualificationGoals: DEFAULT_QUALIFICATION_GOALS as never,
      isActive: true,
      isDefault: true,
    },
  });

  // 5. Mensagens Rápidas (/atalhos)
  const quickReplies = [
    {
      shortcut: 'pneus',
      content: 'Temos pneus novos a pronta entrega das principais marcas (Pirelli, Michelin, Goodyear, Continental) com 5 anos de garantia. Qual a medida do seu aro?',
    },
    {
      shortcut: 'orcamento',
      content: 'Condições especiais hoje: 7% de desconto à vista no PIX ou parcelamento em até 10x sem juros no cartão de crédito com montagem grátis!',
    },
    {
      shortcut: 'horario',
      content: 'Nosso horário de atendimento é de Segunda a Sexta das 08h às 18h e aos Sábados das 08h às 12h30.',
    },
    {
      shortcut: 'pix',
      content: 'Chave PIX CNPJ da Central Pneus: 12.345.678/0001-90 (Central Pneus Comércio de Peças e Serviços Ltda). Favor enviar o comprovante assim que concluir.',
    },
    {
      shortcut: 'alinhamento',
      content: 'Nosso alinhamento é 100% computadorizado 3D de alta precisão. O pacote inclui alinhamento + balanceamento das 4 rodas + revisão visual da suspensão.',
    },
  ];

  for (const qr of quickReplies) {
    await prisma.quickReply.upsert({
      where: { orgId_shortcut: { orgId: org.id, shortcut: qr.shortcut } },
      update: {},
      create: {
        orgId: org.id,
        shortcut: qr.shortcut,
        content: qr.content,
      },
    });
  }

  // 7. Catálogo de pneus e serviços da loja.
  //    A IA só cita preços que existirem aqui; sem catálogo ela é instruída
  //    a não falar valores e transferir para um vendedor.
  for (const tire of SEED_TIRES) {
    await prisma.tireProduct.upsert({
      where: {
        orgId_brand_model_sizeKey: {
          orgId: org.id,
          brand: tire.brand,
          model: tire.model,
          sizeKey: tire.sizeKey,
        },
      },
      // Reexecutar o seed atualiza preço e estoque sem duplicar produto.
      update: { priceCents: tire.priceCents, stockQuantity: tire.stockQuantity },
      create: { orgId: org.id, ...tire },
    });
  }

  for (const service of SEED_SERVICES) {
    await prisma.serviceItem.upsert({
      where: { orgId_slug: { orgId: org.id, slug: service.slug } },
      update: { priceCents: service.priceCents },
      create: { orgId: org.id, ...service },
    });
  }

  console.log(
    `Catalogo: ${SEED_TIRES.length} pneus e ${SEED_SERVICES.length} servicos cadastrados.`,
  );

  console.log('✅ Base inicial populada com sucesso!');
  console.log('Usuário Admin: admin@centralpneus.com.br | Senha: AdminPassword123!');
  console.log('Atendentes: carlos@, mariana@, roberto@ | Senha: Atendente123!');
}

main()
  .catch((e) => {
    console.error('Erro ao popular base:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
