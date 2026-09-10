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

## O que dá para testar sem WhatsApp

O simulador injeta mensagens no **mesmo caminho** de um WhatsApp real:
resolução de contato, leitura da medida, consulta ao catálogo, resposta da
IA, fila e distribuição para atendente.

```bash
# 1. autentique
TOKEN=$(curl -s -X POST <LINK>/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@centralpneus.com.br","password":"AdminPassword123!"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 2. mande uma mensagem como se fosse um cliente
curl -X POST <LINK>/api/simulator/message \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"phone":"31999998888","name":"Cliente Teste","text":"Quanto custa o pneu 205/55R16?"}'
```

Roteiro pronto de demonstração: `GET <LINK>/api/simulator/roteiro`

### Mensagens que mostram bem o sistema

| Mensagem | O que acontece |
|---|---|
| `Quanto custa 205/55R16?` | Lê a medida e responde com preço e estoque reais |
| `Quero um jogo de 195/65R15` | Entende "jogo" = 4 e calcula o total |
| `Meu pneu está com bolha` | Trata como segurança e manda para a Oficina |
| `Quero falar com o financeiro` | Transfere direto, sem passar pela IA |
| `Meu carro é aro 16` | Pede a medida completa (aro sozinho não orça) |

Para ver a distribuição funcionando, entre com um atendente em outro
navegador e coloque-o como **online**: a conversa sai da fila e cai na tela
dele em tempo real.

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
