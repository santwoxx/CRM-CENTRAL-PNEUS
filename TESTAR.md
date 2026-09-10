# Como colocar o sistema no ar para testar

## Um comando

```powershell
powershell -ExecutionPolicy Bypass -File scripts\iniciar.ps1
```

Ele confere os serviços, sobe API e worker, abre o túnel e imprime o link
para compartilhar. Deixe a janela aberta.

## Contas de teste

| Conta | Senha | Papel |
|---|---|---|
| `admin@centralpneus.com.br` | `AdminPassword123!` | Administrador (vê tudo) |
| `carlos@centralpneus.com.br` | `Atendente123!` | Atendente — Vendas |
| `mariana@centralpneus.com.br` | `Atendente123!` | Atendente — Financeiro |
| `roberto@centralpneus.com.br` | `Atendente123!` | Atendente — Oficina |

## Como testar: cliente mandando mensagem

Entre no painel e clique em **Simulador** no menu lateral.

A tela tem duas partes:

- **Esquerda — o celular do cliente.** Escreva ali como se fosse o cliente no
  WhatsApp. As respostas da IA, do atendente e do sistema aparecem na hora.
- **Direita — o que o sistema entendeu.** Mostra a medida que ele leu, a
  quantidade, o veículo, a intenção, a nota do lead, o setor e quem assumiu.

Há botões com mensagens prontas; clicar já envia.

> A mensagem percorre exatamente o mesmo caminho de um WhatsApp real:
> resolução de contato, leitura da medida, consulta ao catálogo, resposta da
> IA, fila e distribuição. A única diferença é que nada sai para a internet.

### Roteiro que mostra bem o sistema

| Escreva | O que deve acontecer |
|---|---|
| `Bom dia! Vocês têm pneu 205/55 R16?` | Responde com preço e estoque **reais** do catálogo |
| `Quero um jogo de 195/65R15` | Entende que "jogo" são 4 e soma o total |
| `Meu carro é aro 16, tem pneu?` | Pede a medida completa — aro sozinho não orça |
| `Meu pneu está com uma bolha na lateral` | Trata como segurança e manda para a Oficina |
| `Quero falar com o financeiro` | Transfere direto, sem passar pela IA |
| `Quanto custa alinhamento?` | Traz a tabela de serviços |

O ícone de recarregar, no topo do celular, apaga o contato e recomeça do zero.
Trocar o número de telefone cria um cliente diferente.

### Vendo a distribuição funcionar

1. Abra o painel em **outro navegador** (ou aba anônima) e entre como
   `carlos@centralpneus.com.br` / `Atendente123!`
2. Deixe o status dele como **online**
3. Volte ao simulador e mande uma mensagem

A conversa sai da fila e cai na tela do Carlos em tempo real. É assim que
funciona com WhatsApp de verdade — só o transporte muda.

## Pontos que você precisa saber

**O link muda a cada reinício.** O túnel gratuito sorteia um endereço novo.
Rode o script de novo e reenvie o link — não precisa rebuildar nem
reconfigurar nada, porque o painel é servido pelo próprio backend.

**Enquanto o PC estiver desligado, ninguém acessa.** Para uso contínuo sem
custo, veja a Opção 2 do `DEPLOY.md` (Oracle Always Free).

**A IA roda local e é gratuita.** Primeira resposta pode levar de 30 a 90
segundos porque o modelo carrega na memória; depois fica mais rápido.

**Os preços do catálogo são de exemplo.** Troque pelos reais antes de
atender cliente de verdade.

## Login com Google

Já está implementado. Para ativar, faltam dois passos no Firebase Console:

1. *Authentication → Sign-in method* → ativar **Google**
2. *Authentication → Settings → Authorized domains* → adicionar o domínio do
   link (o `trycloudflare.com` muda a cada vez, então na prática o Google só
   compensa quando houver domínio fixo)

Por padrão só entra quem já está cadastrado — o Google substitui a senha,
não a autorização. Para liberar cadastro automático em teste, use
`GOOGLE_AUTO_PROVISION=true` no `.env`.
