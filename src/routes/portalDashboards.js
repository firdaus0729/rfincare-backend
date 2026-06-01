import { Router } from 'express';

import { getPool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { ensureStaffExtrasSchema } from '../db/ensureStaffExtrasSchema.js';
import {
  calculateCommissionFromApplication,
  commissionStatusForApplication,
} from '../lib/agentCustomerProvision.js';
import { getAgentLearningFeed } from './agentLearning.js';
import { getEmployeeLearningFeed } from './employeeLearning.js';
import { ensureAgentLearningSchema } from '../db/ensureAgentLearningSchema.js';
import { ensureAgentProfileSchema } from '../db/ensureAgentProfileSchema.js';
import { ensureAgentCodeForUser } from '../lib/agentCode.js';
import {
  buildAgentPerformanceAnalytics,
  buildAgentMetricTrends,
} from '../lib/agentPerformanceAnalytics.js';

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
    await ensureAgentProfileSchema();

    const [[profile]] = await pool.execute(
      `SELECT up.*, ao.agent_code, ao.username
       FROM user_profiles up
       LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
       WHERE up.id = :id LIMIT 1`,
      { id: agentId },
    );

    const agentCode =
      (await ensureAgentCodeForUser(pool, agentId)) || profile?.agent_code || null;
    const [apps] = await pool.execute(
      `SELECT la.*, c.full_name AS customer_full_name
       FROM loan_applications la
       LEFT JOIN user_profiles c ON c.id = la.customer_id
       WHERE la.agent_id = :agentId
          OR (:agentCode IS NOT NULL AND la.sourced_agent_code = :agentCode)
       ORDER BY la.created_at DESC`,
      { agentId, agentCode },
    );

    const total = apps.length;
    const approved = apps.filter((a) => a.status === 'approved').length;
    const conversionRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    await ensureStaffExtrasSchema();
    const [[commissionConfig]] = await pool.execute(
      `SELECT * FROM global_commission_config WHERE id = 'default' LIMIT 1`,
    );

    const commissionEntries = apps.map((row) => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : row.data || {};
      const amount = calculateCommissionFromApplication(
        { data: { ...data, requested_loan_amount: data.requested_loan_amount || data.requestedLoanAmount } },
        commissionConfig,
      );
      return {
        id: row.id,
        clientName: row.customer_full_name || 'Customer',
        loanType: data.loan_type_label || data.loan_type || data.loan_purpose || 'Loan',
        amount,
        status: commissionStatusForApplication(row.status),
        applicationStatus: row.status,
        applicationNumber: row.application_number,
        sourcedAgentCode: row.sourced_agent_code,
        date: row.submitted_at || row.updated_at || row.created_at,
      };
    });

    const commissionEstimate = commissionEntries
      .filter((c) => c.status === 'paid')
      .reduce((sum, c) => sum + c.amount, 0);
    const pendingCommission = commissionEntries
      .filter((c) => c.status !== 'paid')
      .reduce((sum, c) => sum + c.amount, 0);
    const totalEstCommission = commissionEntries.reduce((sum, c) => sum + (c.amount || 0), 0);

    const trends = buildAgentMetricTrends(apps, commissionEntries);
    const performanceAnalytics = buildAgentPerformanceAnalytics(apps, commissionEntries);
    const [circulars] = await pool.execute(
      `SELECT id, title, description, file_name, file_url, created_at
       FROM agent_commission_circulars
       WHERE is_active = 1
       ORDER BY created_at DESC`,
    );

    const learningResources = await getAgentLearningFeed(pool, agentId);

    res.json({
      profile: {
        name: profile?.full_name || 'Agent',
        agentId: agentCode || '—',
        tier: profile?.is_active ? 'Active Agent' : 'Pending',
        totalClients: total,
        activeClients: apps.filter((a) => !['approved', 'rejected'].includes(a.status)).length,
        avatarUrl: profile?.avatar_url || null,
      },
      metrics: [
        {
          id: 1,
          type: 'customers',
          label: 'Active Clients',
          value: String(trends.activeClients),
          subtitle: `Total: ${total} clients`,
          trend: trends.clients.trend,
          change: trends.clients.change,
        },
        {
          id: 2,
          type: 'conversions',
          label: 'Conversion Rate',
          value: `${conversionRate}%`,
          subtitle: `${approved} of ${total} approved`,
          trend: trends.conversions.trend,
          change: trends.conversions.change,
        },
        {
          id: 3,
          type: 'earnings',
          label: 'Est. Commission',
          value: `₹${commissionEstimate.toLocaleString('en-IN')}`,
          subtitle:
            pendingCommission > 0
              ? `₹${pendingCommission.toLocaleString('en-IN')} pending · ₹${totalEstCommission.toLocaleString('en-IN')} pipeline`
              : 'Based on approvals',
          trend: trends.earnings.trend,
          change: trends.earnings.change,
        },
        {
          id: 4,
          type: 'satisfaction',
          label: 'Status',
          value: profile?.is_active ? 'Active' : 'Inactive',
          subtitle: profile?.account_status || '',
          trend: 'up',
          change: profile?.is_active ? 'Live' : 'Off',
        },
      ],
      clients: apps.map(mapAppToClient),
      commissions: commissionConfig ? [commissionConfig] : [],
      commissionEntries,
      commissionSummary: {
        totalEarned: commissionEstimate,
        pending: pendingCommission,
      },
      circulars,
      learningResources,
      performanceAnalytics,
      weeklyPerformance: performanceAnalytics.month,
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
    await ensureAgentLearningSchema();

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

    const learningResources = await getEmployeeLearningFeed(pool, employeeId);

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
      learningResources,
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
