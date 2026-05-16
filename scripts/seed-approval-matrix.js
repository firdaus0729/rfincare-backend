/**
 * Seeds sample approval_matrix_rules for active banks.
 * Run: npm run seed:approval-matrix
 */
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from '../src/db/pool.js';
import { newId } from '../src/lib/ids.js';
import { ensureApprovalMatrixSchema } from '../src/db/ensureApprovalMatrixSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

async function seed() {
  await ensureApprovalMatrixSchema();
  const pool = getPool();
  const [banks] = await pool.execute(`SELECT id, name FROM banks WHERE status = 'active' LIMIT 20`);

  if (!banks.length) {
    console.log('No active banks. Add banks in marketplace management first.');
    process.exit(0);
  }

  let inserted = 0;
  for (const bank of banks) {
    const ruleName = `${bank.name} — Standard eligibility`;
    const [[existing]] = await pool.execute(
      `SELECT id FROM approval_matrix_rules WHERE bank_id = :bankId AND rule_name = :ruleName LIMIT 1`,
      { bankId: bank.id, ruleName },
    );
    if (existing) continue;

    await pool.execute(
      `INSERT INTO approval_matrix_rules (
         id, bank_id, rule_name, priority, is_active, approval_probability, data
       ) VALUES (
         :id, :bank_id, :rule_name, 10, 1, 75, :data
       )`,
      {
        id: newId(),
        bank_id: bank.id,
        rule_name: ruleName,
        data: JSON.stringify({
          loan_type: 'personal_loan',
          min_annual_income: 300000,
          min_credit_score: 650,
          employment_types: ['salaried', 'self_employed'],
          min_loan_amount: 50000,
          max_loan_amount: 4000000,
        }),
      },
    );
    inserted += 1;
  }

  console.log(`Seeded ${inserted} approval matrix rule(s) for ${banks.length} bank(s).`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
