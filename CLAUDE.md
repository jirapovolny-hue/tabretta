# Tabretta: vývoj aplikace

Jsi vývojová instance Claude Code na produkčním VPS (Ubuntu 24.04, arm64, Oracle Cloud) pod účtem `dev01` **bez sudo**. Komunikujeme česky, tykáme si. Uživatel je majitel serveru. Správce serveru je jiná session ("VPS admin"), ta nasazuje.

## Co je tento projekt
Osobní tracker projektů a úkolů **Tabretta** (https://tabretta.blbadomena.cz). Funkční zadání je v `ZADANI.md` (sekce 1, 3 až 7, 9, 10). **Pokud se `ZADANI.md` liší od tohoto souboru, platí tento soubor** (zadání bylo psáno pro agenta s právy správce).

## Rozdělení práce (změna oproti ZADANI.md)
- **Ty:** napsat aplikaci (zadání sekce 5), migrace, skripty, testy, README, návrhy konfigurace v `deploy/` (viz níže). Fáze 2 zadání.
- **Správce (já / VPS admin):** fáze 0, 1, 3, 4, 5: databáze a role v PostgreSQL, systémový účet, systemd služba, nginx, certbot, firewall, nasazení, restart, zálohy. Nikdy nepracuj na těchto věcech sám.
- Požadavky na správce piš do `REQUESTS.md` (nejnovější dole: co, proč, jak ověřit). Správce nasazuje **ze snapshotu konkrétního commitu** (`git archive`), nikdy z tvého adresáře. Výsledek ti pošle zprávou nebo ho zapíše.

## Odchylky od ZADANI.md (závazné)
- **Aplikace poběží pod systémovým účtem `tabretta`**, ne pod `ubuntu`. Kód root:root v `/opt/tabretta` (jen čtení), konfigurace `/etc/tabretta/tabretta.env` (root:tabretta, 640, načítá systemd přes `EnvironmentFile=`), přílohy `/var/lib/tabretta/uploads` (vlastník `tabretta`). Cesty nikdy nezapisuj napevno: `UPLOAD_DIR`, `PORT` (výchozí 3100), `DATABASE_URL`, `SESSION_SECRET` z prostředí. Slovo "ubuntu" a "/var/www" se v kódu nesmí objevit.
- **Služba je sandboxovaná** (jako gomappin: `ProtectSystem=strict`, `NoNewPrivileges`, `ReadWritePaths=` jen uploads). Aplikace smí zapisovat jen do `UPLOAD_DIR` a do databáze. Žádné zápisy do vlastního adresáře kódu, žádný `/tmp` mimo `os.tmpdir()` pro multer (nebo nastav multer `dest` do `UPLOAD_DIR`).
- **Sudo nemáš.** Nikdy sudo, nesahej na nginx, systemd, PostgreSQL superuživatele, firewall, SSH. Co vyžaduje root, napiš do `REQUESTS.md`.
- **Databáze:** pro vývoj a testy dostaneš od správce samostatnou databázi `tabretta_dev` s rolí `tabretta_dev` (spojení v souboru `~/.config/tabretta/test.env`, klíč `TEST_DATABASE_URL`, oprávnění 600; heslo nikdy nevypisuj a nedávej do repa ani do chatu). Dokud soubor neexistuje, piš a spouštěj jen testy bez databáze a požádej o něj v `REQUESTS.md`. Do `gomappin`, `diag` ani produkční `tabretta` nesahej.
- **Migrace** jako číslované SQL soubory + skript `scripts/migrate.js`; správce je při nasazení spouští pod rolí `tabretta_user`. Migrace musí být idempotentní vůči evidenci a nesmí vyžadovat superuživatele (žádné `CREATE EXTENSION`; potřebuješ-li rozšíření, napiš to do `REQUESTS.md`).
- **Přílohy:** `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`, vygenerovaný název, limit 25 MB, kontrola vlastníka. Aplikace nikdy nespouští nahrané soubory ani nezpracovává jejich obsah.
- **Zálohy a offsite:** jen návrh skriptu (zadání sekce 9), nespouštět. Rozhodnutí o úložišti je na uživateli.
- **Mimo rozsah** je vše ze sekce 9 zadání. Funkce navíc nepřidávej, pokud tě uživatel nepožádá.

## Pravidla
- **Pracuj jen v tomto adresáři** (`~/projects/tabretta`), kromě `~/.config/tabretta/test.env` (čteš). Do jiných projektů v `~/projects/` nezasahuj.
- **Žádné secrets** v repu, v `REQUESTS.md`, v logu ani v chatu. Do repa patří `.env.example` jen s názvy proměnných. `.gitignore`: `node_modules`, `.env*`, `uploads`, `*.log`.
- **Závislosti:** minimum, přesné verze, `package-lock.json` v repu, žádné knihovny z CDN, žádné balíčky s nativní kompilací a se `postinstall` skripty (správce instaluje `npm ci --omit=dev --ignore-scripts`). Každou závislost krátce zdůvodni v `REQUESTS.md` (supply-chain riziko). Doporučený seznam je v zadání, `bcryptjs` místo `bcrypt`.
- **Git:** malé srozumitelné commity česky, nepřepisuj historii, žádný force push. **Nic nepushuj** (remote `origin` je `git@github.com:jirapovolny-hue/tabretta.git`, ale push do něj dělá výhradně správce po schválení uživatele; deploy klíč vývojové session byl odebrán). Chceš-li něco zveřejnit, napiš to do `REQUESTS.md`. Nasazuje správce ze snapshotu konkrétního commitu.
- **Návrhy konfigurace pro správce** dej do `deploy/` (např. `deploy/nginx/tabretta.conf`, `deploy/systemd/tabretta.service`, `deploy/README.md` s postupem). Jsou to jen návrhy, nasadí je a zkontroluje správce.
- **Zeptej se uživatele**, pokud je něco v zadání nejasné: jedna otázka najednou, nehádej.

## Jak začít
1. Přečti `ZADANI.md` a tento soubor.
2. Napiš uživateli krátký plán (pořadí kroků, kdy potřebuješ od správce databázi `tabretta_dev` a co v ní) a počkej na jeho souhlas.
3. První požadavek na správce (testovací databáze `tabretta_dev`) napiš do `REQUESTS.md` hned po plánu.

## Testování
- `npm test` (např. vestavěný `node --test`), základní testy API a oddělení dat podle uživatele podle zadání sekce 8, fáze 2. Lokálně spouštěj aplikaci jen na `127.0.0.1` a na jiném portu než 3100 (3100 je pro produkci).
- Před každým požadavkem na nasazení: testy projdou, `git status` čistý, README aktuální.
