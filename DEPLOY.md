# Onde hospedar sem pagar nada

Este guia cobre as opções realistas de deploy com **custo zero**, e o que
cada uma cobra de você em troca.

## O que precisa ficar de pé

| Peça | O que é | Pode dormir? |
|---|---|---|
| **API** | Fastify: recebe webhook do WhatsApp e serve o painel | ❌ Nunca |
| **Worker** | Processa fila, IA, roteamento e envio | ❌ Nunca |
| **PostgreSQL** | Conversas, contatos, catálogo | ❌ Nunca |
| **Redis** | Fila e tempo real | ❌ Nunca |
| **Frontend** | React estático | ✅ Sim (é só arquivo) |
| **IA** | Ollama local | ✅ Sim (sob demanda) |

> ⚠️ **O detalhe que elimina metade das opções gratuitas:** a API precisa
> responder o webhook da Meta em segundos, 24h por dia. Hospedagem grátis que
> "hiberna" após inatividade (Render free, por exemplo) demora 30-60s para
> acordar. A Meta reentrega algumas vezes e depois desiste — **mensagem de
> cliente perdida**. Por isso as opções abaixo estão ordenadas por
> confiabilidade, não por facilidade.

---

## Opção 1 — Na sua máquina + Cloudflare Tunnel ⭐ recomendada para começar

**Custo: R$ 0,00 de verdade. Sem cartão de crédito.**

Tudo roda no seu PC. O Cloudflare Tunnel expõe a API na internet com HTTPS
válido e domínio fixo, sem abrir porta no roteador e sem IP fixo.

```bash
# 1. Suba a infraestrutura
docker compose up -d postgres redis

# 2. Suba a IA local (gratuita, roda na sua máquina)
docker compose --profile ia up -d
docker compose exec ollama ollama pull qwen2.5:7b-instruct

# 3. Prepare o banco
npm run db:deploy && npm run db:seed

# 4. Suba a aplicação
npm run dev
```

Depois, para o WhatsApp conseguir te alcançar:

```bash
# Instale: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3333
```

Ele devolve uma URL `https://algo-aleatorio.trycloudflare.com`. Coloque em
`PUBLIC_API_URL` no `.env` e cadastre `<URL>/webhooks/whatsapp` no painel da
Meta.

Para uma URL **fixa** (a de cima muda a cada reinício), crie um túnel nomeado —
continua grátis, só exige uma conta Cloudflare e um domínio seu:

```bash
cloudflared tunnel login
cloudflared tunnel create crm-pneus
cloudflared tunnel route dns crm-pneus crm.seudominio.com.br
cloudflared tunnel run --url http://localhost:3333 crm-pneus
```

| ✅ A favor | ❌ Contra |
|---|---|
| Zero custo, sem cartão | O PC precisa ficar ligado |
| Dados 100% seus | Depende da sua internet |
| IA local ilimitada e privada | Queda de luz derruba o atendimento |
| Hardware que você já tem | |

**Para quem é:** validar o sistema, operar com 1-3 atendentes, ou rodar num
PC/mini-PC que já fica ligado na loja.

---

## Opção 2 — Oracle Cloud Always Free ⭐ melhor para produção sem custo

**Custo: R$ 0,00 permanente.** Exige cartão só para validação de identidade —
a camada *Always Free* não expira e não é cobrada.

A oferta é generosa o bastante para rodar **tudo, inclusive a IA**:

- 4 vCPU ARM Ampere + **24 GB de RAM**
- 200 GB de disco
- 10 TB de tráfego/mês
- IP público fixo

```bash
# Na VM (Ubuntu 22.04 ARM):
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker

git clone <seu-repositorio> && cd crm-central-pneus
cp .env.example .env && nano .env      # ajuste segredos e PUBLIC_API_URL

docker compose --profile app --profile ia up -d
docker compose exec ollama ollama pull qwen2.5:7b-instruct
docker compose exec api npm run db:deploy -w @crm/api
docker compose exec api npm run db:seed -w @crm/api
```

Para o HTTPS (a Meta exige certificado válido), use Caddy — ele emite e renova
o certificado Let's Encrypt sozinho, de graça.

| ✅ A favor | ❌ Contra |
|---|---|
| Sempre ligado, sem hibernar | Cadastro exige cartão (sem cobrança) |
| 24 GB de RAM roda IA confortável | Instância ARM às vezes falta na região |
| IP fixo e tráfego generoso | Você administra o servidor |

**Para quem é:** operação real, vários atendentes, sem depender do PC da loja.

---

