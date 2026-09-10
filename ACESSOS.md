# Quem pode entrar no CRM

## Onde o acesso é controlado

**No arquivo [`packages/api/src/config/acessos.ts`](packages/api/src/config/acessos.ts).**

Não é no Firebase. O login com Google prova **quem** a pessoa é; essa lista
decide **se ela entra e o que pode fazer**. Um e-mail fora dela recebe
"não está cadastrado" e não passa, mesmo com conta Google válida.

## Como liberar alguém

1. Abra `packages/api/src/config/acessos.ts`
2. Acrescente a pessoa:

```ts
{
  email: 'fulano@gmail.com',
  nome: 'Fulano de Tal',
  cargo: UserRole.AGENT,
  setores: ['vendas'],
  maxConversas: 5,
},
```

3. Aplique:

```bash
npm run acessos
```

O comando cria quem falta, corrige o cargo de quem mudou e **desativa quem
saiu da lista**. É assim que uma demissão vira bloqueio de acesso.

> O usuário não é apagado, só desativado. Apagar levaria junto a autoria das
> mensagens que ele enviou, e o histórico do cliente ficaria com buracos.

## Os quatro cargos

| Cargo | O que pode |
|---|---|
| `OWNER` | Tudo. Único que mexe em outros administradores. |
| `ADMIN` | Configura setores, equipe, canais e IA. Vê todas as conversas ao vivo. Apaga conversa. Vê auditoria. |
| `SUPERVISOR` | Vê e distribui as conversas dos setores dele. Acompanha a equipe. **Não** configura o sistema. |
| `AGENT` | Atende. Vê as próprias conversas e a fila dos setores dele. |

Os setores existentes são `vendas`, `financeiro` e `oficina` (o campo `slug`
em Setores & Menus).

A lista completa de permissões por cargo está em
[`packages/shared/src/permissions.ts`](packages/shared/src/permissions.ts) — é
uma fonte única, usada pelo backend para autorizar e pelo painel para esconder
o que a pessoa não pode fazer. **Quem bloqueia de verdade é o servidor**: a
interface apenas esconde.

## Exemplos

```ts
// Só administra, não atende
{ email: 'gerente@empresa.com', nome: 'Gerente', cargo: UserRole.ADMIN },

// Só atende, e só o setor de vendas
{ email: 'vendedor@empresa.com', nome: 'Vendedor', cargo: UserRole.AGENT,
  setores: ['vendas'], maxConversas: 5 },

// Supervisiona vendas e oficina, sem poder configurar o sistema
{ email: 'supervisor@empresa.com', nome: 'Supervisor', cargo: UserRole.SUPERVISOR,
  setores: ['vendas', 'oficina'] },
```

## Pelo painel, sem mexer em código

**Equipe & Cargos** no menu (só para ADMIN e OWNER) faz o mesmo: criar
pessoa, trocar cargo, ativar e desativar.

Use o arquivo quando quiser a lista versionada no Git — aí ela vira registro
de quem teve acesso e quando, revisável em code review.

## Sobre o Firestore

As regras em [`firestore.rules`](firestore.rules) e
[`storage.rules`](storage.rules) **negam tudo**, de propósito.

O CRM não usa nenhum dos dois: conversas, contatos, catálogo e usuários estão
no PostgreSQL; as mídias ficam no armazenamento da própria aplicação.

Elas existem por higiene: ao ativar o Firestore, o Console oferece o "modo de
teste", que libera leitura e escrita para qualquer pessoa da internet por 30
dias. Um banco aberto no seu projeto é risco real mesmo sem uso.

Para aplicar: **Console do Firebase → Firestore Database → Regras** → cole o
conteúdo do arquivo → Publicar. Idem em **Storage → Regras**.
