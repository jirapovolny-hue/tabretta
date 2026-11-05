#!/usr/bin/env node
// Použití: DATABASE_URL=... npm run create-user [-- uzivatelske_jmeno]
// Heslo se zadává interaktivně (skrytě), nikdy jako argument příkazu.
import readline from 'node:readline/promises';
import { createPool } from '../src/db/pool.js';
import { createUser, UserError, validatePassword, validateUsername } from '../src/users.js';

if (!process.env.DATABASE_URL) {
  console.error('Chybí DATABASE_URL.');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Spusť interaktivně v terminálu (heslo se zadává skrytě z klávesnice).');
  process.exit(1);
}

async function askVisible(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Čte řádek z terminálu bez zobrazení znaků.
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new UserError('Přerušeno.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    function cleanup() {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    stdin.on('data', onData);
  });
}

const pool = createPool(process.env.DATABASE_URL, { max: 1 });
try {
  const username = process.argv[2] ?? (await askVisible('Uživatelské jméno: '));
  validateUsername(username);
  const password = await askHidden('Heslo: ');
  validatePassword(password);
  const again = await askHidden('Heslo znovu: ');
  if (again !== password) throw new UserError('Hesla se neshodují.');
  const user = await createUser(pool, username, password);
  console.log(`Uživatel ${user.username} vytvořen (id ${user.id}).`);
} catch (err) {
  console.error(err instanceof UserError ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
