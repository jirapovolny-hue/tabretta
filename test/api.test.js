import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { createUser } from '../src/users.js';
import { createTestPool, resetDatabase, skipWithoutDb } from './helpers/db.js';
import { Client } from './helpers/client.js';

const PASSWORD_A = 'heslo-uzivatele-a';
const PASSWORD_B = 'heslo-uzivatele-b';

let pool;
let uploadDir;
const servers = [];

async function startApp(overrides = {}) {
  const config = {
    port: 0,
    host: '127.0.0.1',
    sessionSecret: 'test-secret-'.padEnd(40, 'x'),
    uploadDir,
    cookieSecure: false,
    ...overrides.config,
  };
  const app = createApp({ config, pool, pruneSessions: false, loginLimit: overrides.loginLimit ?? 1000 });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function loggedIn(baseUrl, username, password) {
  const c = new Client(baseUrl);
  const res = await c.login(username, password);
  assert.equal(res.status, 200, `přihlášení ${username}`);
  return c;
}

async function uploadFiles() {
  return (await fs.readdir(uploadDir)).sort();
}

describe('API', { skip: skipWithoutDb }, () => {
  let baseUrl;

  before(async () => {
    pool = createTestPool();
    await resetDatabase(pool);
    await runMigrations(pool);
    await createUser(pool, 'alice', PASSWORD_A);
    await createUser(pool, 'bob', PASSWORD_B);
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tabretta-uploads-'));
    baseUrl = await startApp();
  });

  after(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    if (pool) await pool.end();
    if (uploadDir) await fs.rm(uploadDir, { recursive: true, force: true });
  });

  describe('přihlášení', () => {
    test('bez přihlášení je API nedostupné', async () => {
      const c = new Client(baseUrl);
      for (const p of ['/api/me', '/api/projects', '/api/tasks', '/api/tasks/1', '/api/attachments/1']) {
        assert.equal((await c.get(p)).status, 401, p);
      }
      assert.equal((await c.post('/api/projects', { name: 'X', kind: 'prace' })).status, 401);
    });

    test('špatné heslo a neexistující uživatel: 401 se stejnou zprávou', async () => {
      const c = new Client(baseUrl);
      const a = await c.login('alice', 'spatne-heslo-xyz');
      const b = await c.login('nikdo', 'spatne-heslo-xyz');
      assert.equal(a.status, 401);
      assert.equal(b.status, 401);
      assert.deepEqual(a.data, b.data);
      assert.equal(c.cookie, null);
    });

    test('přihlášení nastaví bezpečnou cookie, odhlášení session zruší', async () => {
      const c = await loggedIn(baseUrl, 'alice', PASSWORD_A);
      assert.match(c.lastSetCookie, /^tabretta\.sid=/);
      assert.match(c.lastSetCookie, /HttpOnly/i);
      assert.match(c.lastSetCookie, /SameSite=Lax/i);
      assert.deepEqual((await c.get('/api/me')).data, { username: 'alice' });

      const stolen = c.cookie;
      assert.equal((await c.post('/api/logout')).status, 204);
      const again = new Client(baseUrl);
      again.cookie = stolen;
      assert.equal((await again.get('/api/me')).status, 401, 'stará session po odhlášení neplatí');
    });

    test('za HTTPS proxy má cookie příznak Secure', async () => {
      const secureUrl = await startApp({ config: { cookieSecure: true } });
      const c = new Client(secureUrl);
      const res = await c.post('/api/login', { username: 'alice', password: PASSWORD_A }, { headers: { 'X-Forwarded-Proto': 'https' } });
      assert.equal(res.status, 200);
      assert.match(c.lastSetCookie, /;\s*Secure/i);
    });

    test('omezení pokusů o přihlášení', async () => {
      const limitedUrl = await startApp({ loginLimit: 3 });
      const c = new Client(limitedUrl);
      for (let i = 0; i < 3; i++) assert.equal((await c.login('alice', 'spatne-heslo-xyz')).status, 401);
      const blocked = await c.login('alice', PASSWORD_A);
      assert.equal(blocked.status, 429, 'po vyčerpání pokusů je blokováno i správné heslo');
    });

    test('CSRF hlavička je potřeba i po přihlášení', async () => {
      const c = await loggedIn(baseUrl, 'alice', PASSWORD_A);
      const res = await c.request('POST', '/api/projects', { json: { name: 'X', kind: 'prace' }, csrf: false });
      assert.equal(res.status, 403);
    });
  });

  describe('projekty a úkoly', () => {
    let c;
    before(async () => {
      c = await loggedIn(baseUrl, 'alice', PASSWORD_A);
    });

    test('vytvoření, úprava, filtr podle druhu, archivace', async () => {
      const work = await c.post('/api/projects', { name: '  Web  ', kind: 'prace' });
      assert.equal(work.status, 201);
      assert.equal(work.data.name, 'Web');
      const home = await c.post('/api/projects', { name: 'Byt', kind: 'soukrome', description: 'řádek 1\nřádek 2' });
      assert.equal(home.data.description, 'řádek 1\nřádek 2');
      assert.ok(home.data.sort_order > work.data.sort_order);

      assert.equal((await c.post('/api/projects', { name: '', kind: 'prace' })).status, 400);
      assert.equal((await c.post('/api/projects', { name: 'X', kind: 'firma' })).status, 400);

      const onlyWork = await c.get('/api/projects?kind=prace');
      assert.ok(onlyWork.data.every((p) => p.kind === 'prace'));
      assert.ok(onlyWork.data.some((p) => p.id === work.data.id));

      const renamed = await c.patch(`/api/projects/${work.data.id}`, { name: 'Web firmy' });
      assert.equal(renamed.data.name, 'Web firmy');
      assert.equal((await c.patch(`/api/projects/${work.data.id}`, { neznamy: 1 })).status, 400);

      await c.patch(`/api/projects/${home.data.id}`, { archived: true });
      assert.ok(!(await c.get('/api/projects')).data.some((p) => p.id === home.data.id));
      assert.ok((await c.get('/api/projects?archived=1')).data.some((p) => p.id === home.data.id));
    });

    test('úkoly: výchozí stav, completed_at, skryté hotové, pohled Rozdělané', async () => {
      const p = (await c.post('/api/projects', { name: 'Úkoly', kind: 'prace' })).data;
      const t1 = await c.post(`/api/projects/${p.id}/tasks`, { title: 'První' });
      assert.equal(t1.status, 201);
      assert.equal(t1.data.status, 'k_udelani');
      assert.equal(t1.data.completed_at, null);
      const t2 = (await c.post(`/api/projects/${p.id}/tasks`, { title: 'Druhý', status: 'rozdelane', due_date: '2026-12-24' })).data;
      assert.equal(t2.due_date, '2026-12-24');

      assert.equal((await c.post(`/api/projects/${p.id}/tasks`, { title: 'X', status: 'jiny' })).status, 400);
      assert.equal((await c.post(`/api/projects/${p.id}/tasks`, { title: 'X', due_date: '2026-02-30' })).status, 400);

      const done = await c.patch(`/api/tasks/${t1.data.id}`, { status: 'hotovo', description: 'a\r\nb' });
      assert.ok(done.data.completed_at);
      assert.equal(done.data.description, 'a\nb');

      let list = (await c.get(`/api/tasks?project_id=${p.id}`)).data;
      assert.deepEqual(list.map((t) => t.id), [t2.id], 'hotové jsou ve výchozím stavu skryté');
      list = (await c.get(`/api/tasks?project_id=${p.id}&include_done=1`)).data;
      assert.equal(list.length, 2);

      const inProgress = (await c.get('/api/tasks?status=rozdelane')).data;
      assert.ok(inProgress.some((t) => t.id === t2.id && t.project_name === 'Úkoly'));
      assert.ok(inProgress.every((t) => t.status === 'rozdelane'));

      const reopened = await c.patch(`/api/tasks/${t1.data.id}`, { status: 'k_udelani' });
      assert.equal(reopened.data.completed_at, null);
      assert.equal((await c.patch(`/api/tasks/${t1.data.id}`, { due_date: null })).data.due_date, null);
    });

    test('odkazy: jen http a https', async () => {
      const p = (await c.post('/api/projects', { name: 'Odkazy', kind: 'prace' })).data;
      const t = (await c.post(`/api/projects/${p.id}/tasks`, { title: 'T' })).data;
      for (const url of ['javascript:alert(1)', 'data:text/html,x', 'example.com', '']) {
        assert.equal((await c.post(`/api/tasks/${t.id}/links`, { url })).status, 400, url);
      }
      const link = await c.post(`/api/tasks/${t.id}/links`, { url: 'https://example.com/x', label: 'Ukázka' });
      assert.equal(link.status, 201);
      assert.deepEqual((await c.get(`/api/tasks/${t.id}`)).data.links, [link.data]);
      assert.equal((await c.delete(`/api/links/${link.data.id}`)).status, 204);
      assert.equal((await c.delete(`/api/links/${link.data.id}`)).status, 404);
    });

    test('nákupní seznam a součty', async () => {
      const p = (await c.post('/api/projects', { name: 'Nákup', kind: 'soukrome' })).data;
      const t = (await c.post(`/api/projects/${p.id}/tasks`, { title: 'Obchod' })).data;
      const milk = (await c.post(`/api/tasks/${t.id}/shopping-items`, { name: 'Mléko', quantity: 2, unit_price: 24.9 })).data;
      assert.equal(milk.quantity, 2);
      assert.equal(milk.unit_price, 24.9);
      const bread = (await c.post(`/api/tasks/${t.id}/shopping-items`, { name: 'Chleba', unit_price: '45,50' })).data;
      assert.equal(bread.quantity, 1);
      assert.equal(bread.unit_price, 45.5);
      await c.post(`/api/tasks/${t.id}/shopping-items`, { name: 'Sůl' });
      assert.equal((await c.post(`/api/tasks/${t.id}/shopping-items`, { name: 'X', quantity: 0 })).status, 400);
      assert.equal((await c.post(`/api/tasks/${t.id}/shopping-items`, { name: 'X', unit_price: -1 })).status, 400);

      let detail = (await c.get(`/api/tasks/${t.id}`)).data;
      assert.deepEqual(detail.shopping_totals, { total: 95.3, remaining: 95.3, unpriced_count: 1 });

      const bought = await c.patch(`/api/shopping-items/${milk.id}`, { bought: true });
      assert.equal(bought.data.bought, true);
      detail = (await c.get(`/api/tasks/${t.id}`)).data;
      assert.deepEqual(detail.shopping_totals, { total: 95.3, remaining: 45.5, unpriced_count: 1 });

      assert.equal((await c.delete(`/api/shopping-items/${bread.id}`)).status, 204);
      assert.equal((await c.get(`/api/tasks/${t.id}`)).data.shopping_items.length, 2);
    });

    test('navazuje na: upozornění, ne blokace; i mezi projekty; ne na sebe', async () => {
      const p1 = (await c.post('/api/projects', { name: 'Závislosti A', kind: 'prace' })).data;
      const p2 = (await c.post('/api/projects', { name: 'Závislosti B', kind: 'soukrome' })).data;
      const first = (await c.post(`/api/projects/${p1.id}/tasks`, { title: 'Nejdřív' })).data;
      const second = (await c.post(`/api/projects/${p2.id}/tasks`, { title: 'Potom' })).data;

      assert.equal((await c.post(`/api/tasks/${second.id}/dependencies`, { depends_on_task_id: second.id })).status, 400);
      assert.equal((await c.post(`/api/tasks/${second.id}/dependencies`, { depends_on_task_id: 999999 })).status, 400);

      const dep = await c.post(`/api/tasks/${second.id}/dependencies`, { depends_on_task_id: first.id });
      assert.equal(dep.status, 201);
      assert.deepEqual(dep.data.waiting_on, [{ id: first.id, title: 'Nejdřív', status: 'k_udelani' }]);
      // opakované přidání nevadí
      assert.equal((await c.post(`/api/tasks/${second.id}/dependencies`, { depends_on_task_id: first.id })).status, 201);

      const listed = (await c.get(`/api/tasks?project_id=${p2.id}`)).data.find((t) => t.id === second.id);
      assert.deepEqual(listed.waiting_on, [{ id: first.id, title: 'Nejdřív', status: 'k_udelani' }]);
      assert.deepEqual((await c.get(`/api/tasks/${first.id}`)).data.dependents.map((d) => d.id), [second.id]);

      // Nic neblokuje: navazující úkol jde dokončit, i když předchůdce hotový není.
      assert.equal((await c.patch(`/api/tasks/${second.id}`, { status: 'hotovo' })).status, 200);

      await c.patch(`/api/tasks/${first.id}`, { status: 'hotovo' });
      assert.deepEqual((await c.get(`/api/tasks/${second.id}`)).data.waiting_on, []);

      assert.equal((await c.delete(`/api/tasks/${second.id}/dependencies/${first.id}`)).status, 204);
      assert.deepEqual((await c.get(`/api/tasks/${second.id}`)).data.depends_on, []);
    });

    test('přesun úkolu do jiného projektu', async () => {
      const a = (await c.post('/api/projects', { name: 'Odkud', kind: 'prace' })).data;
      const b = (await c.post('/api/projects', { name: 'Kam', kind: 'prace' })).data;
      const t = (await c.post(`/api/projects/${a.id}/tasks`, { title: 'Stěhovák' })).data;
      const moved = await c.patch(`/api/tasks/${t.id}`, { project_id: b.id });
      assert.equal(moved.data.project_id, b.id);
      assert.equal((await c.patch(`/api/tasks/${t.id}`, { project_id: 999999 })).status, 400);
    });
  });

  describe('přílohy', () => {
    let c;
    let task;
    before(async () => {
      c = await loggedIn(baseUrl, 'alice', PASSWORD_A);
      const p = (await c.post('/api/projects', { name: 'Přílohy', kind: 'prace' })).data;
      task = (await c.post(`/api/projects/${p.id}/tasks`, { title: 'Se soubory' })).data;
    });

    test('nahrání, stažení s bezpečnými hlavičkami, smazání', async () => {
      const before = await uploadFiles();
      const up = await c.upload(`/api/tasks/${task.id}/attachments`, {
        name: 'Účtenka březen.pdf',
        content: '%PDF-1.4 test',
        type: 'application/pdf',
      });
      assert.equal(up.status, 201);
      assert.equal(up.data.original_name, 'Účtenka březen.pdf');
      assert.equal(up.data.size_bytes, 13);

      const added = (await uploadFiles()).filter((f) => !before.includes(f));
      assert.equal(added.length, 1);
      assert.match(added[0], /^[0-9a-f]{48}$/, 'na disku je vygenerovaný název');

      const dl = await c.get(`/api/attachments/${up.data.id}`);
      assert.equal(dl.status, 200);
      assert.equal(dl.data.toString(), '%PDF-1.4 test');
      assert.equal(dl.headers.get('content-type'), 'application/pdf');
      assert.match(dl.headers.get('content-disposition'), /^attachment;/);
      assert.ok(dl.headers.get('content-disposition').includes(encodeURIComponent('Účtenka březen.pdf')));
      assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');

      assert.equal((await c.delete(`/api/attachments/${up.data.id}`)).status, 204);
      assert.deepEqual(await uploadFiles(), before, 'soubor je smazán i z disku');
      assert.equal((await c.get(`/api/attachments/${up.data.id}`)).status, 404);
    });

    test('HTML a SVG se nikdy nevrací jako spustitelný obsah', async () => {
      for (const [name, type] of [['x.html', 'text/html'], ['x.svg', 'image/svg+xml']]) {
        const up = await c.upload(`/api/tasks/${task.id}/attachments`, { name, content: '<script>alert(1)</script>', type });
        const dl = await c.get(`/api/attachments/${up.data.id}`);
        assert.equal(dl.headers.get('content-type'), 'application/octet-stream', name);
        assert.match(dl.headers.get('content-disposition'), /^attachment;/);
        assert.match(dl.headers.get('content-security-policy'), /sandbox/);
      }
    });

    test('limit 25 MB, po odmítnutí nezůstane soubor na disku', async () => {
      const before = await uploadFiles();
      const big = Buffer.alloc(25 * 1024 * 1024 + 1, 0x61);
      const res = await c.upload(`/api/tasks/${task.id}/attachments`, { name: 'velky.bin', content: big });
      assert.equal(res.status, 413);
      assert.deepEqual(await uploadFiles(), before);
    });

    test('bez CSRF hlavičky ani bez souboru se nic nenahraje', async () => {
      const before = await uploadFiles();
      const res = await c.upload(`/api/tasks/${task.id}/attachments`, { name: 'a.txt', content: 'x' }, { csrf: false });
      assert.equal(res.status, 403);
      const empty = await c.request('POST', `/api/tasks/${task.id}/attachments`, { body: new FormData() });
      assert.equal(empty.status, 400);
      assert.deepEqual(await uploadFiles(), before);
    });

    test('smazání úkolu i projektu smaže soubory z disku', async () => {
      const p = (await c.post('/api/projects', { name: 'Na smazání', kind: 'prace' })).data;
      const t1 = (await c.post(`/api/projects/${p.id}/tasks`, { title: 'A' })).data;
      const t2 = (await c.post(`/api/projects/${p.id}/tasks`, { title: 'B' })).data;
      const before = await uploadFiles();
      await c.upload(`/api/tasks/${t1.id}/attachments`, { name: '1.txt', content: '1' });
      await c.upload(`/api/tasks/${t2.id}/attachments`, { name: '2.txt', content: '2' });
      await c.upload(`/api/tasks/${t2.id}/attachments`, { name: '3.txt', content: '3' });
      assert.equal((await uploadFiles()).length, before.length + 3);

      assert.equal((await c.delete(`/api/tasks/${t1.id}`)).status, 204);
      assert.equal((await uploadFiles()).length, before.length + 2);

      assert.equal((await c.delete(`/api/projects/${p.id}`)).status, 204);
      assert.deepEqual(await uploadFiles(), before);
      assert.equal((await c.get(`/api/tasks/${t2.id}`)).status, 404);
    });
  });

  describe('oddělení dat podle uživatele', () => {
    let alice;
    let bob;
    let a; // data Alice
    before(async () => {
      alice = await loggedIn(baseUrl, 'alice', PASSWORD_A);
      bob = await loggedIn(baseUrl, 'bob', PASSWORD_B);
      const project = (await alice.post('/api/projects', { name: 'Tajný projekt', kind: 'prace' })).data;
      const task = (await alice.post(`/api/projects/${project.id}/tasks`, { title: 'Tajný úkol', status: 'rozdelane' })).data;
      const link = (await alice.post(`/api/tasks/${task.id}/links`, { url: 'https://tajne.example' })).data;
      const item = (await alice.post(`/api/tasks/${task.id}/shopping-items`, { name: 'Tajná věc' })).data;
      const att = (await alice.upload(`/api/tasks/${task.id}/attachments`, { name: 'tajne.txt', content: 'tajné' })).data;
      a = { project, task, link, item, att };
    });

    test('Bob nevidí data Alice v seznamech', async () => {
      const projects = (await bob.get('/api/projects')).data;
      const archived = (await bob.get('/api/projects?archived=1')).data;
      assert.deepEqual([...projects, ...archived], []);
      assert.deepEqual((await bob.get('/api/tasks?include_done=1')).data, []);
      assert.deepEqual((await bob.get('/api/tasks?status=rozdelane')).data, []);
      assert.deepEqual((await bob.get(`/api/tasks?project_id=${a.project.id}&include_done=1`)).data, []);
    });

    test('Bob nemůže číst, měnit ani mazat data Alice (404)', async () => {
      const attempts = [
        ['GET', `/api/projects/${a.project.id}`],
        ['PATCH', `/api/projects/${a.project.id}`, { name: 'hack' }],
        ['DELETE', `/api/projects/${a.project.id}`],
        ['GET', `/api/tasks/${a.task.id}`],
        ['PATCH', `/api/tasks/${a.task.id}`, { title: 'hack' }],
        ['DELETE', `/api/tasks/${a.task.id}`],
        ['POST', `/api/projects/${a.project.id}/tasks`, { title: 'podstrčený' }],
        ['POST', `/api/tasks/${a.task.id}/links`, { url: 'https://evil.example' }],
        ['DELETE', `/api/links/${a.link.id}`],
        ['POST', `/api/tasks/${a.task.id}/shopping-items`, { name: 'x' }],
        ['PATCH', `/api/shopping-items/${a.item.id}`, { bought: true }],
        ['DELETE', `/api/shopping-items/${a.item.id}`],
        ['GET', `/api/attachments/${a.att.id}`],
        ['DELETE', `/api/attachments/${a.att.id}`],
        ['POST', `/api/tasks/${a.task.id}/dependencies`, { depends_on_task_id: a.task.id }],
        ['DELETE', `/api/tasks/${a.task.id}/dependencies/1`],
      ];
      for (const [method, url, json] of attempts) {
        const res = await bob.request(method, url, { json });
        assert.ok([404, 400].includes(res.status), `${method} ${url} vrátil ${res.status}`);
        if (method === 'GET') assert.equal(res.status, 404, `${method} ${url}`);
      }
      const upload = await bob.upload(`/api/tasks/${a.task.id}/attachments`, { name: 'x.txt', content: 'x' });
      assert.equal(upload.status, 404);
    });

    test('Bob nemůže svůj úkol napojit na úkol Alice ani do jejího projektu přesunout', async () => {
      const p = (await bob.post('/api/projects', { name: 'Bobův', kind: 'soukrome' })).data;
      const t = (await bob.post(`/api/projects/${p.id}/tasks`, { title: 'Bobův úkol' })).data;
      assert.equal((await bob.post(`/api/tasks/${t.id}/dependencies`, { depends_on_task_id: a.task.id })).status, 400);
      assert.equal((await bob.patch(`/api/tasks/${t.id}`, { project_id: a.project.id })).status, 400);
    });

    test('data Alice po pokusech Boba zůstala beze změny', async () => {
      const detail = (await alice.get(`/api/tasks/${a.task.id}`)).data;
      assert.equal(detail.title, 'Tajný úkol');
      assert.equal(detail.project_name, 'Tajný projekt');
      assert.deepEqual(detail.links.map((l) => l.id), [a.link.id]);
      assert.equal(detail.shopping_items[0].bought, false);
      assert.deepEqual(detail.attachments.map((x) => x.id), [a.att.id]);
      assert.deepEqual(detail.depends_on, []);
      const dl = await alice.get(`/api/attachments/${a.att.id}`);
      assert.equal(dl.data.toString(), 'tajné');
    });
  });
});
