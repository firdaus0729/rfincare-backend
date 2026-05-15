/**
 * Seeds sample bank_products per loan type for existing banks (by name match).
 * Run: npm run seed:bank-products
 */
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from '../src/db/pool.js';
import { newId } from '../src/lib/ids.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const PRODUCT_TEMPLATES = [
  {
    loanType: 'education_loan',
    nameSuffix: 'Education Loan',
    data: {
      loan_type: 'education_loan',
      interest_rate_min: 7.5,
      interest_rate_max: 12.5,
      max_loan_amount: 15000000,
      max_tenure_years: 15,
      processing_fee_percentage: 1,
      features: ['Moratorium during study', 'Covers tuition & living', 'Tax benefits under 80E', 'India & abroad'],
    },
  },
  {
    loanType: 'personal_loan',
    nameSuffix: 'Personal Loan',
    data: {
      loan_type: 'personal_loan',
      interest_rate_min: 10.5,
      interest_rate_max: 16,
      max_loan_amount: 4000000,
      max_tenure_years: 5,
      processing_fee_percentage: 2,
      features: ['Quick disbursal', 'No collateral', 'Flexible tenure'],
    },
  },
  {
    loanType: 'home_loan',
    nameSuffix: 'Home Loan',
    data: {
      loan_type: 'home_loan',
      interest_rate_min: 8.4,
      interest_rate_max: 9.8,
      max_loan_amount: 50000000,
      max_tenure_years: 30,
      processing_fee_percentage: 0.5,
      features: ['Balance transfer', 'Tax benefits', 'Long tenure'],
    },
  },
];

async function seed() {
  const pool = getPool();
  const [banks] = await pool.execute(`SELECT id, name FROM banks WHERE status = 'active'`);

  if (!banks.length) {
    console.log('No active banks found. Add banks in admin first.');
    process.exit(0);
  }

  let inserted = 0;
  for (const bank of banks) {
    for (const template of PRODUCT_TEMPLATES) {
      const productName = `${bank.name} ${template.nameSuffix}`;
      const [[existing]] = await pool.execute(
        `SELECT id FROM bank_products WHERE bank_id = :bankId AND name = :name LIMIT 1`,
        { bankId: bank.id, name: productName },
      );
      if (existing) continue;

      await pool.execute(
        `INSERT INTO bank_products (id, bank_id, name, is_active, data)
         VALUES (:id, :bankId, :name, 1, :data)`,
        {
          id: newId(),
          bankId: bank.id,
          name: productName,
          data: JSON.stringify(template.data),
        },
      );
      inserted += 1;
    }
  }

  console.log(`Seeded ${inserted} bank product(s) across ${banks.length} bank(s).`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
