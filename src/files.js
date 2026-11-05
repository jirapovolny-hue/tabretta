import fs from 'node:fs/promises';
import path from 'node:path';
import { isValidStoredName } from './attachments.js';

/** Cesta k uloženému souboru; název musí být vygenerovaný (žádné ../). */
export function storedPath(uploadDir, storedName) {
  if (!isValidStoredName(storedName)) throw new Error('Neplatný název uloženého souboru.');
  return path.join(uploadDir, storedName);
}

/**
 * Smaže soubory příloh z disku (po smazání záznamů v DB). Chybějící soubor
 * není chyba; jiné chyby jen zaloguje, aby nezablokovaly odpověď.
 */
export async function removeStoredFiles(uploadDir, storedNames) {
  await Promise.all(
    storedNames.map(async (name) => {
      try {
        await fs.unlink(storedPath(uploadDir, name));
      } catch (err) {
        if (err.code !== 'ENOENT') console.error(`Nelze smazat přílohu ${name}: ${err.message}`);
      }
    }),
  );
}
