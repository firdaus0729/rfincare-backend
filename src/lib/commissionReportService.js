import { getPool } from '../db/pool.js';
import { buildSimpleTextPdf } from './simplePdf.js';
import { ensureMilestone4Schema } from '../db/ensureMilestone4Schema.js';

const TDS_RATE = 0.1;

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function mapCommissionStatus(appStatus, row) {
  if (row.commission_status) return row.commission_status;
  const s = String(appStatus || '').toLowerCase();
  if (s === 'disbursed') return 'paid';
  if (['approved'].includes(s)) return 'in_process';
  if (['rejected', 'draft'].includes(s)) return 'ineligible';
  if (['submitted', 'under_review', 'documents_pending'].includes(s)) return 'pending';
  return 'pending';
}

function resolveCommissionRate(config, loanType) {
  const rate = Number(config?.commission_value ?? 2.5);
  return config?.commission_type === 'fixed' ? null : rate;
}

function computeRowCommission(row, config) {
  const data = parseJson(row.data);
  const disbursed = Number(row.disbursed_amount || 0);
  const requested = Number(
    data.requested_loan_amount || data.loan_amount || data.requestedLoanAmount || 0,
  );
  const base = disbursed > 0 ? disbursed : requested;
  const rate = row.commission_rate != null ? Number(row.commission_rate) : resolveCommissionRate(config, row.loan_type);
  if (!base || base <= 0) return { gross: 0, rate: rate || 0, tds: 0, net: 0 };
  const gross =
    row.commission_amount != null
      ? Number(row.commission_amount)
      : rate
        ? Math.round((base * rate) / 100)
        : 0;
  const tds = row.tds_amount != null ? Number(row.tds_amount) : Math.round(gross * TDS_RATE);
  const net = row.net_payout != null ? Number(row.net_payout) : gross - tds;
  return { gross, rate: rate || 0, tds, net, base };
}

export async function buildAgentCommissionReport(agentId, filters = {}) {
  await ensureMilestone4Schema();
  const pool = getPool();
  const [[config]] = await pool.execute(
    `SELECT * FROM global_commission_config WHERE id = 'default' LIMIT 1`,
  );

  const conditions = ['la.agent_id = :agentId'];
  const params = { agentId };

  if (filters.from) {
    conditions.push('la.created_at >= :from');
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push('la.created_at <= :to');
    params.to = `${filters.to} 23:59:59`;
  }
  if (filters.applicationStatus && filters.applicationStatus !== 'all') {
    conditions.push('la.status = :appStatus');
    params.appStatus = filters.applicationStatus;
  }
  if (filters.commissionStatus && filters.commissionStatus !== 'all') {
    conditions.push('COALESCE(la.commission_status, :fallback) = :commStatus');
    params.commStatus = filters.commissionStatus;
    params.fallback = filters.commissionStatus;
  }
  if (filters.loanType && filters.loanType !== 'all') {
    conditions.push(
      `JSON_UNQUOTE(JSON_EXTRACT(la.data, '$.loan_type')) = :loanType OR JSON_UNQUOTE(JSON_EXTRACT(la.data, '$.loan_purpose')) = :loanType`,
    );
    params.loanType = filters.loanType;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `SELECT la.*, c.full_name AS customer_name, ao.agent_code, ao.agent_name
     FROM loan_applications la
     JOIN user_profiles c ON c.id = la.customer_id
     LEFT JOIN agent_onboarding ao ON ao.user_id = la.agent_id
     ${where}
     ORDER BY la.created_at DESC`,
    params,
  );

  const generatedAt = new Date().toISOString();
  const entries = rows.map((row) => {
    const data = parseJson(row.data);
    const loanType = data.loan_type || data.loan_purpose || row.loan_type;
    const comm = computeRowCommission(row, config);
    return {
      applicationNumber: row.application_number,
      customerName: row.customer_name,
      loanType,
      applicationStatus: row.status,
      commissionStatus: mapCommissionStatus(row.status, row),
      disbursedAmount: comm.base,
      disbursedAt: row.disbursed_at,
      commissionRatePercent: comm.rate,
      grossCommission: comm.gross,
      tdsAmount: comm.tds,
      netPayout: comm.net,
      agentCode: row.agent_code,
      agentName: row.agent_name,
      createdAt: row.created_at,
      generatedAt,
    };
  });

  return { generatedAt, entries, config };
}

export function commissionReportToCsv(report) {
  const header = [
    'application_number',
    'customer_name',
    'loan_type',
    'application_status',
    'commission_status',
    'disbursed_amount',
    'disbursed_at',
    'commission_rate_percent',
    'gross_commission',
    'tds_amount',
    'net_payout',
    'agent_code',
    'generated_at',
  ];
  const lines = [header.join(',')];
  for (const e of report.entries) {
    lines.push(
      [
        e.applicationNumber,
        `"${(e.customerName || '').replace(/"/g, '""')}"`,
        e.loanType,
        e.applicationStatus,
        e.commissionStatus,
        e.disbursedAmount,
        e.disbursedAt || '',
        e.commissionRatePercent,
        e.grossCommission,
        e.tdsAmount,
        e.netPayout,
        e.agentCode,
        e.generatedAt,
      ].join(','),
    );
  }
  return lines.join('\n');
}

export function commissionReportToPdf(report) {
  const lines = [
    'Rfincare — Agent Commission Report',
    `Generated: ${report.generatedAt}`,
    '',
    ...report.entries.map(
      (e, i) =>
        `${i + 1}. ${e.applicationNumber} | ${e.customerName} | ${e.loanType} | `
        + `Status ${e.applicationStatus} | Comm ${e.commissionStatus} | `
        + `Disbursed ${e.disbursedAmount} | Gross ${e.grossCommission} | TDS ${e.tdsAmount} | Net ${e.netPayout}`,
    ),
  ];
  return buildSimpleTextPdf(lines);
}
