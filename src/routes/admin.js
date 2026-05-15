import { Router } from 'express';

import { getPool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

export const adminRouter = Router();

function mapAgentProfile(row) {
  return {
    id: row.id,
    email: row.email,
    agent_name: row.full_name,
    agent_code: row.agent_code,
    onboarding_status: row.onboarding_status || row.account_status || 'pending',
    created_at: row.created_at,
    agent: {
      total_clients: row.total_clients ?? 0,
      total_commission: row.total_commission ?? 0,
      success_rate: row.success_rate ?? 0,
    },
    user_profile: {
      role: row.role,
      is_active: Boolean(row.is_active),
    },
  };
}

function mapEmployeeProfile(row) {
  return {
    id: row.id,
    email: row.email,
    employee_name: row.full_name,
    employee_code: row.employee_code,
    created_at: row.created_at,
    user_profile: {
      role: row.role,
      is_active: Boolean(row.is_active),
    },
    access_controls: [],
  };
}

adminRouter.get(
  '/stats',
  authenticate,
  authorize({ resource: 'reports', action: 'read' }),
  async (req, res, next) => {
    try {
      const pool = getPool();

      const [[appStats]] = await pool.execute(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status IN ('submitted', 'pending', 'under_review') THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved
         FROM loan_applications`,
      );

      const [[agentStats]] = await pool.execute(
        `SELECT COUNT(*) AS active_agents
         FROM user_profiles
         WHERE role = 'agent' AND is_active = 1 AND account_status = 'active'`,
      );

      const total = Number(appStats?.total || 0);
      const approved = Number(appStats?.approved || 0);
      const approvalRate =
        total > 0 ? `${((approved / total) * 100).toFixed(1)}%` : '0%';

      res.json({
        total_applications: total,
        pending_reviews: Number(appStats?.pending || 0),
        active_agents: Number(agentStats?.active_agents || 0),
        approval_rate: approvalRate,
      });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/agents',
  authenticate,
  authorize({ resource: 'agents', action: 'read' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT up.*,
                CONCAT('AGT-', UPPER(LEFT(up.id, 8))) AS agent_code,
                (SELECT COUNT(*) FROM loan_applications la WHERE la.agent_id = up.id) AS total_clients,
                0 AS total_commission,
                0 AS success_rate
         FROM user_profiles up
         WHERE up.role = 'agent'
         ORDER BY up.created_at DESC`,
      );
      res.json(rows.map(mapAgentProfile));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get(
  '/employees',
  authenticate,
  authorize({ resource: 'employees', action: 'read' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT up.*,
                CONCAT('EMP-', UPPER(LEFT(up.id, 8))) AS employee_code
         FROM user_profiles up
         WHERE up.role = 'employee'
         ORDER BY up.created_at DESC`,
      );
      res.json(rows.map(mapEmployeeProfile));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.patch(
  '/agents/:id',
  authenticate,
  authorize({ resource: 'agents', action: 'update' }),
  async (req, res, next) => {
    try {
      const pool = getPool();
      const { account_status, onboarding_status } = req.body;

      await pool.execute(
        `UPDATE user_profiles
         SET account_status = COALESCE(:account_status, account_status),
             onboarding_status = COALESCE(:onboarding_status, onboarding_status),
             is_active = CASE WHEN :account_status = 'active' THEN 1 ELSE is_active END
         WHERE id = :id AND role = 'agent'`,
        {
          id: req.params.id,
          account_status: account_status || null,
          onboarding_status: onboarding_status || null,
        },
      );

      const [[row]] = await pool.execute(
        `SELECT * FROM user_profiles WHERE id = :id AND role = 'agent' LIMIT 1`,
        { id: req.params.id },
      );

      if (!row) {
        const e = new Error('Agent not found');
        e.status = 404;
        throw e;
      }

      res.json(mapAgentProfile({ ...row, agent_code: `AGT-${row.id.slice(0, 8).toUpperCase()}` }));
    } catch (err) {
      next(err);
    }
  },
);
