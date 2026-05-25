import { Router } from 'express';

import { getPool } from '../db/pool.js';
import { ensureOnboardingSchema } from '../db/ensureOnboardingSchema.js';
import { createAgentAccount, createEmployeeAccount } from '../lib/staffOnboarding.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { approvalMatrixRouter } from './approvalMatrixRules.js';
import { statusCheckAdminRouter } from './statusCheckAdmin.js';

export const adminRouter = Router();

adminRouter.use('/status-check', statusCheckAdminRouter);

/** Alias: /admin/approval-matrix-rules (same handlers as /approval-matrix-rules) */
adminRouter.use('/approval-matrix-rules', approvalMatrixRouter);

function mapAgentProfile(row) {
  const agentCode =
    row.agent_code ||
    (row.id ? `AGT-${String(row.id).slice(0, 8).toUpperCase()}` : 'N/A');
  return {
    id: row.id,
    email: row.email,
    agent_name: row.full_name,
    agent_code: agentCode,
    username: row.username || null,
    onboarding_status: row.ao_status || row.onboarding_status || row.account_status || 'pending',
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
  const employeeCode =
    row.employee_code ||
    (row.id ? `EMP-${String(row.id).slice(0, 8).toUpperCase()}` : 'N/A');
  return {
    id: row.id,
    email: row.email,
    employee_name: row.full_name,
    employee_code: employeeCode,
    username: row.username || null,
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

/** Combined employees + agents for lead assignment dropdowns */
adminRouter.get(
  '/assignees',
  authenticate,
  authorize({ resource: 'agents', action: 'read' }),
  async (req, res, next) => {
    try {
      await ensureOnboardingSchema();
      const pool = getPool();

      const [employees] = await pool.execute(
        `SELECT up.id, up.full_name, up.email, up.account_status, up.onboarding_status,
                eo.employee_code, eo.username
         FROM user_profiles up
         LEFT JOIN employee_onboarding eo ON eo.user_id = up.id
         WHERE up.role = 'employee'
         ORDER BY up.full_name ASC, up.email ASC`,
      );

      const [agents] = await pool.execute(
        `SELECT up.id, up.full_name, up.email, up.account_status, up.onboarding_status,
                ao.agent_code, ao.username
         FROM user_profiles up
         LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
         WHERE up.role = 'agent'
         ORDER BY up.full_name ASC, up.email ASC`,
      );

      const mapStaff = (row, role) => {
        const code =
          role === 'agent'
            ? row.agent_code || `AGT-${String(row.id).slice(0, 8).toUpperCase()}`
            : row.employee_code || `EMP-${String(row.id).slice(0, 8).toUpperCase()}`;
        const name = row.full_name || row.email || 'Staff';
        return {
          id: row.id,
          role,
          name,
          code,
          email: row.email,
          username: row.username || null,
          status: row.onboarding_status || row.account_status || 'pending',
          label: `${code} — ${name}`,
        };
      };

      res.json({
        employees: employees.map((r) => mapStaff(r, 'employee')),
        agents: agents.map((r) => mapStaff(r, 'agent')),
        all: [
          ...employees.map((r) => mapStaff(r, 'employee')),
          ...agents.map((r) => mapStaff(r, 'agent')),
        ],
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
      await ensureOnboardingSchema();
      const [rows] = await pool.execute(
        `SELECT up.*,
                ao.agent_code,
                ao.username,
                ao.onboarding_status AS ao_status,
                (SELECT COUNT(*) FROM loan_applications la WHERE la.agent_id = up.id) AS total_clients,
                0 AS total_commission,
                0 AS success_rate
         FROM user_profiles up
         LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
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
      await ensureOnboardingSchema();
      const [rows] = await pool.execute(
        `SELECT up.*,
                eo.employee_code,
                eo.username,
                eo.onboarding_status AS eo_status
         FROM user_profiles up
         LEFT JOIN employee_onboarding eo ON eo.user_id = up.id
         WHERE up.role = 'employee'
         ORDER BY up.created_at DESC`,
      );
      res.json(rows.map(mapEmployeeProfile));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/agents',
  authenticate,
  authorize({ resource: 'agents', action: 'manage' }),
  async (req, res, next) => {
    try {
      const row = await createAgentAccount(req.body, req.auth.userId);
      res.status(201).json(mapAgentProfile(row));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  '/employees',
  authenticate,
  authorize({ resource: 'employees', action: 'manage' }),
  async (req, res, next) => {
    try {
      const row = await createEmployeeAccount(req.body, req.auth.userId);
      res.status(201).json(mapEmployeeProfile(row));
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
      await ensureOnboardingSchema();
      const pool = getPool();
      const { account_status, onboarding_status } = req.body;
      const status = onboarding_status || account_status;

      await pool.execute(
        `UPDATE user_profiles
         SET account_status = COALESCE(:account_status, account_status),
             onboarding_status = COALESCE(:onboarding_status, onboarding_status),
             is_active = CASE WHEN :account_status = 'active' THEN 1 WHEN :account_status IN ('inactive','suspended') THEN 0 ELSE is_active END
         WHERE id = :id AND role = 'agent'`,
        {
          id: req.params.id,
          account_status: account_status || null,
          onboarding_status: onboarding_status || null,
        },
      );

      if (status) {
        await pool.execute(
          `UPDATE agent_onboarding SET onboarding_status = :status WHERE user_id = :id`,
          { id: req.params.id, status },
        );
      }

      const [[row]] = await pool.execute(
        `SELECT up.*, ao.agent_code, ao.username, ao.onboarding_status AS ao_status
         FROM user_profiles up
         LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
         WHERE up.id = :id AND up.role = 'agent' LIMIT 1`,
        { id: req.params.id },
      );

      if (!row) {
        const e = new Error('Agent not found');
        e.status = 404;
        throw e;
      }

      res.json(mapAgentProfile(row));
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.patch(
  '/employees/:id',
  authenticate,
  authorize({ resource: 'employees', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureOnboardingSchema();
      const pool = getPool();
      const { account_status, onboarding_status } = req.body;
      const status = onboarding_status || account_status;

      await pool.execute(
        `UPDATE user_profiles
         SET account_status = COALESCE(:account_status, account_status),
             onboarding_status = COALESCE(:onboarding_status, onboarding_status),
             is_active = CASE WHEN :account_status = 'active' THEN 1 WHEN :account_status IN ('inactive','suspended') THEN 0 ELSE is_active END
         WHERE id = :id AND role = 'employee'`,
        {
          id: req.params.id,
          account_status: account_status || null,
          onboarding_status: onboarding_status || null,
        },
      );

      if (status) {
        await pool.execute(
          `UPDATE employee_onboarding SET onboarding_status = :status WHERE user_id = :id`,
          { id: req.params.id, status },
        );
      }

      const [[row]] = await pool.execute(
        `SELECT up.*, eo.employee_code, eo.username, eo.onboarding_status AS eo_status
         FROM user_profiles up
         LEFT JOIN employee_onboarding eo ON eo.user_id = up.id
         WHERE up.id = :id AND up.role = 'employee' LIMIT 1`,
        { id: req.params.id },
      );

      if (!row) {
        const e = new Error('Employee not found');
        e.status = 404;
        throw e;
      }

      res.json(mapEmployeeProfile(row));
    } catch (err) {
      next(err);
    }
  },
);