## Opção 3 — Híbrido em camadas gratuitas de nuvem

Cada peça num serviço grátis diferente. Funciona, mas some com a simplicidade
do `docker compose` e cada serviço tem seu próprio limite.

| Peça | Serviço | Limite gratuito |
|---|---|---|
| PostgreSQL | **Neon** | ~0,5 GB, hiberna e acorda rápido |
| Redis | **Upstash** | ~10 mil comandos/dia |
| Frontend | **Cloudflare Pages** | Ilimitado na prática |
| API + Worker | **Fly.io** | Pequena cota mensal de VM |
| IA | **Groq** ou **Gemini** | Limite diário/por minuto |

```bash
# .env para este cenário
DATABASE_URL=postgresql://...neon.tech/crm?sslmode=require
REDIS_URL=rediss://...upstash.io:6379
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...
```

> ⚠️ **Cuidado com o limite do Redis.** O CRM usa Redis para fila, presença e
> tempo real — são muitos comandos por mensagem. 10 mil comandos/dia acaba
> rápido com movimento real. Meça antes de confiar.

**Para quem é:** quem não quer administrar servidor e aceita monitorar limites.

---

## Onde **não** hospedar

| Serviço | Por quê |
|---|---|
| **Render (free)** | Hiberna após 15 min parado. Acorda em ~50s e **perde webhook**. |
| **Heroku (free)** | Não existe mais camada gratuita. |
| **Vercel / Netlify (backend)** | Serverless: sem processo longo, sem WebSocket, sem worker de fila. Servem só o frontend. |
| **Replit / Glitch** | Hibernam e reiniciam sozinhos. |

O frontend pode ir para Vercel/Netlify sem problema — ele é estático. O que
não pode ir para lá é a **API/worker**.

---

## A IA: qual escolher

Configure em `AI_PROVIDER` no `.env`.

| Provedor | Custo | Onde roda | Quando usar |
|---|---|---|---|
| `ollama` | R$ 0 | Sua máquina | **Padrão.** Privado, offline, sem limite |
| `lmstudio` | R$ 0 | Sua máquina | Igual, com interface gráfica |
| `groq` | R$ 0* | Nuvem | PC fraco; muito rápido |
| `google` | R$ 0* | Nuvem | Gemini, cota diária folgada |
| `openrouter` | R$ 0* | Nuvem | Modelos com sufixo `:free` |
| `openai` / `anthropic` | Pago | Nuvem | Quando qualidade importar mais que custo |
| `disabled` | R$ 0 | — | Sem IA: tudo vai direto para a fila humana |

`(*)` Camada gratuita com limite de uso. Não pede cartão.

### Escolhendo o modelo local pela sua memória RAM

```bash
ollama pull llama3.2:3b            # 4 GB de RAM  - responde rápido, mais simples
ollama pull qwen2.5:7b-instruct    # 8 GB de RAM  - recomendado, bom português
ollama pull qwen2.5:14b-instruct   # 16 GB de RAM - melhor qualidade
```

Sem placa de vídeo funciona: o modelo roda na CPU, só demora mais (por isso o
timeout do provedor local é de 3 minutos, contra 45s da nuvem).

> **Por que um modelo pequeno é suficiente aqui:** o preço, o estoque e a
> medida do pneu são extraídos por **código**, não pela IA (`skills/`). O
> modelo só escreve a frase em português. Ele não tem como errar um preço
> porque nunca é ele quem calcula o preço.

---

## Custo do WhatsApp em si

O CRM é gratuito, mas o canal tem regras próprias:

- **WhatsApp Cloud API (oficial):** a Meta cobra por categoria de conversa e
  mudou essa política mais de uma vez. Conversas iniciadas pelo cliente
  costumam ter condição bem mais favorável que disparos de marketing.
  **Confirme a tabela vigente** em `developers.facebook.com/docs/whatsapp/pricing`
  antes de projetar custo — não confie em número decorado, incluindo o meu.
- **Evolution API (não oficial):** não paga nada à Meta, mas **viola os termos
  de uso** e o número pode ser banido sem aviso. Está implementado como
  contingência, não como plano principal.

---

## Resumo

```
Só testar / loja pequena  ->  Opção 1 (sua máquina + Cloudflare Tunnel)
Operação real sem custo   ->  Opção 2 (Oracle Always Free)
Não quer servidor         ->  Opção 3 (híbrido, de olho nos limites)
```

Comece pela **Opção 1**: sobe em minutos, custa nada e nada impede de migrar
para a Opção 2 depois — é o mesmo `docker-compose.yml`.
