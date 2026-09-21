# Colocar o CRM no ar

Passo a passo para rodar em produção numa VM da Oracle Cloud (Always Free),
com HTTPS, backup e WhatsApp. Siga na ordem — cada passo depende do anterior.

**Tempo total:** 1 a 2 horas, fora a espera do DNS e a verificação da Meta.

---

## Antes de começar

| Precisa ter | Onde | Custo |
|---|---|---|
| Conta Oracle Cloud | cloud.oracle.com (pede cartão só para validar) | R$ 0 |
| Um domínio | Registro.br, Hostinger, Cloudflare… | ~R$ 40/ano |
| Chave da Groq (IA grátis) | console.groq.com → API Keys | R$ 0 |
| Chave da OpenAI (IA reserva, paga por uso) | platform.openai.com → API Keys | ~US$ 5–20/mês |
| O `.env` desta máquina | para copiar os valores do Firebase | — |

---

## 1. Criar a VM

No console da Oracle: **Compute → Instances → Create instance**.

- **Image:** Ubuntu 24.04 (a versão *aarch64*)
- **Shape:** `VM.Standard.A1.Flex` — **4 OCPU, 24 GB** (o limite gratuito inteiro)
- **Boot volume:** 100 GB
- **SSH keys:** *Generate a key pair* e **baixe a chave privada** — sem ela não há como entrar no servidor

Se aparecer *Out of capacity*, tente outro *Availability Domain* ou volte
algumas horas depois — é comum nas regiões de São Paulo.

> **Mude a conta para *Pay As You Go*** (Billing → Upgrade). Continua R$ 0
> dentro dos limites gratuitos, mas a Oracle **recupera instâncias gratuitas
> ociosas** de contas não atualizadas — e um CRM de loja passa a maior parte
> do tempo com a CPU baixa.

### Abrir as portas 80 e 443

São **duas** barreiras, e as duas precisam ser abertas:

1. **Na Oracle:** Networking → Virtual Cloud Networks → sua VCN → Security
   Lists → Default → *Add Ingress Rules*: origem `0.0.0.0/0`, TCP, portas
   `80` e `443`.
2. **No Ubuntu** (a imagem da Oracle vem com o iptables fechando tudo):

```bash
ssh -i chave-privada.key ubuntu@IP_DA_VM
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Não abra nenhuma outra porta. Banco, Redis e Evolution não precisam — e não
devem — ser alcançáveis de fora.

---

## 2. Apontar o domínio

No painel do seu domínio, crie um registro **A**:

| Tipo | Nome | Valor |
|---|---|---|
| A | `crm` | IP público da VM |

Se o DNS estiver na Cloudflare, deixe a nuvem **cinza** (*DNS only*).

Confira antes de seguir — o certificado HTTPS só é emitido quando o nome já
aponta para a VM:

```bash
nslookup crm.suaempresa.com.br     # tem que responder o IP da VM
```

---

## 3. Autorizar o domínio no Firebase

Console do Firebase → **Authentication → Settings → Authorized domains →
Add domain** → `crm.suaempresa.com.br`.

Sem isso, o botão do Google abre e fecha com erro.

---

## 4. Instalar o Docker na VM

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version            # tem que responder uma versão
```

---

## 5. Baixar e configurar

```bash
git clone https://github.com/santwoxx/CRM-CENTRAL-PNEUS.git
cd CRM-CENTRAL-PNEUS

cp .env.production.example .env
bash scripts/gerar-segredos.sh    # preenche todas as senhas e chaves
nano .env
```

Preencha no `.env`:

- `DOMINIO` — o endereço do passo 2
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
  `VITE_FIREBASE_APP_ID` — copie do `.env` desta máquina
- `GROQ_API_KEY` e `OPENAI_API_KEY`

Se o repositório for privado, o `git clone` pede usuário e um *Personal
Access Token* do GitHub (não a senha).

> **Guarde uma cópia do `.env` fora do servidor** (num gerenciador de
> senhas). Ele tem a chave que decifra as credenciais do WhatsApp salvas no
> banco: backup do banco sem ela não recupera os canais.

---

## 6. Subir

```bash
docker compose -f docker-compose.prod.yml --profile evolution up -d --build
```

A primeira vez leva de 5 a 10 minutos (compila tudo na VM). Acompanhe:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f preparar api
```

O `preparar` roda sozinho a cada deploy: aplica as migrações e, só no
primeiro boot, cria a organização, os setores, a persona da IA e o seu acesso.
A API só sobe depois que ele termina bem.

Abra `https://crm.suaempresa.com.br` e entre com o Google.

---

## 7. Montar a equipe

**Equipe & Cargos → Novo Membro**, para cada pessoa da loja:

- o **e-mail tem que ser a conta Google** que ela vai usar para entrar;
- marque **pelo menos um setor** — sem setor, a pessoa não recebe conversa.

> **Cuidado com dois caminhos para a mesma coisa.** A equipe também pode ser
> definida em `packages/api/src/config/acessos.ts` com `npm run acessos`. Esse
> comando **revoga quem não está no arquivo** — inclusive quem você cadastrou
> pela tela. Em produção, use a tela.

---

## 8. Catálogo: o modo de lançamento

