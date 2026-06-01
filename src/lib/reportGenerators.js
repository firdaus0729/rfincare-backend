import { buildFinancialSummaryRows } from './financialSummaryReport.js';
import { buildBankPartnershipRows } from './bankPartnershipReport.js';
import { ensureOnboardingSchema } from '../db/ensureOnboardingSchema.js';

export function normalizeReportRows(rows, columns) {
  return rows.map((row) => {
    const out = {};
    for (const col of columns) {
      const v = row[col];
      if (v instanceof Date) out[col] = v.toISOString();
      else if (typeof v === 'bigint') out[col] = Number(v);
      else out[col] = v ?? null;
    }
    return out;
  });
}

/** Generate one report section (columns + plain rows). */
export async function generateReportSection(pool, reportKey, params) {
  let rows = [];
  let columns = [];

  switch (reportKey) {
    case 'application_volume':
      columns = [
        'application_id',
        'application_number',
        'customer_name',
        'customer_mobile',
        'customer_email',
        'agent_code',
        'status',
        'document_stage_status',
        'bank_approval_status',
        'created_at',
      ];
      [rows] = await pool.execute(
        `SELECT
            la.id AS application_id,
            la.application_number,
            COALESCE(up.full_name, '') AS customer_name,
            COALESCE(up.phone, '') AS customer_mobile,
            up.email AS customer_email,
            la.status,
            COALESCE(la.sourced_agent_code, ao.agent_code, '') AS agent_code,
            la.document_stage_status,
            la.bank_approval_status,
            la.created_at
         FROM loan_applications la
         JOIN user_profiles up ON up.id = la.customer_id
         LEFT JOIN agent_onboarding ao ON ao.user_id = la.agent_id
         WHERE la.created_at BETWEEN :start AND :end
         ORDER BY la.created_at DESC`,
        params,
      );
      break;
    case 'agent_performance':
      columns = [
        'agent_name',
        'agent_code',
        'customer_code',
        'application_number',
        'customer_name',
        'loan_type',
        'status',
        'document_stage_status',
        'bank_approval_status',
        'payout_status',
        'created_at',
      ];
      [rows] = await pool.execute(
        `SELECT
            COALESCE(agent_up.full_name, ao.agent_name, '—') AS agent_name,
            COALESCE(
              NULLIF(TRIM(ao.agent_code), ''),
              NULLIF(TRIM(la.sourced_agent_code), ''),
              ''
            ) AS agent_code,
            COALESCE(cust.customer_code, '') AS customer_code,
            la.application_number,
            COALESCE(cust.full_name, '') AS customer_name,
            COALESCE(
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(la.data, '$.loan_type_label')), ''),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(la.data, '$.loan_type')), ''),
              NULLIF(JSON_UNQUOTE(JSON_EXTRACT(la.data, '$.loan_purpose')), ''),
              ''
            ) AS loan_type,
            la.status,
            la.document_stage_status,
            la.bank_approval_status,
            CASE
              WHEN (la.agent_id IS NULL OR TRIM(la.agent_id) = '')
                   AND (la.sourced_agent_code IS NULL OR TRIM(la.sourced_agent_code) = '')
              THEN 'Not Applicable'
              WHEN la.status = 'approved' THEN 'Paid'
              WHEN la.status IN ('submitted', 'under_review', 'pending') THEN 'Processed'
              ELSE 'Pending'
            END AS payout_status,
            la.created_at
         FROM loan_applications la
         INNER JOIN user_profiles cust ON cust.id = la.customer_id
         LEFT JOIN user_profiles agent_up ON agent_up.id = la.agent_id AND agent_up.role = 'agent'
         LEFT JOIN agent_onboarding ao ON ao.user_id = la.agent_id
         WHERE la.created_at BETWEEN :start AND :end
           AND (
             la.agent_id IS NOT NULL
             OR (la.sourced_agent_code IS NOT NULL AND TRIM(la.sourced_agent_code) != '')
           )
         ORDER BY la.created_at DESC`,
        params,
      );
      break;
    case 'agent_payout_accounts':
      columns = [
        'agent_name',
        'agent_code',
        'payout_email',
        'payout_mobile',
        'commission_account_number',
        'commission_bank_name',
        'commission_ifsc_code',
        'payout_bank_ready',
        'applications_in_period',
        'approved_in_period',
      ];
      [rows] = await pool.execute(
        `SELECT MAX(up.full_name) AS agent_name,
                COALESCE(NULLIF(MAX(ao.agent_code), ''), '') AS agent_code,
                COALESCE(NULLIF(MAX(ao.email), ''), MAX(up.email), '') AS payout_email,
                COALESCE(NULLIF(MAX(ao.mobile_number), ''), MAX(up.phone), '') AS payout_mobile,
                COALESCE(MAX(ao.account_number), '') AS commission_account_number,
                COALESCE(MAX(ao.bank_name), '') AS commission_bank_name,
                COALESCE(MAX(ao.ifsc_code), '') AS commission_ifsc_code,
                CASE
                  WHEN MAX(ao.account_number) IS NOT NULL AND TRIM(MAX(ao.account_number)) != ''
                   AND MAX(ao.bank_name) IS NOT NULL AND TRIM(MAX(ao.bank_name)) != ''
                   AND MAX(ao.ifsc_code) IS NOT NULL AND TRIM(MAX(ao.ifsc_code)) != ''
                  THEN 'yes'
                  ELSE 'no'
                END AS payout_bank_ready,
                COUNT(la.id) AS applications_in_period,
                SUM(CASE WHEN la.status = 'approved' THEN 1 ELSE 0 END) AS approved_in_period
         FROM user_profiles up
         LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
         LEFT JOIN loan_applications la ON la.agent_id = up.id AND la.created_at BETWEEN :start AND :end
         WHERE up.role = 'agent'
         GROUP BY up.id
         ORDER BY agent_name`,
        params,
      );
      break;
    case 'financial_summary': {
      const summary = await buildFinancialSummaryRows(pool, params);
      return { columns: summary.columns, rows: summary.rows };
    }
    case 'compliance_audit':
      columns = ['action_type', 'table_name', 'record_id', 'user_id', 'created_at'];
      [rows] = await pool.execute(
        `SELECT action_type, table_name, record_id, user_id, created_at
         FROM audit_logs
         WHERE created_at BETWEEN :start AND :end
         ORDER BY created_at DESC
         LIMIT 5000`,
        params,
      );
      break;
    case 'customer_analytics':
      columns = ['customer_code', 'full_name', 'email', 'is_active', 'account_status', 'created_at'];
      [rows] = await pool.execute(
        `SELECT customer_code, full_name, email, is_active, account_status, created_at
         FROM user_profiles
         WHERE role = 'customer' AND created_at BETWEEN :start AND :end
         ORDER BY created_at DESC`,
        params,
      );
      break;
    case 'bank_partnership': {
      const partnership = await buildBankPartnershipRows(pool, params);
      return { columns: partnership.columns, rows: partnership.rows };
    }
    case 'marketing_leads':
      await ensureOnboardingSchema();
      columns = [
        'full_name',
        'email',
        'phone',
        'loan_type',
        'source',
        'status',
        'eligibility_score',
        'agent_code',
        'assignee_name',
        'created_at',
      ];
      [rows] = await pool.execute(
        `SELECT ml.full_name,
                ml.email,
                ml.phone,
                ml.loan_type,
                ml.source,
                ml.status,
                ml.eligibility_score,
                COALESCE(ao.agent_code, eo.employee_code, '') AS agent_code,
                up.full_name AS assignee_name,
                ml.created_at
         FROM marketing_leads ml
         LEFT JOIN user_profiles up ON up.id = ml.assigned_to
         LEFT JOIN agent_onboarding ao ON ao.user_id = up.id AND up.role = 'agent'
         LEFT JOIN employee_onboarding eo ON eo.user_id = up.id AND up.role = 'employee'
         WHERE ml.created_at BETWEEN :start AND :end
         ORDER BY ml.created_at DESC`,
        params,
      );
      break;
    default: {
      const e = new Error(`Unknown report type: ${reportKey}`);
      e.status = 404;
      throw e;
    }
  }

  return { columns, rows: normalizeReportRows(rows, columns) };
}
