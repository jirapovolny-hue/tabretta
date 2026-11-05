# Zadání pro Claude Code: Tabretta

Jednoduchý osobní tracker projektů a úkolů (soukromých i pracovních), nasazený na vlastním serveru. Slogan: **„Pro váš osobní i profesní život"**. Cílovka do budoucna: živnostníci, ne korporáty. Dnes jde o aplikaci pro jednoho uživatele.

Přečti celé zadání, než začneš. Pokud je v zadání něco nejasné nebo to na serveru nesedí, zeptej se uživatele (jednu otázku najednou), nehádej.

## 1. Cíl

Alternativa k Jiře, která není košatá a nepřehledná. Rozhoduje jednoduchost: projekt → úkol, pár stavů, rychlé zadávání, čitelný přehled. Funkce nad rámec tohoto zadání nepřidávej (viz sekce 9).

- Název aplikace: **Tabretta**
- Adresa: **https://tabretta.blbadomena.cz** (doména `blbadomena.cz` je u Forpsi, uživatel tam má wildcard DNS záznam `*.blbadomena.cz`, takže samostatný záznam pro subdoménu není potřeba)
- Jazyk rozhraní: čeština
- Používá se hodně z mobilu, takže rozhraní musí být responzivní a ovladatelné prstem

## 2. Prostředí a pravidla (závazné)

Server: Oracle Cloud Always Free, Ubuntu 24.04, **ARM (aarch64)**, 2 jádra, 12 GB RAM, bez swapu, veřejná IP 79.76.102.155. Uživatel `ubuntu`. Přihlášení pouze SSH klíčem. Pokud existuje dokument „Kuchařka pro agenta: Oracle VPS a nasazení webu", řiď se jím. Nejdůležitější pravidla:

**Smíš bez ptaní:** číst soubory, logy a konfiguraci; vytvářet soubory webu pod `/var/www/tabretta.blbadomena.cz`; vytvořit konfiguraci Nginx pro tento web; vytvořit systemd službu pro tuto aplikaci.

**Nejdřív se zeptej uživatele:**
- jakékoli mazání dat, úprava cizí konfigurace, restart už běžících služeb (včetně reloadu Nginx, pokud už obsluhuje jiné weby; vždy po `sudo nginx -t`)
- změny SSH, firewallu (iptables) a uživatelských účtů
- otevření portů 80/443 v iptables a instalace čehokoli, co naslouchá na veřejné adrese
- vytvoření databáze a role v PostgreSQL
- globální instalace Node.js, pokud ještě není

**Nikdy:**
- neměň přihlášení do SSH (klíč zůstává, heslo se nezapíná)
- nespouštěj aplikaci jako `root`
- neukládej hesla, klíče a `.env` do repozitáře ani do webového adresáře
- nevytvářej nic v Oracle Cloud, co není Always Free
- neotevírej databázi do internetu (PostgreSQL poslouchá jen na `127.0.0.1`)

Před změnou existujícího souboru udělej zálohu (`sudo cp soubor soubor.bak`). Po práci napiš stručně, co jsi nainstaloval a změnil (názvy souborů a služeb).

**Pozor na `sudo`:** na serveru může `sudo` pro uživatele `ubuntu` vyžadovat heslo, které uživatel nemá. Pokud na to narazíš, zastav se a řekni to. Nepokoušej se to obejít (například úpravou sudoers) bez jeho výslovného souhlasu. Můžeš mu místo toho vypsat přesné příkazy, které spustí sám.

## 3. Technologie

