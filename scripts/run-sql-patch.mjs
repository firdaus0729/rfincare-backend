/**
 * Run a single SQL patch file (skips if column already exists).
 *
 * Usage:
 *   npm run db:patch:story-photo
 *   node scripts/run-sql-patch.mjs migrations/005_success_stories_photo.sql
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const fileArg = process.argv[2] || 'migrations/005_success_stories_photo.sql';
const sqlPath = resolve(__dirname, '..', fileArg);

async function main() {
  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE;
  const port = Number(process.env.MYSQL_PORT || 3306);

  if (!host || !user || !database) {
    throw new Error('Missing MYSQL_HOST, MYSQL_USER, or MYSQL_DATABASE in backend/.env');
  }

  const sql = readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection({
    host,
    user,
    password,
    database,
    port,
    multipleStatements: true,
  });

  try {
    await conn.query(sql);
    console.log(`✅ Applied: ${fileArg}`);
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log(`⏭️  Skipped (column already exists): ${err.sqlMessage}`);
    } else {
      throw err;
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