O sistema sobe **sem catálogo**. Nesse modo a IA identifica o que o cliente
quer (veículo, medida, quantidade), **não cita preço nem diz que falta
estoque**, e passa para o vendedor, que cota.

Não existe ainda tela para cadastrar pneus e preços. Até existir, este é o
modo seguro: IA cotando preço errado é pior que IA que passa a bola.

---

## 9. Conectar o WhatsApp

### Número secundário (Evolution, via QR Code)

1. No CRM: **Canais WhatsApp → novo canal Evolution**
   - URL base: `http://evolution:8080`
   - API Key: o valor de `EVOLUTION_API_KEY` do `.env`
   - Instância: `central-pneus`
2. Copie o **ID do canal** que aparece no card.
3. Na VM, crie a instância e diga para onde ela entrega as mensagens
   (troque `ID_DO_CANAL`):

```bash
cd ~/CRM-CENTRAL-PNEUS && set -a && . ./.env && set +a
CANAL=ID_DO_CANAL

curl -s -X POST http://127.0.0.1:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json' \
  -d '{"instanceName":"central-pneus","integration":"WHATSAPP-BAILEYS","qrcode":true}'

curl -s -X POST http://127.0.0.1:8080/webhook/set/central-pneus \
  -H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"webhook\":{\"enabled\":true,\"url\":\"http://api:3333/webhooks/evolution/$CANAL?token=$EVOLUTION_WEBHOOK_SECRET\",\"byEvents\":false,\"base64\":false,\"events\":[\"MESSAGES_UPSERT\",\"MESSAGES_UPDATE\",\"CONNECTION_UPDATE\"]}}"
```

4. No CRM, **Testar Conexão** no card → aparece o QR Code → leia com o
   WhatsApp do número secundário.
5. **Mande uma mensagem de outro celular** e confira se ela aparece no
   Atendimento. Se não aparecer:
   `docker compose -f docker-compose.prod.yml logs api | grep -i evolution`.
   Um `Token invalido` indica URL do webhook errada no passo 3.

> O canal Evolution **nunca foi exercitado de ponta a ponta** — o passo 5 é o
> primeiro teste real. Se o QR Code não aparecer, a versão da imagem pode
> estar desatualizada em relação ao WhatsApp: troque `atendai/evolution-api`
> no `docker-compose.prod.yml` pela versão mais recente.

### Número principal (API oficial da Meta)

Exige a verificação da empresa na Meta, que leva de dias a semanas. Detalhes
em [CANAIS.md](CANAIS.md). No card do canal aparecem a **URL do webhook** e,
no formulário de criação, o **Verify Token** para colar no painel da Meta.

> Sem **templates** aprovados, a API oficial não deixa mandar mensagem para
> quem não falou com você nas últimas 24h. O CRM ainda não tem tela de
> templates.

---

## 10. Backup

```bash
bash scripts/backup.sh            # teste agora; tem que terminar com "ok"
crontab -e
```

Acrescente (todo dia às 3h15):

```
15 3 * * * /home/ubuntu/CRM-CENTRAL-PNEUS/scripts/backup.sh >> /home/ubuntu/backup-crm.log 2>&1
```

**Backup no mesmo servidor não protege contra perder o servidor.** Para mandar
uma cópia para o seu Google Drive:

```bash
curl https://rclone.org/install.sh | sudo bash
rclone config        # crie um remote chamado "gdrive" do tipo Google Drive
```

Como a VM não tem navegador, o `rclone config` pede para rodar
`rclone authorize "drive"` no seu computador e colar o resultado. Depois,
troque a linha do cron por:

```
15 3 * * * BACKUP_RCLONE_DESTINO=gdrive:backups-crm /home/ubuntu/CRM-CENTRAL-PNEUS/scripts/backup.sh >> /home/ubuntu/backup-crm.log 2>&1
```

### Restaurar — teste uma vez antes de precisar

```bash
C="docker compose -f docker-compose.prod.yml"
$C stop api worker
$C exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < ~/backups-crm/crm-AAAAMMDD-HHMMSS.dump
$C start api worker
```

---

## 11. Atualizar para uma versão nova

```bash
cd ~/CRM-CENTRAL-PNEUS
bash scripts/backup.sh            # sempre antes
git pull
docker compose -f docker-compose.prod.yml --profile evolution up -d --build
```

As migrações rodam sozinhas. Se alguma falhar, a API antiga continua de pé e
a nova não sobe — veja `logs preparar`.

---

## 12. Saber quando cai

Cadastre `https://crm.suaempresa.com.br/health/ready` num monitor gratuito
(UptimeRobot, a cada 5 min). Ele responde 200 quando banco e Redis estão bem
e 503 quando não — você sabe antes do cliente reclamar.

---

## Antes de anunciar o número

- [ ] `https://` abre com cadeado e o login com Google funciona
- [ ] Cada atendente já entrou uma vez e tem setor
- [ ] Mensagem de outro celular: chega, a IA responde, transfere, o atendente
      responde e o cliente recebe
- [ ] Áudio de teste vai direto para um humano
- [ ] "PARE" descadastra, e o cliente não recebe mais nada
- [ ] O backup rodou **e a restauração foi testada**
- [ ] O `.env` está guardado fora do servidor
- [ ] O monitor de disponibilidade está ativo