- **Node.js** (aktuální LTS dostupné pro ARM; ověř `node -v`, případně se zeptej před instalací) + **Express**
- **PostgreSQL** na serveru už běží. Použij **novou samostatnou databázi `tabretta`** s vlastní **nesuperuživatelskou rolí `tabretta_user`**. Nesahej do databáze `gomappin` ani do jejích rolí. Nepoužívej superuživatele aplikace.
- Ovladač `pg`, žádné ORM. Migrace jako číslované SQL soubory (`db/migrations/001_init.sql`, ...) a malý skript, který je aplikuje a eviduje, co už proběhlo.
- Frontend bez build kroku: čisté HTML + CSS + vanilla JS (ES moduly), komunikace s JSON API. Případné knihovny (např. SortableJS pro přetahování) ulož lokálně do projektu, ne z CDN.
- Doporučené závislosti, pokud nenajdeš lepší: `express`, `pg`, `express-session`, `connect-pg-simple`, `bcryptjs` (čisté JS, bez nativní kompilace na ARM), `helmet`, `express-rate-limit`, `multer`, `dotenv` (nebo `EnvironmentFile` v systemd). Držet závislosti na minimu.

## 4. Datový model

Základ je připravený na více uživatelů, aplikace ale zůstává jednouživatelská: každý projekt patří uživateli a **všechny dotazy se filtrují podle přihlášeného uživatele**.

- `users`: id, username (unique), password_hash, created_at
- `projects`: id, user_id, name, description, kind (`prace` | `soukrome`), archived (bool), sort_order, created_at, updated_at
- `tasks`: id, project_id, title, description, status (`napad` | `k_udelani` | `rozdelane` | `hotovo`), due_date (null), sort_order, completed_at (null), created_at, updated_at
- `task_links`: id, task_id, url, label (null)
- `task_attachments`: id, task_id, original_name, stored_name, mime_type, size_bytes, created_at
- `shopping_items`: id, task_id, name, quantity (číslo, výchozí 1), unit_price (null), bought (bool), sort_order
- `task_dependencies`: task_id, depends_on_task_id (PK obojí, CHECK že se nerovnají; závislost smí vést i mezi projekty téhož uživatele)
- tabulku pro sessions vytvoří `connect-pg-simple`

Mazání: smazání projektu smaže jeho úkoly a navázané záznamy (ON DELETE CASCADE), soubory příloh se musí smazat i z disku. Před smazáním projektu a úkolu se aplikace uživatele zeptá potvrzením.

Stavy v češtině v rozhraní: **Nápad, K udělání, Rozdělané, Hotovo**.

## 5. Funkce

**Přihlášení**
- Bez registrace. Uživatel se vytvoří skriptem (`npm run create-user`, heslo se zadá interaktivně, nikdy ne jako argument příkazu).
- Přihlašovací stránka s názvem Tabretta a sloganem.
- Session v cookie (`httpOnly`, `secure`, `sameSite=lax`), odhlášení, omezení počtu pokusů o přihlášení.

**Hlavní obrazovka = seznam**
- Projekty pod sebou, v každém jeho úkoly se stavem jako štítkem a případným termínem.
- Filtr nahoře: Vše / Práce / Soukromé.
- Rychlý pohled „Rozdělané": všechny úkoly ve stavu Rozdělané napříč projekty.
- Úkoly ve stavu Hotovo jsou ve výchozím stavu skryté, přepínač je zobrazí.
- Rychlé přidání úkolu: jedno textové pole v každém projektu, Enter vytvoří úkol ve stavu K udělání. Rychlé přidání projektu analogicky.

**Pohled na projekt**
- Přepínač **Seznam / Kanban** (volba se pamatuje v prohlížeči).
- Kanban: čtyři sloupce podle stavu. Na počítači přetahování karet, na dotykovém zařízení změna stavu přes nabídku na kartě (HTML5 drag and drop na dotyku nefunguje spolehlivě).

