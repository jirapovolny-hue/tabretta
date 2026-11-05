# Požadavky na správce (VPS admin)

Nejnovější dole. Formát: co, proč, jak ověřit.

---

## R1 (2026-11-05): testovací databáze `tabretta_dev`

**Co:**
1. V PostgreSQL vytvořit roli `tabretta_dev` (LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE) s náhodným heslem.
2. Vytvořit databázi `tabretta_dev` s vlastníkem `tabretta_dev` (kódování UTF8). Roli stačí práva vlastníka této databáze, k jiným databázím (`gomappin`, `diag`, `tabretta`) nesmí mít přístup.
3. Vytvořit soubor `/home/dev01/.config/tabretta/test.env` (vlastník `dev01`, oprávnění 600, adresář 700) s jediným řádkem:
   `TEST_DATABASE_URL=postgres://tabretta_dev:<heslo>@127.0.0.1:5432/tabretta_dev`

Rozšíření PostgreSQL nepotřebuju. Migrace používají jen běžné typy (`bigint GENERATED ALWAYS AS IDENTITY`, `timestamptz`, `numeric`, `text`).

**Proč:** testy API a oddělení dat podle uživatele (zadání sekce 8, fáze 2) a lokální spuštění aplikace. Testy si v databázi vytvářejí tabulky migracemi a mezi běhy je mažou, takže to musí být samostatná databáze, ne produkční `tabretta`.

**Jak ověřit:**
- `stat -c '%a %U' ~/.config/tabretta/test.env` vrátí `600 dev01`
- pod `dev01`: `set -a; . ~/.config/tabretta/test.env; psql "$TEST_DATABASE_URL" -c 'select current_user, current_database()'` vrátí `tabretta_dev | tabretta_dev`
- `psql "$TEST_DATABASE_URL" -d gomappin -c 'select 1'` musí selhat

---

## R2 (2026-11-05): závislosti (npm), jen informace ke schválení

Instalace `npm ci --omit=dev --ignore-scripts` z `package-lock.json`. Verze jsou přesné a vybrané tak, aby byly vydané aspoň 14 dní před přidáním (`npm install --before`). Výjimka jsou bezpečnostní opravy podle `npm audit`: `multer@2.5.0` a tranzitivní `body-parser@2.4.0` (obojí DoS, GHSA-q7qp-rjg7-q26m a GHSA-27r3-jxmh-p828). Žádný balíček v lockfilu nemá install skript (`hasInstallScript` se v `package-lock.json` nevyskytuje) ani nativní kompilaci. `npm audit`: 0 zranitelností.

| Balíček | Proč |
|---|---|
| `express` | HTTP server a routování (zadání sekce 3) |
| `pg` | ovladač PostgreSQL, čisté JS (volitelný nativní `pg-native` se neinstaluje) |
| `express-session` | session v cookie |
| `connect-pg-simple` | ukládá session do PostgreSQL, aby přežily restart služby |
| `bcryptjs` | hashování hesel, čisté JS (žádná nativní kompilace na ARM) |
| `helmet` | bezpečnostní hlavičky a CSP |
| `express-rate-limit` | omezení počtu pokusů o přihlášení |
| `multer` | nahrávání příloh (multipart), soubory jdou rovnou do `UPLOAD_DIR` |

`dotenv` nepoužívám: v produkci proměnné načte systemd přes `EnvironmentFile=`, pro vývoj stačí vestavěné `node --env-file`. Testy běží na vestavěném `node --test`, vývojové závislosti nejsou žádné.

---

## R3 (2026-11-05): první nasazení Tabretty, commit `5a0ebde`

**Co:** nasadit commit `5a0ebde` (snapshot přes `git archive`) podle `deploy/README.md`:
1. Jednorázová příprava: systémový účet `tabretta`, adresáře `/opt/tabretta`, `/etc/tabretta`, `/var/lib/tabretta/uploads`, role `tabretta_user` (ne superuživatel) a databáze `tabretta` s jejím vlastnictvím, `/etc/tabretta/tabretta.env` (`root:tabretta`, 640; `PORT=3100`, `DATABASE_URL`, `SESSION_SECRET` z `openssl rand -hex 32`, `UPLOAD_DIR=/var/lib/tabretta/uploads`; `COOKIE_SECURE` nenastavovat).
2. `npm ci --omit=dev --ignore-scripts`, migrace pod `tabretta_user` (`node scripts/migrate.js`).
3. Služba podle `deploy/systemd/tabretta.service` (sandbox, zapisuje jen do uploads). Projdi prosím volby sandboxu. Vynechal jsem `MemoryDenyWriteExecute` (V8 JIT), `ProcSubset=pid` a `~@resources` (Node si při startu zvedá `RLIMIT_NOFILE`).
4. nginx podle `deploy/nginx/tabretta.conf` (`client_max_body_size 30m`, hlavičky `X-Forwarded-*`), `nginx -t`, reload. `dig +short tabretta.blbadomena.cz` má vrátit `79.76.102.155`, pak `certbot --nginx -d tabretta.blbadomena.cz` a `certbot renew --dry-run`.
5. Účet pro uživatele přes `scripts/create-user.js` interaktivně, heslo zadá uživatel sám (min. 12 znaků).
6. Zálohovací skript `deploy/backup/tabretta-backup.sh` je jen návrh, **nespouštět** ani neplánovat.

**Proč:** fáze 2 je hotová. Uživatel bude frontend testovat ručně na nasazené verzi (na serveru není prohlížeč pro automatický test UI).

**Stav před nasazením:** `npm test` 38/38 (API, oddělení dat dvou uživatelů, přílohy, migrace, přístup ke stránkám), `npm audit` 0 zranitelností, `git status` čistý, v lockfilu žádné install skripty.

**Jak ověřit:**
- `systemctl is-active tabretta` vrátí `active` a `journalctl -u tabretta -n 20` je bez chyb
- `curl -sI http://127.0.0.1:3100/login` vrátí 200, `curl -sI http://127.0.0.1:3100/` vrátí 303 s `Location: /login`
- `curl -sI https://tabretta.blbadomena.cz/` vrátí 303 na `/login` s platným certifikátem a v odpovědi je `Strict-Transport-Security`
- po přihlášení: nahrát přílohu a ověřit, že soubor vznikl v `/var/lib/tabretta/uploads` pod vygenerovaným názvem (48 hex znaků)
- `gomappin` a `diag` běží beze změny, `free -h` a `df -h /` jsou po nasazení v pořádku
