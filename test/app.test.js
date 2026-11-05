import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../src/app.js';

// Testy middlewaru bez databáze: aplikace s jednoduchým testovacím routerem.
let server;
let baseUrl;

before(async () => {
  const router = express.Router();
  router.get('/ping', (req, res) => res.json({ ok: true }));
  router.post('/echo', (req, res) => res.json({ body: req.body }));
  router.get('/boom', () => {
    throw new Error('tajný detail');
  });
  const app = createApp({ config: { cookieSecure: true }, apiRouter: router });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('CSRF: POST bez hlavičky X-Requested-With je odmítnut', async () => {
  const res = await fetch(`${baseUrl}/api/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 403);
});

test('CSRF: odmítnut i multipart (nahrávání) a formulář bez hlavičky', async () => {
  const form = new FormData();
  form.append('file', new Blob(['x']), 'x.txt');
  assert.equal((await fetch(`${baseUrl}/api/echo`, { method: 'POST', body: form })).status, 403);
  const res = await fetch(`${baseUrl}/api/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'a=1',
  });
  assert.equal(res.status, 403);
});

test('CSRF: s hlavičkou projde, GET hlavičku nepotřebuje', async () => {
  const res = await fetch(`${baseUrl}/api/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { body: { a: 1 } });
  assert.equal((await fetch(`${baseUrl}/api/ping`)).status, 200);
});

test('bezpečnostní hlavičky a CSP bez inline skriptů', async () => {
  const res = await fetch(`${baseUrl}/api/ping`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!csp.includes('unsafe-inline'));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('chyby: neznámá API cesta 404, výjimka 500 bez detailů', async () => {
  assert.equal((await fetch(`${baseUrl}/api/neexistuje`)).status, 404);
  const res = await fetch(`${baseUrl}/api/boom`);
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.ok(!text.includes('tajný detail'));
});
