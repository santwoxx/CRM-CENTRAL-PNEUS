#!/usr/bin/env bash
# Sobe o ambiente local completo. Rode da raiz do projeto:
#   bash scripts/setup-local.sh
#
# Idempotente: pode rodar quantas vezes quiser.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 1/5 Procurando Postgres e Redis"

# Dois caminhos possiveis. O nativo e preferido quando existe: no Windows o
# Docker depende do WSL, que nem sempre sobe (em builds Insider chega a falhar
# de vez). Servico nativo nao tem essa fragilidade.
pg_ok=0
redis_ok=0

node -e "const n=require('net');const s=n.connect(5432,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)" 2>/dev/null && pg_ok=1
node -e "const n=require('net');const s=n.connect(6379,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)" 2>/dev/null && redis_ok=1

if [ "$pg_ok" = "1" ] && [ "$redis_ok" = "1" ]; then
  echo "    Postgres e Redis ja respondendo (servicos nativos)"
else
  echo "    Nao encontrei os dois; tentando pelo Docker"
  if ! docker info >/dev/null 2>&1; then
    echo ""
    echo "ERRO: nem servico nativo nem Docker disponivel."
    echo ""
    echo "  Opcao A (recomendada no Windows) - instalar nativo:"
    echo "    winget install PostgreSQL.PostgreSQL.17 --custom \"--mode unattended --superpassword crm_dev_password\""
    echo "    winget install Memurai.MemuraiDeveloper"
    echo ""
    echo "  Opcao B - Docker: abra o Docker Desktop e espere ficar verde."
    echo "    Se disser 'Virtualization support not detected', o WSL nao subiu."
    exit 1
  fi

  docker compose up -d postgres redis
  echo "    Aguardando o banco aceitar conexao..."
  for _ in $(seq 1 60); do
    status=$(docker inspect --format='{{.State.Health.Status}}' crm_postgres 2>/dev/null || echo starting)
    [ "$status" = "healthy" ] && break
    sleep 2
  done
  [ "${status:-}" = "healthy" ] || { echo "ERRO: Postgres nao ficou saudavel."; exit 1; }
fi

echo "==> 2/5 Conferindo o banco de dados"
node -e "const n=require('net');const s=n.connect(5432,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"   || { echo "ERRO: Postgres nao responde na porta 5432"; exit 1; }
echo "    ok"

echo "==> 3/5 Aplicando o schema e populando o catalogo"
npm run db:deploy
npm run db:seed

echo "==> 4/5 Preparando a IA local"
if command -v ollama >/dev/null 2>&1; then
  MODEL="${OLLAMA_CHAT_MODEL:-qwen2.5:7b-instruct}"
  echo "    Baixando o modelo ${MODEL} (so na primeira vez, ~4.7 GB)"
  ollama pull "$MODEL"
else
  echo "    Ollama nativo nao encontrado; usando o container:"
  docker compose --profile ia up -d
  docker compose exec -T ollama ollama pull qwen2.5:7b-instruct
fi

echo "==> 5/5 Tudo pronto"
cat <<'FIM'

Agora abra DOIS terminais:

  Terminal 1:  npm run dev
  Terminal 2:  cloudflared tunnel --url http://localhost:3333

Copie a URL https://....trycloudflare.com que o tunel imprimir e:

  1. No .env         -> PUBLIC_API_URL=<essa URL>
                        CORS_ORIGINS=https://crm-central-pneus-api.vercel.app
                        (reinicie o npm run dev depois de salvar)

  2. No Vercel       -> Settings > Environment Variables
                        VITE_API_URL=<essa URL>
                        e clique em Redeploy (a variavel entra no build)

Entre em https://crm-central-pneus-api.vercel.app com:

  admin@centralpneus.com.br / AdminPassword123!

FIM
