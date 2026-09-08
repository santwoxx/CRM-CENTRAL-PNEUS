# 🛞 CRM Central Pneus — Sistema Omnichannel Enterprise

> **CRM Omnichannel de Alta Performance para Centros Automotivos e Autocenters**  
> 1 Número de WhatsApp Oficial / Não-Oficial • Múltiplos Atendentes Simultâneos • Triagem e Qualificação por Inteligência Artificial • Roteamento Concorrente com Locks • Monitoramento e Espelhamento em Tempo Real com Notas Whispers.

---

## 📋 Sumário Executivo

O **CRM Central Pneus** foi projetado para resolver a limitação crítica do WhatsApp Web (máximo de 4 aparelhos conectados) e unificar o atendimento de vendas de pneus, serviços de oficina (alinhamento 3D, balanceamento, suspensão, freios) e financeiro em uma **única plataforma corporativa**:

1. **1 Número Oficial de WhatsApp, Atendentes Ilimitados:**  
   Bypassa completamente o limite de aparelhos do WhatsApp através da **Meta Cloud API Oficial (Graph API v21)** com contingência opcional via **Evolution API (Baileys/QR Code)**.
2. **Triagem e Aquecimento de Leads por IA (CentralBot):**  
   Todo cliente novo inicia em atendimento automático com IA (Claude 3.5 Sonnet ou GPT-4o-mini). A IA coleta medida do pneu (ex: 205/55 R16), aro, modelo do veículo, urgência e serviços desejados. Ao atingir pontuação de qualificação (>= 60), transfere o lead imediatamente para o atendente humano disponível com resumo estruturado.
3. **Reconhecimento de Cliente Recorrente & Menu de Departamentos:**  
   Clientes antigos são automaticamente reconhecidos e roteados com preferência ao seu atendente habitual (*sticky routing*). O cliente também pode navegar por menu interativo para falar direto com **Vendas/Pneus**, **Oficina/Serviços** ou **Financeiro**.
4. **Supervisão em Tempo Real pelo Administrador:**  
   Painel de monitoramento ao vivo com presença dos operadores (Online, Ausente, Ocupado, Offline), capacidade de carga simultânea (`maxConcurrentChats`), fila de espera com SLA visual, espelhamento de conversas ativas (*live spectating*) e **Sussurro Interno (*Whisper Notes*)** em que o gestor ou atendente troca notas privadas amarelas invisíveis para o cliente do WhatsApp.

---

## 🏗️ Arquitetura do Sistema

O projeto é estruturado como um **Monorepo TypeScript** corporativo com separação estrita de responsabilidades:

```
CRM CENTRAL PNEUS/
├── packages/
│   ├── shared/            # Contratos, Enums, DTOs Zod, Normalização Telefônica BR, RBAC e Eventos Socket.IO
│   │   ├── src/
│   │   │   ├── enums.ts          # ConversationStatus, MessageRole, ChannelType, UserRole, PresenceStatus
│   │   │   ├── permissions.ts    # Matriz RBAC Granular (ADMIN, SUPERVISOR, ATTENDANT, BOT)
│   │   │   ├── phone.ts          # Normalizador Canônico Brasileiro (Regra do 9º Dígito: 5531988887777)
│   │   │   ├── realtime.ts       # Contratos tipados de eventos Socket.IO Client/Server
│   │   │   ├── types.ts          # DTOs de API e modelos compartilhados
│   │   │   └── dto.ts            # Validações runtime via Zod
│   │
│   ├── api/               # Backend Fastify 5 + Prisma ORM + BullMQ + Redis + Socket.IO
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # 20 modelos relacionais (PostgreSQL 16)
│   │   │   └── seed.ts           # Carga inicial: Departamentos, Atendentes, Persona IA e Atalhos
│   │   ├── src/
│   │   │   ├── channels/         # Adapters para Meta Cloud API v21 e Evolution API v2
│   │   │   ├── modules/
│   │   │   │   ├── ai/           # Engine de IA (Claude/OpenAI), avaliador de calor e handoff
│   │   │   │   ├── messages/     # Ingestão idempotente (Deduplicação SHA256) e Outbox Pattern
│   │   │   │   ├── routing/      # Roteador com PostgreSQL Advisory Locks e Presença Tripla
│   │   │   │   └── media/        # Upload e deduplicação de mídia (imagens, áudios, PDFs)
│   │   │   ├── queue/            # Filas BullMQ e Workers (Inbound, Outbound, AI, Routing, Maintenance)
│   │   │   ├── realtime/         # Servidor Socket.IO com Redis Adapter clusterizável
│   │   │   ├── routes/           # Endpoints REST (Auth, Users, Convs, Messages, Channels, Webhooks, AI)
│   │   │   ├── server.ts         # Fastify API Server
│   │   │   └── worker.ts         # Processador assíncrono de background jobs
│   │
│   └── web/               # Frontend React 18 + Vite 6 + Tailwind CSS + Lucide + Zustand 5
│       └── src/
│           ├── components/       # NavigationSidebar, ConversationList, ChatArea, ContactInfo, TransferModal
│           ├── pages/            # Inbox (Atendimento), AdminLiveMonitor, TeamPage, DepartmentsPage, ChannelsPage, AiConfigPage
│           ├── stores/           # authStore, chatStore, presenceStore
│           └── services/         # api (Axios com refresh token) e socket (Socket.IO client)
│
├── docker-compose.yml     # Infraestrutura: PostgreSQL 16 (ICU pt-BR), Redis 7, Evolution API v2
├── tsconfig.base.json
└── package.json
```