**Detail úkolu**
- Úprava názvu, popisu (prostý text, zachovat odřádkování), stavu, termínu.
- **Odkazy:** adresa + volitelný popisek, zobrazené jako klikací seznam. Povol jen `http://` a `https://` (kvůli `javascript:` odkazům), odkazy otevírat s `rel="noopener noreferrer"`.
- **Přílohy:** nahrání souborů (fotky, PDF, dokumenty), seznam ke stažení, mazání.
- **Nákupní seznam:** položky s názvem, množstvím, volitelnou cenou za kus a odškrtnutím „koupeno". Zobrazit součet (celkem a zbývá koupit).
- **Navazuje na:** výběr jiných úkolů, na které tento úkol navazuje. Je to **jen upozornění, nic neblokuje**. Úkol s nedokončenými předchůdci ukazuje štítek typu „čeká na: <název> (<stav>)". Úkol lze přesto dělat a dokončit kdykoli. Zabraň závislosti na sebe sama.

**Vzhled:** čistý, střídmý, rychlý. Respektuj `prefers-color-scheme` (světlý a tmavý režim). Název Tabretta a slogan na přihlašovací stránce a v hlavičce.

## 6. Bezpečnost

- Veškeré SQL jen s parametry (žádné skládání řetězců).
- Výstup do HTML vždy escapovat, ve frontendu vkládat texty přes `textContent`, ne `innerHTML`.
- `helmet` včetně rozumné Content-Security-Policy (bez inline skriptů, knihovny lokálně).
- Ochrana proti CSRF: cookie `sameSite=lax` a navíc u všech požadavků měnících data vyžadovat vlastní hlavičku (např. `X-Requested-With`), včetně nahrávání souborů.
- **Přílohy:** ukládat mimo webový adresář (např. `/var/lib/tabretta/uploads`), pod vygenerovaným názvem (originální název jen v databázi), limit velikosti (např. 25 MB na soubor), stažení jen přihlášenému uživateli přes endpoint, s hlavičkami `Content-Disposition: attachment` a `X-Content-Type-Options: nosniff`. Nikdy nevracej soubory jako spustitelný obsah ani je nepodávej přímo přes Nginx.
- Tajemství (session secret, heslo k databázi) patří do souboru mimo repozitář a mimo webový kořen, např. `/etc/tabretta/tabretta.env` (vlastník `ubuntu`, oprávnění 600), načítaného přes `EnvironmentFile=` v systemd. Heslo databázové role vygeneruj náhodně a neukazuj ho v chatu ani v logu; řekni uživateli jen, kde je uloženo.
- Aplikace poslouchá výhradně na `127.0.0.1`.

## 7. Struktura projektu

Kód je v `/var/www/tabretta.blbadomena.cz` (vlastník `ubuntu`), v něm Git repozitář s `.gitignore` (minimálně `node_modules`, `.env*`, `uploads`). Doporučená struktura:

```
server.js            # start aplikace
src/                 # routy, přístup k databázi, auth
db/migrations/       # SQL migrace
scripts/             # migrate, create-user
public/              # statický frontend (HTML, CSS, JS)
README.md            # jak spustit, nasadit, zálohovat
```

Do `README.md` napiš: požadavky, proměnné prostředí (názvy, ne hodnoty), spuštění migrací, vytvoření uživatele, nasazení a restart služby.

## 8. Postup práce

**Fáze 0: ověření stavu (nic neměň)**
```bash
uname -m && lsb_release -d && nproc && free -h && df -h /
systemctl list-units --type=service --state=running --no-pager
sudo ss -tlnp
ls /etc/nginx/sites-enabled 2>/dev/null
node -v; psql --version
```
Zjisti: je nainstalovaný Nginx a co obsluhuje? Je nainstalovaný Node.js? Který port je volný pro aplikaci (použij první volný od 3100)? Kam se dá připojit k PostgreSQL? Ověř, jestli funguje `sudo` bez hesla (viz sekce 2). Výsledek krátce shrň uživateli.

**Fáze 1: databáze (po souhlasu uživatele)**
Vytvoř roli `tabretta_user` a databázi `tabretta` (vlastník role). Aplikaci pouštěj pod touto rolí. Spusť migrace.

