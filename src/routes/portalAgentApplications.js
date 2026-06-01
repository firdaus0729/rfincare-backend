import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { authenticate } from '../middleware/authenticate.js';
import { ensureStaffExtrasSchema } from '../db/ensureStaffExtrasSchema.js';
import { ensureStaffMessagingSchema } from '../db/ensureStaffMessagingSchema.js';
import { newId } from '../lib/ids.js';
import {
  provisionCustomerForAgent,
  calculateCommissionFromApplication,
  commissionStatusForApplication,
} from '../lib/agentCustomerProvision.js';
import { writeAuditLog } from '../lib/audit.js';
import { ensureAgentCodeForUser } from '../lib/agentCode.js';

export const portalAgentApplicationsRouter = Router();

function requireAgent(req) {
  if (req.auth.role !== 'agent' && !['admin', 'super_admin'].includes(req.auth.role)) {
    const e = new Error('Agent access only');
    e.status = 403;
    throw e;
  }
}

async function resolveAgentMeta(pool, userId) {
  const [[row]] = await pool.execute(
    `SELECT up.full_name, up.email, ao.agent_code, ao.username
     FROM user_profiles up
     LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
     WHERE up.id = :id LIMIT 1`,
    { id: userId },
  );
  const agentCode =
    (await ensureAgentCodeForUser(pool, userId)) ||
    row?.agent_code ||
    null;
  return {
    agentId: userId,
    agentCode,
    agentName: row?.full_name || 'Agent',
    email: row?.email,
    username: row?.username,
  };
}

async function assertAgentOwnsApplication(pool, agentId, applicationId) {
  const [[row]] = await pool.execute(
    `SELECT * FROM loan_applications
     WHERE id = :id AND agent_id = :agentId LIMIT 1`,
    { id: applicationId, agentId },
  );
  if (!row) {
    const e = new Error('Application not found or not linked to your agent code');
    e.status = 404;
    throw e;
  }
  return row;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

portalAgentApplicationsRouter.use(authenticate);

portalAgentApplicationsRouter.get('/profile', async (req, res, next) => {
  try {
    requireAgent(req);
    const pool = getPool();
    const meta = await resolveAgentMeta(pool, req.auth.userId);
    res.json(meta);
  } catch (err) {
    next(err);
  }
});

const ProvisionSchema = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
  fullName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  password: z.string().min(8).optional(),
});

portalAgentApplicationsRouter.post('/provision-customer', async (req, res, next) => {
  try {
    requireAgent(req);
    const input = ProvisionSchema.parse(req.body);
    const pool = getPool();
    const result = await provisionCustomerForAgent(pool, input);

    await writeAuditLog({
      userId: req.auth.userId,
      actionType: 'agent_provision_customer',
      tableName: 'user_profiles',
      recordId: result.customerId,
      newValues: { email: input.email, created: result.created },
    });

    res.status(result.created ? 201 : 200).json({
      customerId: result.customerId,
      created: result.created,
      temporaryPassword: result.temporaryPassword || null,
    });
  } catch (err) {
    next(err);
  }
});

portalAgentApplicationsRouter.post('/applications', async (req, res, next) => {
  try {
    requireAgent(req);
    const pool = getPool();
    await ensureStaffMessagingSchema();
    const agentId = req.auth.userId;
    const meta = await resolveAgentMeta(pool, agentId);
    const body = req.body || {};
    const customerId = body.customer_id || body.customerId;
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    const [[primaryMap]] = await pool.execute(
      `SELECT employee_user_id FROM agent_employee_hierarchy
       WHERE agent_user_id = :agentId AND is_primary = 1
       ORDER BY hierarchy_level ASC LIMIT 1`,
      { agentId },
    );

    const id = newId();
    const payload = {
      ...body,
      customer_id: customerId,
      agent_id: agentId,
      sourced_agent_code: meta.agentCode,
      sourced_by_agent_name: meta.agentName,
      submission_channel: 'agent_assisted',
    };

    await pool.execute(
      `INSERT INTO loan_applications (
        id, application_number, customer_id, agent_id, sourced_agent_code, assigned_employee_id,
        selected_bank_id, status, document_stage_status, bank_approval_status, eligibility_status, data
      ) VALUES (
        :id, :application_number, :customer_id, :agent_id, :sourced_agent_code, :assigned_employee_id,
        :selected_bank_id, :status, :document_stage_status, :bank_approval_status, :eligibility_status, :data
      )`,
      {
        id,
        application_number: body.application_number || `RFC${Date.now()}`,
        customer_id: customerId,
        agent_id: agentId,
        sourced_agent_code: meta.agentCode,
        assigned_employee_id:
          body.assigned_employee_id
          || body.assignedEmployeeId
          || primaryMap?.employee_user_id
          || null,
        selected_bank_id: body.selected_bank_id || body.selectedBankId || null,
        status: body.status || 'draft',
        document_stage_status: 'documents_pending',
        bank_approval_status: 'submitted_to_bank',
        eligibility_status: body.eligibility_status || null,
        data: JSON.stringify(payload),
      },
    );

    const [[row]] = await pool.execute(
      `SELECT la.*, c.full_name AS customer_full_name
       FROM loan_applications la
       LEFT JOIN user_profiles c ON c.id = la.customer_id
       WHERE la.id = :id LIMIT 1`,
      { id },
    );

    res.status(201).json({
      id: row.id,
      applicationNumber: row.application_number,
      customerId: row.customer_id,
      agentId: row.agent_id,
      sourcedAgentCode: row.sourced_agent_code,
      status: row.status,
      customerName: row.customer_full_name,
    });
  } catch (err) {
    next(err);
  }
});

portalAgentApplicationsRouter.patch('/applications/:id', async (req, res, next) => {
  try {
    requireAgent(req);
    const pool = getPool();
    const agentId = req.auth.userId;
    const existing = await assertAgentOwnsApplication(pool, agentId, req.params.id);
    const body = req.body || {};
    const mergedData = { ...parseJson(existing.data), ...body };
    const {
      status,
      selected_bank_id: selectedBankId,
      selectedBankId: selectedBankIdCamel,
      ...rest
    } = body;

    await pool.execute(
      `UPDATE loan_applications SET
        status = COALESCE(:status, status),
        selected_bank_id = COALESCE(:selected_bank_id, selected_bank_id),
        data = :data,
        updated_at = NOW(3)
       WHERE id = :id`,
      {
        id: req.params.id,
        status: status || null,
        selected_bank_id: selectedBankId || selectedBankIdCamel || null,
        data: JSON.stringify({ ...mergedData, ...rest }),
      },
    );

    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    next(err);
  }
});

portalAgentApplicationsRouter.post('/applications/:id/submit', async (req, res, next) => {
  try {
    requireAgent(req);
    const pool = getPool();
    const agentId = req.auth.userId;
    await assertAgentOwnsApplication(pool, agentId, req.params.id);

    await pool.execute(
      `UPDATE loan_applications
       SET status = 'submitted',
           document_stage_status = COALESCE(document_stage_status, 'documents_pending'),
           bank_approval_status = 'submitted_to_bank',
           submitted_at = NOW(3)
       WHERE id = :id`,
      { id: req.params.id },
    );

    await pool.execute(
      `INSERT INTO application_timeline (id, application_id, status, message)
       VALUES (:id, :application_id, 'submitted', :message)`,
      {
        id: newId(),
        application_id: req.params.id,
        message: 'Application submitted by agent on behalf of customer',
      },
    );

    res.json({ ok: true, id: req.params.id, status: 'submitted' });
  } catch (err) {
    next(err);
  }
});
