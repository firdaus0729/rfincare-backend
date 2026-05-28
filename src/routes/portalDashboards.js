import { Router } from 'express';

import { getPool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { ensureStaffExtrasSchema } from '../db/ensureStaffExtrasSchema.js';

export const portalDashboardsRouter = Router();

function mapAppToClient(row) {
  const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : row.data || {};
  const statusMap = {
    draft: 'new',
    submitted: 'in-progress',
    pending: 'in-progress',
    under_review: 'in-progress',
    approved: 'submitted',
    rejected: 'submitted',
  };
  const rawStatus = row.status || 'draft';
  return {
    id: row.id,
    name: row.customer_full_name || 'Customer',
    loanType: data.loan_type_label || data.loan_type || 'Loan',
    amount: data.loan_amount ? `₹${Number(data.loan_amount).toLocaleString('en-IN')}` : '—',
    status: statusMap[rawStatus] || 'in-progress',
    priority: data.admin_priority || 'medium',
    daysActive: row.created_at
      ? `${Math.max(0, Math.floor((Date.now() - new Date(row.created_at)) / 86400000))} days ago`
      : '',
    nextAction: rawStatus === 'approved' ? 'Completed' : 'Follow up',
    applicationNumber: row.application_number,
    rawStatus,
  };
}

portalDashboardsRouter.get('/agent/dashboard', authenticate, async (req, res, next) => {
  try {
    if (req.auth.role !== 'agent' && !['admin', 'super_admin'].includes(req.auth.role)) {
      const e = new Error('Agent access only');
      e.status = 403;
      throw e;
    }

    const pool = getPool();
    const agentId = req.auth.userId;

    const [[profile]] = await pool.execute(
      `SELECT up.*, ao.agent_code, ao.username
       FROM user_profiles up
       LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
       WHERE up.id = :id LIMIT 1`,
      { id: agentId },
    );

    const [apps] = await pool.execute(
      `SELECT la.*, c.full_name AS customer_full_name
       FROM loan_applications la
       LEFT JOIN user_profiles c ON c.id = la.customer_id
       WHERE la.agent_id = :agentId
       ORDER BY la.created_at DESC`,
      { agentId },
    );

    const total = apps.length;
    const approved = apps.filter((a) => a.status === 'approved').length;
    const conversionRate = total > 0 ? Math.round((approved / total) * 100) : 0;
    const commissionEstimate = approved * 2500;

    await ensureStaffExtrasSchema();
    const [commissions] = await pool.execute(
      `SELECT * FROM global_commission_config WHERE id = 'default' LIMIT 1`,
    );
    const [circulars] = await pool.execute(
      `SELECT id, title, description, file_name, file_url, created_at
       FROM agent_commission_circulars
       WHERE is_active = 1
       ORDER BY created_at DESC`,
    );

    res.json({
      profile: {
        name: profile?.full_name || 'Agent',
        agentId: profile?.agent_code || profile?.id?.slice(0, 8),
        tier: profile?.is_active ? 'Active Agent' : 'Pending',
        totalClients: total,
        activeClients: apps.filter((a) => !['approved', 'rejected'].includes(a.status)).length,
      },
      metrics: [
        { id: 1, type: 'customers', label: 'Active Clients', value: String(apps.filter((a) => !['approved', 'rejected'].includes(a.status)).length), subtitle: `Total: ${total} clients` },
        { id: 2, type: 'conversions', label: 'Conversion Rate', value: `${conversionRate}%`, subtitle: `${approved} of ${total} approved` },
        { id: 3, type: 'earnings', label: 'Est. Commission', value: `₹${commissionEstimate.toLocaleString('en-IN')}`, subtitle: 'Based on approvals' },
        { id: 4, type: 'satisfaction', label: 'Status', value: profile?.is_active ? 'Active' : 'Inactive', subtitle: profile?.account_status || '' },
      ],
      clients: apps.map(mapAppToClient),
      commissions,
      circulars,
      weeklyPerformance: [
        { name: 'W1', clients: Math.ceil(total * 0.2), conversions: Math.ceil(approved * 0.2), earnings: Math.ceil(commissionEstimate * 0.2) },
        { name: 'W2', clients: Math.ceil(total * 0.25), conversions: Math.ceil(approved * 0.25), earnings: Math.ceil(commissionEstimate * 0.25) },
        { name: 'W3', clients: Math.ceil(total * 0.25), conversions: Math.ceil(approved * 0.25), earnings: Math.ceil(commissionEstimate * 0.25) },
        { name: 'W4', clients: Math.ceil(total * 0.3), conversions: Math.ceil(approved * 0.3), earnings: Math.ceil(commissionEstimate * 0.3) },
      ],
    });
  } catch (err) {
    next(err);
  }
});

portalDashboardsRouter.get('/employee/dashboard', authenticate, async (req, res, next) => {
  try {
    if (!['employee', 'admin', 'super_admin'].includes(req.auth.role)) {
      const e = new Error('Employee access only');
      e.status = 403;
      throw e;
    }

    const pool = getPool();
    const employeeId = req.auth.userId;

    const [apps] = await pool.execute(
      `SELECT la.*, c.full_name AS customer_full_name
       FROM loan_applications la
       LEFT JOIN user_profiles c ON c.id = la.customer_id
       WHERE la.assigned_employee_id = :id
       ORDER BY la.created_at DESC`,
      { id: employeeId },
    );

    const [[pendingDocs]] = await pool.execute(
      `SELECT COUNT(*) AS c FROM customer_documents cd
       INNER JOIN loan_applications la ON la.id = cd.application_id
       WHERE la.assigned_employee_id = :id
         AND COALESCE(cd.verification_status, cd.status, 'pending') IN ('pending','uploaded')`,
      { id: employeeId },
    );

    const [activities] = await pool.execute(
      `SELECT action_type, table_name, record_id, created_at
       FROM audit_logs WHERE user_id = :id ORDER BY created_at DESC LIMIT 20`,
      { id: employeeId },
    );

    res.json({
      stats: {
        assignedApplications: apps.length,
        pendingReview: apps.filter((a) => ['submitted', 'pending', 'under_review'].includes(a.status)).length,
        pendingDocuments: Number(pendingDocs?.c || 0),
        completedToday: apps.filter((a) => {
          if (!a.reviewed_at) return false;
          const d = new Date(a.reviewed_at);
          const today = new Date();
          return d.toDateString() === today.toDateString();
        }).length,
      },
      applications: apps.map((row) => ({
        ...mapAppToClient(row),
        id: row.id,
        customerName: row.customer_full_name,
        status: row.status,
        applicationNumber: row.application_number,
      })),
      activities: activities.map((a) => ({
        id: `${a.record_id}-${a.created_at}`,
        type: String(a.action_type).toLowerCase(),
        actionType: `${a.action_type} · ${a.table_name}`,
        timestamp: new Date(a.created_at).toLocaleString(),
        details: a.record_id,
      })),
    });
  } catch (err) {
    next(err);
  }
});