---

## ⚡ Guia de Inicialização Rápida

### 1. Pré-requisitos
- **Node.js**: v20.x ou superior
- **npm**: v10.x ou v11.x
- **Docker & Docker Compose** (ou instâncias locais de PostgreSQL 16 e Redis 7)

### 2. Configuração de Variáveis de Ambiente
Copie o arquivo de exemplo para `.env`:
```bash
cp .env.example .env
```
Edite o arquivo `.env` com suas chaves de segurança (o arquivo já vem pré-configurado com valores padrão seguros para desenvolvimento local).

### 3. Iniciar Banco de Dados e Redis
Suba os containers essenciais via Docker:
```bash
docker compose up -d postgres redis
```
> *Nota: O PostgreSQL é inicializado com locale ICU `pt-BR` e UTF-8 para ordenação alfabética correta de nomes e produtos com acentuação.*

### 4. Instalar Dependências e Gerar o Prisma Client
```bash
npm install
npm run db:generate -w @crm/api
```

### 5. Executar as Migrações e Carregar Dados Iniciais (Seed)
```bash
# Aplica o schema no banco de dados PostgreSQL
npm run db:push -w @crm/api

# Popula o banco com a organização "Central Pneus", 3 departamentos, 4 usuários, persona da IA e atalhos rápidos
npm run db:seed -w @crm/api
```

### 6. Executar Testes Unitários
Para validar a suíte de testes de domínio (Normalização Telefônica do 9º Dígito, Matriz RBAC, Criptografia AES-256-GCM, Assinatura HMAC Meta e Avaliação Heurística de Leads):
```bash
npm run test -w @crm/api
```

### 7. Iniciar a Aplicação em Desenvolvimento
Você pode rodar os serviços simultaneamente ou em terminais separados:

**Opção A — Rodar tudo junto (Monorepo):**
```bash
npm run dev
```

**Opção B — Rodar em terminais dedicados (Recomendado para inspeção de logs):**
```bash
# Terminal 1 — API HTTP & WebSockets
npm run dev:api

# Terminal 2 — Worker de Filas BullMQ (Mensagens, IA e Roteamento)
npm run dev:worker

# Terminal 3 — Interface Web React (Vite)
npm run dev:web
```

Acesse a interface no navegador: **`http://localhost:5173`** (ou porta indicada pelo Vite).

---

## 🔑 Credenciais Padrão de Acesso (Ambiente de Testes)

O comando de seed cria os seguintes operadores pré-configurados:

| Cargo | Nome | E-mail | Senha Padrão |
|---|---|---|---|
| **Administrador / Dono** | Carlos Silva | `admin@centralpneus.com.br` | `AdminPassword123!` |
| **Vendedor (Pneus/Comercial)** | Lucas Atendente | `lucas@centralpneus.com.br` | `AgentPassword123!` |
| **Oficina / Serviços** | Marcos Mecânico | `marcos@centralpneus.com.br` | `AgentPassword123!` |
| **Financeiro** | Fernanda Financeiro | `fernanda@centralpneus.com.br` | `AgentPassword123!` |

> *A tela de login possui botões de acesso rápido com 1 clique para facilitar a alternância entre contas durante testes e demonstrações.*

---

## 📲 Configuração dos Canais de WhatsApp

O sistema suporta múltiplos canais cadastrados simultaneamente na tela **Canais de Atendimento**:

