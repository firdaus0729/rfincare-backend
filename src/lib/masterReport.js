import { generateReportSection } from './reportGenerators.js';

export const MASTER_REPORT_SECTIONS = [
  { key: 'application_volume', name: 'Application Volume Report' },
  { key: 'agent_performance', name: 'Agent Performance Dashboard Report' },
  { key: 'agent_payout_accounts', name: 'Agent Commission Payout Accounts' },
  { key: 'financial_summary', name: 'Financial Summary Report' },
  { key: 'bank_partnership', name: 'Bank Partnership Report' },
  { key: 'customer_analytics', name: 'Customer Analytics Report' },
  { key: 'marketing_leads', name: 'Marketing Leads Report' },
  { key: 'compliance_audit', name: 'Compliance Audit Report' },
];

/**
 * Build all platform report sections for the master export.
 */
export async function buildMasterReport(pool, params, { startDate, endDate } = {}) {
  const sections = [];

  for (const def of MASTER_REPORT_SECTIONS) {
    const { columns, rows } = await generateReportSection(pool, def.key, params);
    sections.push({
      key: def.key,
      name: def.name,
      columns,
      rows,
      rowCount: rows.length,
    });
  }

  const totalRows = sections.reduce((sum, s) => sum + s.rowCount, 0);

  return {
    reportKey: 'master',
    name: 'Rfincare Master Report',
    sections,
    summary: {
      sectionCount: sections.length,
      totalRows,
      periodStart: startDate || params.start,
      periodEnd: endDate || params.end,
    },
    generatedAt: new Date().toISOString(),
  };
}
