#!/usr/bin/env bash
# Sobe o ambiente local completo. Rode da raiz do projeto:
#   bash scripts/setup-local.sh
#
# Idempotente: pode rodar quantas vezes quiser.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 1/5 Verificando Docker"
if ! docker info >/dev/null 2>&1; then
  echo "ERRO: o Docker nao esta respondendo."
  echo "      Abra o Docker Desktop e espere o icone ficar verde."
  echo "      Se disser 'Virtualization support not detected', o WSL ainda"
  echo "      nao foi ativado: reinicie o computador."
  exit 1
fi
echo "    Docker ok"

echo "==> 2/5 Subindo Postgres e Redis"
docker compose up -d postgres redis

echo "    Aguardando o banco aceitar conexao..."
for _ in $(seq 1 60); do
  status=$(docker inspect --format='{{.State.Health.Status}}' crm_postgres 2>/dev/null || echo starting)
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "${status:-}" = "healthy" ] || { echo "ERRO: Postgres nao ficou saudavel a tempo."; exit 1; }
echo "    Postgres pronto"

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
