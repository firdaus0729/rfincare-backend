import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

async function seedAdmin() {
  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE;
  const port = Number(process.env.MYSQL_PORT || 3306);

  if (!host || !user || !database) {
    console.error('Missing MySQL env vars (MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE)');
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host,
    user,
    password,
    database,
    port,
    namedPlaceholders: true,
  });

  try {
    const adminEmail = 'admin@rfincare.com';
    const adminPass = 'Admin@2026'; // Keep in sync with seed-demo-users.js
    const adminId = randomUUID();
    const hashedPass = await bcrypt.hash(adminPass, 12);

    console.log(`Seeding admin user: ${adminEmail}`);

    // Check if user already exists
    const [existing] = await connection.execute(
      'SELECT id FROM auth_users WHERE email = :email',
      { email: adminEmail }
    );

    if (existing.length > 0) {
      console.log('Admin user already exists. Updating password...');
      await connection.execute(
        'UPDATE auth_users SET password_hash = :ph WHERE id = :id',
        { ph: hashedPass, id: existing[0].id }
      );
      
      await connection.execute(
        `UPDATE user_profiles SET
           role = 'super_admin',
           is_active = 1,
           account_status = 'active',
           failed_login_attempts = 0,
           locked_until = NULL
         WHERE id = :id`,
        { id: existing[0].id }
      );
    } else {
      await connection.execute(
        'INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)',
        { id: adminId, email: adminEmail, ph: hashedPass }
      );

      await connection.execute(
        "INSERT INTO user_profiles (id, email, full_name, role, account_status, is_active) VALUES (:id, :email, 'System Admin', 'super_admin', 'active', 1)",
        { id: adminId, email: adminEmail }
      );
    }

    console.log('Admin user seeded successfully!');
    console.log('Email:', adminEmail);
    console.log('Password:', adminPass);
  } catch (error) {
    console.error('Error seeding admin:', error);
  } finally {
    await connection.end();
  }
}

seedAdmin();
