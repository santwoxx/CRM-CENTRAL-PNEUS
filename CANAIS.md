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

**Evolution** — pareia por QR Code. Em produção ela sobe junto com o CRM
(`--profile evolution`) e fica só na rede interna. Cadastre o canal com URL
base `http://evolution:8080`, a `EVOLUTION_API_KEY` do `.env` e a instância;
depois crie a instância e configure o webhook dela - o passo a passo, com os
comandos, está em [PRODUCAO.md](PRODUCAO.md#9-conectar-o-whatsapp).

O webhook da Evolution exige o token `EVOLUTION_WEBHOOK_SECRET`: sem ele, a
rota recusa tudo. A Evolution não assina o corpo como a Meta, e uma rota
aberta deixaria qualquer um injetar mensagens de "cliente" - cada uma
disparando resposta paga da IA.

## Cuidados com a campanha

**Disparo em massa é o que derruba número**, não o volume de atendimento.
Quem recebe mensagem sem ter pedido denuncia, e denúncia derruba a nota de
qualidade. Se a campanha leva o cliente a iniciar a conversa (clique no
anúncio, botão do site), o risco é bem menor.

**O descadastramento já funciona:** quem escreve "PARE" ou "SAIR" deixa de
receber qualquer mensagem - a barreira fica no envio, então nenhuma tela ou
automação consegue furar. Confira antes de rodar a campanha: quem pede para
sair e continua recebendo, denuncia.
