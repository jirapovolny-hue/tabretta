import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHttpUrl } from '../src/validate.js';
import {
  contentDisposition,
  generateStoredName,
  isValidStoredName,
  safeContentType,
  sanitizeOriginalName,
} from '../src/attachments.js';
import { loadConfig, ConfigError } from '../src/config.js';

test('odkazy: povoleny jen http a https', () => {
  assert.equal(normalizeHttpUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normalizeHttpUrl('  http://example.com  '), 'http://example.com/');
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    'ftp://example.com',
    '//example.com',
    'example.com',
    '',
    null,
    42,
    `https://example.com/${'a'.repeat(2001)}`,
  ]) {
    assert.equal(normalizeHttpUrl(bad), null, `má odmítnout: ${String(bad).slice(0, 40)}`);
  }
});

test('přílohy: vygenerovaný název je náhodný a ověřitelný', () => {
  const a = generateStoredName();
  const b = generateStoredName();
  assert.notEqual(a, b);
  assert.ok(isValidStoredName(a));
  for (const bad of ['../etc/passwd', 'abc', `${a}.html`, a.toUpperCase(), null]) {
    assert.equal(isValidStoredName(bad), false);
  }
});

test('přílohy: nebezpečné typy jdou jako octet-stream', () => {
  assert.equal(safeContentType('image/jpeg'), 'image/jpeg');
  assert.equal(safeContentType('application/pdf'), 'application/pdf');
  assert.equal(safeContentType('text/plain'), 'text/plain; charset=utf-8');
  for (const t of ['text/html', 'image/svg+xml', 'application/javascript', 'application/xhtml+xml', '', undefined]) {
    assert.equal(safeContentType(t), 'application/octet-stream');
  }
});

test('přílohy: Content-Disposition je vždy attachment a bez injekce hlaviček', () => {
  const cd = contentDisposition('Účtenka "březen".pdf');
  assert.match(cd, /^attachment; filename="Uctenka _brezen_\.pdf"; filename\*=UTF-8''/);
  assert.ok(cd.includes(encodeURIComponent('Účtenka "březen".pdf')));
  assert.ok(!contentDisposition('a\r\nSet-Cookie: x=1').includes('\n'));
  assert.equal(sanitizeOriginalName('../../x/y.txt'), '.._.._x_y.txt');
  assert.equal(sanitizeOriginalName(''), 'soubor');
});

test('konfigurace: výchozí port, povinné proměnné, absolutní UPLOAD_DIR', () => {
  const base = {
    DATABASE_URL: 'postgres://x@127.0.0.1/x',
    SESSION_SECRET: 's'.repeat(32),
    UPLOAD_DIR: '/srv/data/uploads',
  };
  const cfg = loadConfig(base);
  assert.equal(cfg.port, 3100);
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.cookieSecure, true);
  assert.equal(loadConfig({ ...base, PORT: '3200', COOKIE_SECURE: '0' }).cookieSecure, false);
  assert.throws(() => loadConfig({ ...base, UPLOAD_DIR: 'uploads' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, SESSION_SECRET: 'kratke' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, PORT: 'abc' }), ConfigError);
  assert.throws(() => loadConfig({}), ConfigError);
});
