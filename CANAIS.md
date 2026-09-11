# Dois números ao mesmo tempo

O sistema atende vários números simultaneamente. Cada canal tem **webhook
próprio**, e as conversas nunca se misturam.

## O arranjo recomendado

| Número | Canal | Uso |
|---|---|---|
| **Principal** | WhatsApp Cloud API (oficial) | Atendimento do dia a dia |
| **Secundário** | Evolution (QR Code) | Campanha de tráfego pago |

A razão de separar: o Evolution não é homologado pela Meta e o número pode ser
banido. Num número de campanha isso é um custo aceitável — você troca e segue.
No número da fachada, seria perder o telefone da loja.

## Como o sistema mantém separado

Cada canal recebe em um endereço distinto:

```
/webhooks/whatsapp-cloud/<id-do-canal>
/webhooks/evolution/<id-do-canal>
```

Conversa, mensagem e atribuição carregam o `channelId`. Na caixa de entrada dá
para filtrar por canal, então a campanha não polui o atendimento normal.

**O cliente continua sendo um só.** Se a mesma pessoa falar nos dois números,
o sistema reconhece pelo telefone e mantém um contato único — com as conversas
separadas, mas o histórico comercial unificado. É o que você quer: o vendedor
vê que aquele lead da campanha já é cliente antigo.

## Cadastrando

Painel → **Canais WhatsApp** → Adicionar.

**Oficial** — pede `accessToken`, `phoneNumberId`, `appSecret` e
`verifyToken`, todos do painel da Meta. Depois cadastre o endereço do webhook
lá, com o `verifyToken` que você definiu aqui.

**Evolution** — sobe o container e pareia por QR Code:

```bash
docker compose --profile evolution up -d
```

Cadastre o canal com `baseUrl`, `apiKey` e `instance`. O QR Code aparece na
própria tela de Canais quando o status estiver desconectado.

## Cuidados com a campanha

**Disparo em massa é o que derruba número**, não o volume de atendimento.
Quem recebe mensagem sem ter pedido denuncia, e denúncia derruba a nota de
qualidade. Se a campanha leva o cliente a iniciar a conversa (clique no
anúncio, botão do site), o risco é bem menor.

**O descadastramento ainda não existe** no sistema — está na lista de
bloqueadores. Antes de rodar campanha, ele precisa existir: quem pede "PARE"
e continua recebendo, denuncia.
