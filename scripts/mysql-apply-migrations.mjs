import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

async function main() {
  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE;
  const port = Number(process.env.MYSQL_PORT || 3306);

  if (!host || !user || !database) {
    throw new Error('Missing MySQL env vars (MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE)');
  }

  const migrationsDir = resolve(__dirname, '../migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const conn = await mysql.createConnection({ host, user, password, database, port, multipleStatements: true });
  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
    try {
      await conn.query(sql);
      // eslint-disable-next-line no-console
      console.log(`Applied: ${file}`);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        // eslint-disable-next-line no-console
        console.warn(`Skipped (already applied): ${file} — ${err.sqlMessage}`);
        continue;
      }
      throw err;
    }
  }
  await conn.end();
  // eslint-disable-next-line no-console
  console.log('Migrations applied.');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

