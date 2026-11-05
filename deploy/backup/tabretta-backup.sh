#!/bin/bash
# NÁVRH zálohovacího skriptu (zadání sekce 9). NESPOUŠTĚT bez souhlasu uživatele;
# cílové úložiště mimo server (offsite) zatím není vybráno.
#
# Co dělá: pg_dump databáze tabretta (vlastní formát) + tar adresáře příloh
# do /var/backups/tabretta/RRRR-MM-DD_HHMMSS/, ponechá posledních KEEP_DAYS dní.
# Spouští root (např. systemd timer); připojení k DB bere z /etc/tabretta/tabretta.env.
#
# Obnova (ručně, po dohodě):
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" db.dump
#   tar -xzf uploads.tar.gz -C /var/lib/tabretta
set -euo pipefail

ENV_FILE=/etc/tabretta/tabretta.env
BACKUP_ROOT=/var/backups/tabretta
UPLOAD_PARENT=/var/lib/tabretta
KEEP_DAYS=14

umask 077
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

stamp=$(date +%Y-%m-%d_%H%M%S)
target="$BACKUP_ROOT/$stamp"
mkdir -p "$target"

pg_dump --format=custom --no-owner --file="$target/db.dump" "$DATABASE_URL"
tar -czf "$target/uploads.tar.gz" -C "$UPLOAD_PARENT" uploads
( cd "$target" && sha256sum db.dump uploads.tar.gz > SHA256SUMS )

# Rotace: smazat zálohy starší než KEEP_DAYS dní (jen adresáře ve tvaru data).
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_??????' -mtime +"$KEEP_DAYS" -exec rm -rf -- {} +

echo "Záloha hotová: $target"
