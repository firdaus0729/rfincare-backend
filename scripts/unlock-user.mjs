import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { getPool } from '../src/db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

async function unlockUser(email) {
  if (!email) {
    console.error('Please provide an email address.');
    process.exit(1);
  }

  try {
    const pool = getPool();
    
    // Check if user exists
    const [[user]] = await pool.execute(
      'SELECT id, email, account_status FROM user_profiles WHERE email = :email LIMIT 1',
      { email }
    );

    if (!user) {
      console.error(`User with email ${email} not found.`);
      process.exit(1);
    }

    console.log(`Unlocking user: ${email} (Current status: ${user.account_status})`);

    await pool.execute(
      `UPDATE user_profiles 
       SET failed_login_attempts = 0, 
           account_status = 'active', 
           locked_until = NULL 
       WHERE id = :id`,
      { id: user.id }
    );

    console.log(`Successfully unlocked user: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error('Error unlocking user:', err);
    process.exit(1);
  }
}

const emailArg = process.argv[2];
unlockUser(emailArg);
