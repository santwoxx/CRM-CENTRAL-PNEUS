#!/usr/bin/env bash
# =============================================================================
# Backup do banco do CRM.
#
#     ./scripts/backup.sh
#
# Agende todo dia (crontab -e):
#     15 3 * * * /home/ubuntu/CRM-CENTRAL-PNEUS/scripts/backup.sh >> /home/ubuntu/backup-crm.log 2>&1
#
# Backup que fica so no mesmo servidor nao protege contra perder o servidor.
# Defina BACKUP_RCLONE_DESTINO (ex.: "gdrive:backups-crm") para mandar uma
# copia para fora - PRODUCAO.md explica como configurar o rclone.
#
# O banco sozinho NAO basta para restaurar tudo: as credenciais dos canais
# estao cifradas com CREDENTIALS_ENCRYPTION_KEY, que mora no .env. Guarde o
# .env em outro lugar.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DESTINO="${BACKUP_DIR:-$HOME/backups-crm}"
MANTER_DIAS="${BACKUP_DIAS:-14}"
COMPOSE=(docker compose -f docker-compose.prod.yml)

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"

ARQ="$DESTINO/crm-$(date +%Y%m%d-%H%M%S).dump"

"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$ARQ.parcial"

# Um dump vazio ou truncado nunca pode ocupar o lugar de um backup bom: um
# backup que "roda todo dia" e nao restaura e pior que nenhum, porque ninguem
# desconfia dele.
if [ ! -s "$ARQ.parcial" ]; then
  echo "$(date -Is) ERRO: dump vazio" >&2
  rm -f "$ARQ.parcial"
  exit 1
fi
if ! "${COMPOSE[@]}" exec -T postgres pg_restore --list < "$ARQ.parcial" > /dev/null; then
  echo "$(date -Is) ERRO: dump ilegivel" >&2
  rm -f "$ARQ.parcial"
  exit 1
fi
mv "$ARQ.parcial" "$ARQ"
chmod 600 "$ARQ"

find "$DESTINO" -name 'crm-*.dump' -mtime +"$MANTER_DIAS" -delete

if [ -n "${BACKUP_RCLONE_DESTINO:-}" ]; then
  rclone copy "$ARQ" "$BACKUP_RCLONE_DESTINO"
  echo "$(date -Is) copia externa em $BACKUP_RCLONE_DESTINO"
fi

echo "$(date -Is) ok $(du -h "$ARQ" | cut -f1) $ARQ"
