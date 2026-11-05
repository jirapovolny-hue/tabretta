# Nasazení Tabretty (návrh pro správce)

Vše v tomto adresáři jsou **návrhy**. Nasazuje a kontroluje je správce (VPS admin). Vývojová session nemá sudo a na nic z toho nesahá.

| Soubor | Cíl na serveru |
|---|---|
| `systemd/tabretta.service` | `/etc/systemd/system/tabretta.service` |
| `nginx/tabretta.conf` | `/etc/nginx/sites-available/tabretta.blbadomena.cz` |
| `backup/tabretta-backup.sh` | návrh, **nespouštět** bez souhlasu uživatele |

## Rozložení

| Co | Kde | Vlastník, práva |
|---|---|---|
| kód (snapshot commitu) | `/opt/tabretta` | `root:root`, jen čtení |
| konfigurace | `/etc/tabretta/tabretta.env` | `root:tabretta`, 640 |
| přílohy | `/var/lib/tabretta/uploads` | `tabretta:tabretta`, 750 |
| služba | `tabretta.service`, `User=tabretta` | sandbox, zapisuje jen do uploads |
| databáze | `tabretta`, vlastník role `tabretta_user` (ne superuživatel) | PostgreSQL jen na 127.0.0.1 |

## Jednorázová příprava

1. Systémový účet: `useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin tabretta`
2. Adresáře: `install -d -o tabretta -g tabretta -m 750 /var/lib/tabretta /var/lib/tabretta/uploads` a `install -d -o root -g tabretta -m 750 /etc/tabretta`
3. Databáze: role `tabretta_user` (LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, náhodné heslo) a databáze `tabretta` s vlastníkem `tabretta_user`. Rozšíření nejsou potřeba.
4. `/etc/tabretta/tabretta.env` (`root:tabretta`, 640). Názvy proměnných jsou v `.env.example`:
   ```
   PORT=3100
   DATABASE_URL=postgres://tabretta_user:<heslo>@127.0.0.1:5432/tabretta
   SESSION_SECRET=<openssl rand -hex 32>
   UPLOAD_DIR=/var/lib/tabretta/uploads
   ```
   `COOKIE_SECURE` nenastavovat (výchozí je Secure cookie za HTTPS).

## Nasazení konkrétního commitu

```bash
COMMIT=<hash z REQUESTS.md>
rm -rf /opt/tabretta.new && mkdir /opt/tabretta.new
git -C /home/dev01/projects/tabretta archive "$COMMIT" | tar -x -C /opt/tabretta.new   # nebo z GitHubu
cd /opt/tabretta.new && npm ci --omit=dev --ignore-scripts
chown -R root:root /opt/tabretta.new && chmod -R go-w /opt/tabretta.new

# migrace pod rolí tabretta_user (idempotentní, eviduje provedené)
sudo -u tabretta bash -c 'set -a; . /etc/tabretta/tabretta.env; cd /opt/tabretta.new && node scripts/migrate.js'

# přepnutí a restart
[ -d /opt/tabretta ] && mv /opt/tabretta /opt/tabretta.prev
mv /opt/tabretta.new /opt/tabretta
systemctl daemon-reload && systemctl restart tabretta
```

Návrat k předchozí verzi: `mv /opt/tabretta /opt/tabretta.bad && mv /opt/tabretta.prev /opt/tabretta && systemctl restart tabretta`. Migrace se automaticky nevracejí, každá je jen přidávací.

## Nginx a HTTPS

`ln -s ../sites-available/tabretta.blbadomena.cz /etc/nginx/sites-enabled/`, pak `nginx -t` a reload. Potom `certbot --nginx -d tabretta.blbadomena.cz` a `certbot renew --dry-run`.

## Vytvoření uživatele (interaktivně, heslo zadá uživatel)

```bash
sudo -u tabretta bash -c 'set -a; . /etc/tabretta/tabretta.env; cd /opt/tabretta && node scripts/create-user.js <jmeno>'
```

## Ověření

```bash
systemctl is-active tabretta
curl -sI http://127.0.0.1:3100/login | head -1          # 200
curl -sI http://127.0.0.1:3100/ | grep -i '^location'   # /login
curl -sI https://tabretta.blbadomena.cz/ | head -3      # 303 na /login, platný certifikát
journalctl -u tabretta -n 20 --no-pager                 # bez chyb
systemd-analyze security tabretta                       # orientační skóre sandboxu
```