**Fáze 2: aplikace**
Napiš aplikaci podle sekcí 4 až 7. Spusť ji lokálně na `127.0.0.1:<port>` a vyzkoušej všechny funkce (přihlášení, projekty, úkoly, stavy, kanban, odkazy, přílohy, nákupní seznam, závislosti, mazání). Napiš alespoň základní automatické testy pro API a pro oddělení dat podle uživatele a spusť je.

**Fáze 3: služba a Nginx**
- systemd služba `tabretta` (`User=ubuntu`, `WorkingDirectory=/var/www/tabretta.blbadomena.cz`, `EnvironmentFile=/etc/tabretta/tabretta.env`, `Restart=on-failure`), povolená při startu.
- Konfigurace `/etc/nginx/sites-available/tabretta.blbadomena.cz` s `proxy_pass http://127.0.0.1:<port>`, hlavičkami `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` a `client_max_body_size 30m`. V Expressu nastav `trust proxy`.
- Aktivace přes symlink do `sites-enabled`, `sudo nginx -t`, až potom reload.

**Fáze 4: DNS a HTTPS**
- Uživatel má ve Forpsi wildcard záznam, nic přidávat nemusí. Ověř, že subdoména míří na tento server (`dig +short tabretta.blbadomena.cz` musí vrátit `79.76.102.155`), jinak certifikát nevznikne. Pokud vrátí něco jiného, zeptej se uživatele. Certifikát vystav jen pro `tabretta.blbadomena.cz` (stačí ověření přes HTTP, wildcard certifikát není potřeba).
- Pokud porty 80 a 443 ještě nejsou otevřené (Security List v OCI dělá uživatel, iptables až po jeho souhlasu podle postupu v kuchařce), řekni to a počkej.
- `sudo certbot --nginx -d tabretta.blbadomena.cz`, poté `sudo certbot renew --dry-run`.

**Fáze 5: ověření a předání**
- `curl -I https://tabretta.blbadomena.cz` vrací 200 nebo přesměrování na přihlášení, stránka se otevře v prohlížeči, na telefonu je použitelná.
- Pomoz uživateli vytvořit jeho účet (`npm run create-user`, heslo zadá sám).
- Zkontroluj paměť a disk po nasazení (`free -h`, `df -h /`).
- Napiš shrnutí: co je nainstalováno, kde co leží (soubory, služba, konfigurace Nginx, databáze, adresář příloh), jak aplikaci restartovat a jak vrátit změny.

## 9. Mimo rozsah (zatím nedělej)

Registrace dalších uživatelů, týmy a sdílení, komentáře, podúkoly a checklisty (záměrně: místo nich se používá projekt s více úkoly), epiky a sprinty, vlastní pole a workflow, notifikace a e-maily, opakující se úkoly, platby, import z jiných nástrojů, externí API.

**Zálohy:** pravidelné zálohy databáze `tabretta` a adresáře příloh jsou potřeba, ale cílové úložiště mimo server (offsite) uživatel ještě nevybral. Nastavuj je až po dohodě s ním. Do té doby navrhni jednoduchý skript (`pg_dump` + kopie příloh do `/var/backups/tabretta` s rotací) a nespouštěj ho bez souhlasu.

## 10. Hotovo, když

- [ ] Aplikace běží jako služba `tabretta` pod uživatelem `ubuntu` a přežije restart serveru.
- [ ] https://tabretta.blbadomena.cz funguje s platným certifikátem a automatickým obnovováním.
- [ ] Bez přihlášení není dostupné nic kromě přihlašovací stránky.
- [ ] Všechny funkce ze sekce 5 fungují na počítači i na telefonu.
- [ ] Databáze `gomappin` a ostatní služby na serveru zůstaly beze změny.
- [ ] Žádná tajemství v repozitáři ani ve webovém adresáři.
- [ ] Uživatel dostal shrnutí změn a README.
