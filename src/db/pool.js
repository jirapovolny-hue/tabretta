import pg from 'pg';

// numeric (množství, ceny) vracet jako číslo, ne jako řetězec.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
// date (termín) vracet jako řetězec RRRR-MM-DD, bez posunu časové zóny.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// bigint id vracet jako číslo (hodnoty nepřekročí Number.MAX_SAFE_INTEGER).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export function createPool(connectionString, options = {}) {
  return new pg.Pool({ connectionString, max: 10, ...options });
}

/** Spustí funkci v transakci; při chybě ROLLBACK. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
