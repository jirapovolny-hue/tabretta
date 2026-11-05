# Tabretta

Osobní tracker projektů a úkolů. „Pro váš osobní i profesní život.“
Produkce: https://tabretta.blbadomena.cz

> Rozpracováno (fáze 2). README se doplňuje průběžně: nasazení, migrace, vytvoření uživatele a zálohy přibudou s příslušným kódem.

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

## Vývoj

```bash
npm ci --ignore-scripts
npm test            # node --test; testy s DB načtou ~/.config/tabretta/test.env, pokud existuje
```

Lokálně spouštět jen na `127.0.0.1` a jiném portu než 3100 (ten je pro produkci).
