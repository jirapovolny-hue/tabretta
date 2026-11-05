# Tabretta

Osobní tracker projektů a úkolů. „Pro váš osobní i profesní život.“
Produkce: https://tabretta.blbadomena.cz

Express + PostgreSQL (`pg`, bez ORM), frontend bez build kroku. Aplikace poslouchá jen na `127.0.0.1`, před ní je nginx s HTTPS.

## Nasazení, restart, zálohy

Podrobný postup pro správce je v [`deploy/README.md`](deploy/README.md): systémový účet `tabretta`, kód v `/opt/tabretta` (jen čtení), konfigurace `/etc/tabretta/tabretta.env`, přílohy `/var/lib/tabretta/uploads`, služba `tabretta.service` se sandboxem a nginx.

- Restart: `systemctl restart tabretta`, logy: `journalctl -u tabretta`
- Zálohy: návrh skriptu `deploy/backup/tabretta-backup.sh` (`pg_dump` + archiv příloh do `/var/backups/tabretta`, rotace 14 dní). Zatím se nespouští, cílové úložiště mimo server ještě není vybrané.

## Požadavky

- Node.js ≥ 22.9 (na serveru 24 LTS), bez nativních závislostí
- PostgreSQL (vlastní nesuperuživatelská role, bez rozšíření)

## Proměnné prostředí

Jen názvy, hodnoty nikdy do repa (viz `.env.example`). V produkci je načítá systemd z `/etc/tabretta/tabretta.env`.

| Proměnná | Význam |
|---|---|
| `PORT` | port na `127.0.0.1`, výchozí 3100 |
| `DATABASE_URL` | připojení k PostgreSQL |
| `SESSION_SECRET` | tajemství pro podpis session cookie (aspoň 32 znaků) |
| `UPLOAD_DIR` | absolutní cesta k adresáři příloh (jediné místo, kam aplikace zapisuje) |
| `COOKIE_SECURE` | `0` jen pro lokální vývoj přes http, jinak nenastavovat |

## Migrace

Číslované SQL soubory v `db/migrations/` (`NNN_nazev.sql`). Skript je aplikuje v pořadí, každou v transakci, a eviduje je v tabulce `schema_migrations` (název + SHA-256 obsahu). Opakované spuštění nic nedělá. Změna už provedené migrace je chyba: migrace se neupravují, jen se přidávají nové. Nevyžaduje superuživatele ani rozšíření. Tabulku `session` pro `connect-pg-simple` vytváří migrace, ne aplikace.

```bash
DATABASE_URL=... npm run migrate
```

## Vytvoření uživatele

Registrace není. Uživatele vytvoří skript, heslo (aspoň 12 znaků) se zadává skrytě v terminálu, nikdy jako argument:

```bash
DATABASE_URL=... npm run create-user -- jmeno
```

## Frontend

Bez build kroku: `public/` obsahuje čisté HTML, CSS a JS (ES moduly), žádné knihovny z CDN. Bez přihlášení je dostupná jen `/login` a `public/static/` (styly, skript a ikona přihlašovací stránky). Vše ostatní (`/`, `/app/…`) přesměruje na `/login`. Navigace v aplikaci přes `#/`, `#/rozdelane`, `#/archiv`, `#/projekt/ID`, `#/ukol/ID`. Texty se vkládají jen přes `textContent`, CSP nepovoluje inline skripty ani styly.

## API

JSON pod `/api`. Kromě `POST /api/login` a `POST /api/logout` vše jen pro přihlášeného uživatele (jinak 401). Každý požadavek měnící data musí mít hlavičku `X-Requested-With: XMLHttpRequest` (jinak 403). Cizí nebo neexistující záznam vrací 404.

| Metoda a cesta | Popis |
|---|---|
| `POST /api/login` `{username, password}` | přihlášení (omezení: 10 neúspěšných pokusů / 15 min / IP) |
| `POST /api/logout`, `GET /api/me` | odhlášení, aktuální uživatel |
| `GET /api/projects?kind=&archived=1` | projekty (`kind` = `prace` / `soukrome`) |
| `POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id` | projekt; smazání smaže i úkoly a soubory příloh |
| `GET /api/tasks?project_id=&kind=&status=&include_done=1` | úkoly napříč projekty, s `waiting_on`; hotové skryté, pokud není `include_done=1` |
| `POST /api/projects/:id/tasks`, `GET/PATCH/DELETE /api/tasks/:id` | úkol; detail obsahuje odkazy, přílohy, nákupní seznam se součty a závislosti |
| `POST /api/tasks/:id/links`, `DELETE /api/links/:id` | odkazy (jen `http(s)://`) |
| `POST /api/tasks/:id/shopping-items`, `PATCH/DELETE /api/shopping-items/:id` | nákupní seznam |
| `POST /api/tasks/:id/dependencies` `{depends_on_task_id}`, `DELETE /api/tasks/:id/dependencies/:dependsOnId` | „navazuje na“ (jen upozornění) |
| `POST /api/tasks/:id/attachments` (multipart, pole `file`) | nahrání přílohy, max. 25 MB |
| `GET /api/attachments/:id`, `DELETE /api/attachments/:id` | stažení (vždy `attachment`, `nosniff`), smazání |

Stavy úkolu: `napad`, `k_udelani`, `rozdelane`, `hotovo` (Nápad, K udělání, Rozdělané, Hotovo).

## Vývoj

```bash
npm ci --ignore-scripts
npm test            # node --test; testy s DB načtou ~/.config/tabretta/test.env, pokud existuje
```

Lokálně spouštět jen na `127.0.0.1` a jiném portu než 3100 (ten je pro produkci).