### 1. WhatsApp Oficial — Meta Cloud API (Recomendado para Produção)
1. Crie um aplicativo empresarial no portal [Meta for Developers](https://developers.facebook.com/).
2. Adicione o produto **WhatsApp**.
3. Obtenha o **Phone Number ID**, o **WABA ID** (WhatsApp Business Account ID) e o **Access Token Permanente** (System User Token com permissões `whatsapp_business_messaging` e `whatsapp_business_management`).
4. Cadastre o canal no painel do CRM:
   - **Tipo:** `WHATSAPP_CLOUD`
   - **Nome:** Ex: "WhatsApp Matriz Oficial"
   - **Phone Number ID:** Seu ID da Meta
   - **App Secret:** Chave secreta do app para validação de assinatura `x-hub-signature-256`
   - **Access Token:** Seu token permanente (armazenado com criptografia AES-256-GCM no banco)
5. Configure o Webhook no portal da Meta:
   - **URL de Retorno:** `https://seu-dominio.com.br/webhooks/whatsapp-cloud/{channelId}`
   - **Token de Verificação:** O `verifyToken` gerado pelo CRM para o canal.
   - **Campos assinados:** `messages`.

### 2. WhatsApp Contingência — Evolution API (QR Code)
Caso queira conectar um número imediatamente via QR Code antes da aprovação da conta comercial pela Meta:
1. Inicie o container da Evolution API:
   ```bash
   docker compose --profile evolution up -d
   ```
2. No CRM, cadastre um novo canal:
   - **Tipo:** `EVOLUTION_API`
   - **Instância:** `central-pneus-01`
   - **URL Base:** `http://localhost:8080` (ou URL pública do servidor)
   - **API Key:** A chave definida em `EVOLUTION_API_KEY`
3. Aponte a câmera do celular para o QR Code gerado na tela do CRM e conecte.

---

## 🤖 Inteligência Artificial & Triagem Automática

### Como funciona a IA do Central Pneus:
1. **Primeiro Contato:**  
   Toda mensagem de um número desconhecido ou conversa finalizada é recebida no status `BOT`.
2. **Contexto Automotivo:**  
   O prompt de sistema injetado no LLM (Claude 3.5 Sonnet ou GPT-4o-mini) especializa o assistente em:
   - **Medidas de pneus:** Ex: 175/70 R13, 205/55 R16, 225/45 R17, marcas (Pirelli, Michelin, Goodyear, Continental, etc.), aro e aplicação (passeio, SUV, carga).
   - **Serviços de autocenter:** Alinhamento computadorizado 3D, balanceamento de rodas, troca de pastilhas de freio, revisão de suspensão e montagem de pneus.
   - **Tom de voz:** Cordial, ágil, objetivo e em português brasileiro natural.
3. **Cálculo de Lead Warmth (0 a 100):**  
   A cada resposta do cliente, a IA avalia o nível de intenção de compra:
   - Informou medida do pneu ou modelo do carro: `+30 pontos`
   - Pediu cotação de valores ou disponibilidade de estoque: `+30 pontos`
   - Informou urgência ("preciso hoje", "estou na oficina"): `+25 pontos`
   - Mencionou serviços adicionais (alinhamento, montagem): `+15 pontos`
4. **Handoff Automático (`LEAD_QUALIFIED`):**  
   Assim que a pontuação atinge 60 (ou se o cliente disser explicitamente *"falar com atendente"* ou *"humano"*), o sistema:
   - Notifica o cliente que um consultor assumirá o atendimento;
   - Gera um **resumo estruturado do veículo e interesse do cliente**;
   - Altera o status para `OPEN`;
   - Executa o algoritmo de roteamento distribuindo para o atendente humano online menos sobrecarregado do departamento comercial.

---

## 🛡️ Robustez Técnica e Tratamento de Concorrência

- **Zero Perda de Mensagens (Outbox Pattern):** Todas as mensagens enviadas passam por uma tabela de outbox transacional antes do envio para as APIs da Meta/Evolution, com rotina de segurança (`maintenanceWorker`) para reenvio automático em caso de instabilidade de rede.
- **Roteamento Concorrente com PostgreSQL Advisory Locks:** Distribuição de conversas usa `pg_try_advisory_xact_lock` garantindo que dois atendentes nunca recebam o mesmo lead simultaneamente, mesmo sob milhares de webhooks por segundo.
- **Deduplicação de Webhooks:** Identificadores únicos (`wamid` da Meta ou `id` da Evolution) são checados via Redis e banco de dados relacional com restrição de unicidade para evitar mensagens duplicadas.
- **Presença Tripla de Atendentes:** O status do operador combina conexão WebSocket Socket.IO + Heartbeat a cada 30 segundos + timestamp de última atividade. Operadores sem heartbeat há mais de 2 minutos são marcados automaticamente como `AWAY` para não reterem filas.

---

## 📊 Atalhos Rápidos no Chat do Atendente

Ao digitar `/` no campo de texto do chat, uma janela de atalhos rápidos aparece instantaneamente:
- `/pneus` — Consulta de medidas e marcas disponíveis em estoque
- `/orcamento` — Modelo padrão de cotação com valor à vista e parcelado
- `/alinhamento` — Explicação do combo de alinhamento 3D + balanceamento
- `/horario` — Horário de funcionamento da loja e localização
- `/pix` — Dados e chave Pix oficial da Central Pneus para pagamento

---

## 📜 Licença e Propriedade

Desenvolvido com exclusividade para **Central Pneus**. Todos os direitos reservados.
