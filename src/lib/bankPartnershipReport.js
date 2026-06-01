import { calculateCommissionFromApplication } from './agentCustomerProvision.js';

export const BANK_PARTNERSHIP_COLUMNS = [
  'bank_name',
  'status',
  'commission_slab',
  'submitted_cases',
  'approved_cases',
  'rejected_cases',
  'approval_rate',
  'disbursed_amount',
  'commission_earned',
  'avg_processing_time_days',
  'approval_pct',
];

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function loanAmountFromRow(row) {
  const data = parseJson(row.data);
  return Number(
    data.requested_loan_amount
      || data.requestedLoanAmount
      || data.loan_amount
      || data.loanAmount
      || 0,
  );
}

function isSubmitted(row) {
  const s = String(row.status || '').toLowerCase();
  return s !== 'draft' || row.submitted_at != null;
}

function isApproved(row) {
  const s = String(row.status || '').toLowerCase();
  return s === 'approved' || s === 'disbursed';
}

function isRejected(row) {
  const s = String(row.status || '').toLowerCase();
  return s === 'rejected' || row.bank_approval_status === 'bank_rejected';
}

function isDisbursed(row) {
  const s = String(row.status || '').toLowerCase();
  return s === 'disbursed' || row.bank_approval_status === 'at_disbursement_stage';
}

function processingDays(row) {
  const start = row.submitted_at || row.created_at;
  const end = row.reviewed_at || row.updated_at;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return null;
  return ms / (1000 * 60 * 60 * 24);
}

function formatCommissionSlab(config) {
  if (!config) return '—';
  const type = config.commission_type || 'percentage';
  const val = Number(config.commission_value ?? 2.5);
  if (type === 'fixed') return `₹${val.toLocaleString('en-IN')} per case`;
  return `${val}% of loan amount`;
}

function roundPct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function roundMoney(n) {
  return Math.round(Number(n) || 0);
}

/**
 * Bank partnership report — one row per bank with case metrics for the period.
 */
export async function buildBankPartnershipRows(pool, { start, end }) {
  const [[commissionConfig]] = await pool.execute(
    `SELECT * FROM global_commission_config WHERE id = 'default' LIMIT 1`,
  );
  const commissionSlab = formatCommissionSlab(commissionConfig);

  const [banks] = await pool.execute(
    `SELECT id, name, status FROM banks ORDER BY display_priority DESC, name ASC`,
  );

  const [apps] = await pool.execute(
    `SELECT la.id, la.status, la.bank_approval_status, la.data,
            la.selected_bank_id, la.submitted_at, la.created_at, la.reviewed_at, la.updated_at
     FROM loan_applications la
     WHERE la.selected_bank_id IS NOT NULL
       AND la.created_at BETWEEN :start AND :end`,
    { start, end },
  );

  const byBank = new Map();
  for (const bank of banks) {
    byBank.set(bank.id, {
      bank_name: bank.name,
      status: bank.status || 'active',
      commission_slab: commissionSlab,
      submitted_cases: 0,
      approved_cases: 0,
      rejected_cases: 0,
      disbursed_amount: 0,
      commission_earned: 0,
      processingDays: [],
    });
  }

  for (const row of apps) {
    const bankId = row.selected_bank_id;
    if (!bankId || !byBank.has(bankId)) continue;

    const g = byBank.get(bankId);
    const amount = loanAmountFromRow(row);

    if (isSubmitted(row)) g.submitted_cases += 1;
    if (isApproved(row)) g.approved_cases += 1;
    if (isRejected(row)) g.rejected_cases += 1;

    if (isDisbursed(row)) {
      g.disbursed_amount += amount;
    }

    if (isApproved(row) || isDisbursed(row)) {
      g.commission_earned += calculateCommissionFromApplication(
        { data: row.data, status: row.status },
        commissionConfig,
      );
    }

    const days = processingDays(row);
    if (days != null && (isApproved(row) || isRejected(row))) {
      g.processingDays.push(days);
    }
  }

  const rows = [...byBank.values()].map((g) => {
    const submitted = g.submitted_cases;
    const approved = g.approved_cases;
    const approvalPct = roundPct(approved, submitted);
    const avgDays =
      g.processingDays.length > 0
        ? Math.round((g.processingDays.reduce((a, b) => a + b, 0) / g.processingDays.length) * 10) / 10
        : null;

    return {
      bank_name: g.bank_name,
      status: g.status,
      commission_slab: g.commission_slab,
      submitted_cases: submitted,
      approved_cases: approved,
      rejected_cases: g.rejected_cases,
      approval_rate: approvalPct,
      disbursed_amount: roundMoney(g.disbursed_amount),
      commission_earned: roundMoney(g.commission_earned),
      avg_processing_time_days: avgDays,
      approval_pct: approvalPct,
    };
  });

  return { columns: BANK_PARTNERSHIP_COLUMNS, rows };
}
