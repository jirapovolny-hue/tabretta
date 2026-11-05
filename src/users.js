import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt bere jen prvních 72 bajtů

export class UserError extends Error {}

export function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(username)) {
    throw new UserError('Uživatelské jméno: 1 až 64 znaků, jen písmena bez diakritiky, číslice, tečka, pomlčka, podtržítko.');
  }
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(`Heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků.`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH) {
    throw new UserError(`Heslo smí mít nejvýš ${MAX_PASSWORD_LENGTH} bajtů.`);
  }
}

export async function createUser(db, username, password) {
  validateUsername(username);
  validatePassword(password);
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    const { rows } = await db.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, hash],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new UserError(`Uživatel ${username} už existuje.`);
    throw err;
  }
}

// Hash pro porovnání, když uživatel neexistuje (stejná doba odpovědi).
let dummyHash;
function getDummyHash() {
  dummyHash ??= bcrypt.hashSync('tabretta-neexistujici-uzivatel', BCRYPT_COST);
  return dummyHash;
}

/** Ověří jméno a heslo; vrací { id, username } nebo null. */
export async function verifyCredentials(db, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64) return null;
  if (Buffer.byteLength(password, 'utf8') > 1024) return null;
  const { rows } = await db.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : getDummyHash());
  return user && ok ? { id: user.id, username: user.username } : null;
}
