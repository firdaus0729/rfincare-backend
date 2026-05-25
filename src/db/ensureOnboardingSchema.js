import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let ensured = false;

export async function ensureOnboardingSchema() {
  if (ensured) return;
  const sql = readFileSync(join(__dirname, '../../migrations/009_agent_employee_onboarding.sql'), 'utf8');
  const pool = getPool();
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const statement of statements) {
    await pool.execute(statement);
  }
  ensured = true;
}
