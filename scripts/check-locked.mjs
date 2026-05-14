import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { getPool } from '../src/db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

async function checkLockedUsers() {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT email, account_status, failed_login_attempts, locked_until FROM user_profiles'
    );
    console.table(rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkLockedUsers();
