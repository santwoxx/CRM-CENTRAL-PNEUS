#!/usr/bin/env bash
# =============================================================================
# Preenche cada "TROCAR" do .env com um valor aleatorio forte.
#
#     cp .env.production.example .env && ./scripts/gerar-segredos.sh
#
# So substitui o que ainda esta como TROCAR - NUNCA regenera um segredo que ja
# tem valor. Regenerar depois do primeiro boot quebra coisas em silencio:
#   - POSTGRES_PASSWORD: o Postgres so le a senha ao criar o volume. Trocar
#     depois deixa o CRM sem acesso ao proprio banco.
#   - CREDENTIALS_ENCRYPTION_KEY: as credenciais de WhatsApp ja salvas ficam
#     ilegiveis.
#   - JWT_*: todo mundo e deslogado.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ARQ=.env
if [ ! -f "$ARQ" ]; then
  echo "Crie o .env antes:  cp .env.production.example .env" >&2
  exit 1
fi

# Hex nas senhas: entram em URLs de conexao, onde "@", "/" e ":" quebrariam.
hex() { openssl rand -hex "$1"; }
# A chave de criptografia exige exatamente 32 bytes em base64.
chave32() { openssl rand -base64 32 | tr -d '\n'; }

preencher() {
  local nome=$1 valor=$2
  if grep -q "^${nome}=TROCAR$" "$ARQ"; then
    # Delimitador "|": base64 usa "/" e "+", nunca "|".
    sed -i "s|^${nome}=TROCAR$|${nome}=${valor}|" "$ARQ"
    echo "  gerado   $nome"
  else
    echo "  mantido  $nome"
  fi
}

echo "Segredos em $ARQ:"
preencher POSTGRES_PASSWORD "$(hex 24)"
preencher REDIS_PASSWORD "$(hex 24)"
preencher JWT_ACCESS_SECRET "$(hex 32)"
preencher JWT_REFRESH_SECRET "$(hex 32)"
preencher CREDENTIALS_ENCRYPTION_KEY "$(chave32)"
preencher EVOLUTION_API_KEY "$(hex 24)"
preencher EVOLUTION_WEBHOOK_SECRET "$(hex 32)"

# So o dono le: e o arquivo que abre o banco e decifra os canais.
chmod 600 "$ARQ"

if grep -q "=TROCAR$" "$ARQ"; then
  echo "Ainda ha TROCAR no $ARQ:" >&2
  grep -n "=TROCAR$" "$ARQ" >&2
  exit 1
fi

echo
echo "Pronto. Guarde uma copia deste .env FORA do servidor (gerenciador de senhas)."
