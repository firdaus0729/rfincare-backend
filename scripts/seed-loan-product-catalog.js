/**
 * Seeds default loan product catalog entries (matches frontend static defaults).
 * Run: node scripts/seed-loan-product-catalog.js
 */
import 'dotenv/config';
import { getPool } from '../src/db/pool.js';
import { newId } from '../src/lib/ids.js';

const DEFAULTS = [
  {
    slug: 'personal',
    api_key: 'personal_loan',
    label: 'Personal Loan',
    short_label: 'Personal',
    icon: 'Wallet',
    description:
      'Flexible financing for weddings, education, medical expenses, or debt consolidation.',
    interest_rate_min: 8.5,
    interest_rate_max: 15.9,
    features: ['Up to ₹40 Lakhs', 'Terms 1-5 years', 'Quick approval', 'No collateral required'],
    color: 'var(--color-primary)',
    sort_order: 1,
  },
  {
    slug: 'home',
    api_key: 'home_loan',
    label: 'Home Loan',
    short_label: 'Home',
    icon: 'Home',
    description: 'Competitive rates for purchase, construction, or balance transfer.',
    interest_rate_min: 6.2,
    interest_rate_max: 9.5,
    features: ['Up to ₹5 Crore', 'Terms up to 30 years', 'Tax benefits', 'Balance transfer'],
    color: 'var(--color-secondary)',
    sort_order: 2,
  },
  {
    slug: 'business',
    api_key: 'business_loan',
    label: 'Business Loan',
    short_label: 'Business',
    icon: 'Briefcase',
    description: 'Working capital, equipment finance, and expansion funding for your business.',
    interest_rate_min: 9.0,
    interest_rate_max: 18.0,
    features: ['Up to ₹50 Crore', 'Flexible repayment', 'Working capital', 'Equipment finance'],
    color: 'var(--color-accent)',
    sort_order: 3,
  },
  {
    slug: 'auto',
    api_key: 'auto_loan',
    label: 'Auto Loan',
    short_label: 'Auto',
    icon: 'Car',
    description: 'Finance for new and used vehicles with competitive rates.',
    interest_rate_min: 5.5,
    interest_rate_max: 12.0,
    features: ['Up to ₹1 Crore', 'Terms 2-7 years', 'New & used cars', 'Refinancing'],
    color: 'var(--color-conversion)',
    sort_order: 4,
  },
  {
    slug: 'education',
    api_key: 'education_loan',
    label: 'Education Loan',
    short_label: 'Education',
    icon: 'GraduationCap',
    description: 'Fund higher education in India or abroad with moratorium options.',
    interest_rate_min: 7.5,
    interest_rate_max: 15.0,
    features: ['Moratorium period', 'Tax benefits', 'Tuition & living costs', 'Study abroad'],
    color: '#0ea5e9',
    sort_order: 5,
  },
];

async function main() {
  const pool = getPool();
  let inserted = 0;

  for (const p of DEFAULTS) {
    const [[existing]] = await pool.execute(
      `SELECT id FROM loan_product_catalog WHERE slug = :slug OR api_key = :api_key LIMIT 1`,
      { slug: p.slug, api_key: p.api_key },
    );
    if (existing) continue;

    await pool.execute(
      `INSERT INTO loan_product_catalog (
        id, slug, api_key, label, short_label, icon, description,
        interest_rate_min, interest_rate_max, features, color, sort_order, is_active
      ) VALUES (
        :id, :slug, :api_key, :label, :short_label, :icon, :description,
        :interest_rate_min, :interest_rate_max, :features, :color, :sort_order, 1
      )`,
      {
        id: newId(),
        ...p,
        features: JSON.stringify(p.features),
      },
    );
    inserted += 1;
  }

  console.log(`Loan product catalog: ${inserted} new row(s) seeded.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
