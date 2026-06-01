import { calculateCommissionFromApplication } from './agentCustomerProvision.js';

export const FINANCIAL_SUMMARY_COLUMNS = [
  'bank_name',
  'loan_type',
  'total_cases',
  'approved',
  'rejected',
  'pending',
  'disbursed',
  'loan_amount',
  'disbursed_amount',
  'commission_earned',
  'agent_payout',
  'net_revenue',
  'approval_pct',
  'avg_ticket_size',
  'approval_ratio_pct',
  'disbursement_ratio_pct',
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

function loanTypeFromRow(row) {
  const data = parseJson(row.data);
  return (
    row.loan_type
    || data.loan_type_label
    || data.loan_type
    || data.loan_purpose
    || 'unknown'
  );
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

function isPending(row) {
  return !isApproved(row) && !isRejected(row);
}

function roundMoney(n) {
  return Math.round(Number(n) || 0);
}

function roundPct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

/**
 * Build financial summary grouped by bank + loan type for a date range.
 */
export async function buildFinancialSummaryRows(pool, { start, end }) {
  const [[commissionConfig]] = await pool.execute(
    `SELECT * FROM global_commission_config WHERE id = 'default' LIMIT 1`,
  );

  const [apps] = await pool.execute(
    `SELECT la.id, la.status, la.bank_approval_status, la.document_stage_status,
            la.data, la.agent_id, la.selected_bank_id,
            COALESCE(b.name, 'Unassigned') AS bank_name
     FROM loan_applications la
     LEFT JOIN banks b ON b.id = la.selected_bank_id
     WHERE la.created_at BETWEEN :start AND :end`,
    { start, end },
  );

  const groups = new Map();

  for (const row of apps) {
    const bankName = row.bank_name || 'Unassigned';
    const loanType = loanTypeFromRow(row);
    const key = `${bankName}\0${loanType}`;

    if (!groups.has(key)) {
      groups.set(key, {
        bank_name: bankName,
        loan_type: loanType,
        total_cases: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        disbursed: 0,
        loan_amount: 0,
        disbursed_amount: 0,
        commission_earned: 0,
        agent_payout: 0,
      });
    }

    const g = groups.get(key);
    const amount = loanAmountFromRow(row);
    g.total_cases += 1;
    g.loan_amount += amount;

    if (isApproved(row)) g.approved += 1;
    if (isRejected(row)) g.rejected += 1;
    if (isPending(row)) g.pending += 1;
    if (isDisbursed(row)) {
      g.disbursed += 1;
      g.disbursed_amount += amount;
    }

    if (isApproved(row) || isDisbursed(row)) {
      const commission = calculateCommissionFromApplication(
        { data: row.data, status: row.status },
        commissionConfig,
      );
      g.commission_earned += commission;
      if (row.agent_id) {
        g.agent_payout += commission;
      }
    }
  }

  const rows = [...groups.values()]
    .map((g) => {
      const loanAmount = roundMoney(g.loan_amount);
      const disbursedAmount = roundMoney(g.disbursed_amount);
      const commissionEarned = roundMoney(g.commission_earned);
      const agentPayout = roundMoney(g.agent_payout);
      const netRevenue = commissionEarned - agentPayout;
      const approvalPct = roundPct(g.approved, g.total_cases);
      const avgTicketSize = g.total_cases ? roundMoney(loanAmount / g.total_cases) : 0;
      const decided = g.approved + g.rejected;
      const approvalRatioPct = roundPct(g.approved, decided);
      const disbursementRatioPct = roundPct(g.disbursed, g.approved);

      return {
        bank_name: g.bank_name,
        loan_type: g.loan_type,
        total_cases: g.total_cases,
        approved: g.approved,
        rejected: g.rejected,
        pending: g.pending,
        disbursed: g.disbursed,
        loan_amount: loanAmount,
        disbursed_amount: disbursedAmount,
        commission_earned: commissionEarned,
        agent_payout: agentPayout,
        net_revenue: netRevenue,
        approval_pct: approvalPct,
        avg_ticket_size: avgTicketSize,
        approval_ratio_pct: approvalRatioPct,
        disbursement_ratio_pct: disbursementRatioPct,
      };
    })
    .sort((a, b) => {
      const bank = String(a.bank_name).localeCompare(String(b.bank_name));
      if (bank !== 0) return bank;
      return String(a.loan_type).localeCompare(String(b.loan_type));
    });

  return { columns: FINANCIAL_SUMMARY_COLUMNS, rows };
}
