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

## Vývoj

```bash
npm ci --ignore-scripts
npm test            # node --test; testy s DB načtou ~/.config/tabretta/test.env, pokud existuje
```

Lokálně spouštět jen na `127.0.0.1` a jiném portu než 3100 (ten je pro produkci).
