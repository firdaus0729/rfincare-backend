import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { ensureStaffMessagingSchema } from '../db/ensureStaffMessagingSchema.js';
import { sendEmail } from '../lib/email.js';
import { writeAuditLog } from '../lib/audit.js';

export const staffCommunicationRouter = Router();
export const adminHierarchyRouter = Router();

const STAFF_ROLES = new Set(['admin', 'super_admin', 'employee', 'agent']);

function threadKeyForPair(userIdA, userIdB, applicationId = null) {
  const sorted = [userIdA, userIdB].sort().join(':');
  return applicationId ? `app:${applicationId}:${sorted}` : `pair:${sorted}`;
}

async function fetchHierarchyMapping(pool, agentUserId, employeeUserId = null) {
  const params = { agentUserId };
  let extra = '';
  if (employeeUserId) {
    extra = ' AND employee_user_id = :employeeUserId';
    params.employeeUserId = employeeUserId;
  }
  const [rows] = await pool.execute(
    `SELECT h.*,
            ag.full_name AS agent_name, ag.email AS agent_email,
            em.full_name AS employee_name, em.email AS employee_email
     FROM agent_employee_hierarchy h
     LEFT JOIN user_profiles ag ON ag.id = h.agent_user_id
     LEFT JOIN user_profiles em ON em.id = h.employee_user_id
     WHERE h.agent_user_id = :agentUserId${extra}
     ORDER BY h.is_primary DESC, h.hierarchy_level ASC, h.created_at ASC`,
    params,
  );
  return rows;
}

async function resolvePeerForUser(pool, userId, role, applicationId = null) {
  if (applicationId) {
    const [[app]] = await pool.execute(
      `SELECT agent_id, assigned_employee_id FROM loan_applications WHERE id = :id LIMIT 1`,
      { id: applicationId },
    );
    if (!app) return null;
    if (role === 'agent' && app.assigned_employee_id) {
      const mappings = await fetchHierarchyMapping(pool, userId, app.assigned_employee_id);
      const map = mappings[0];
      const [[emp]] = await pool.execute(
        `SELECT id, full_name, email FROM user_profiles WHERE id = :id LIMIT 1`,
        { id: app.assigned_employee_id },
      );
      return {
        peerId: emp?.id,
        peerName: emp?.full_name,
        peerEmail: emp?.email,
        communicationEmail: map?.communication_email || emp?.email,
        applicationId,
      };
    }
    if (role === 'employee' && app.agent_id) {
      const mappings = await fetchHierarchyMapping(pool, app.agent_id, userId);
      const map = mappings[0];
      const [[agent]] = await pool.execute(
        `SELECT id, full_name, email FROM user_profiles WHERE id = :id LIMIT 1`,
        { id: app.agent_id },
      );
      return {
        peerId: agent?.id,
        peerName: agent?.full_name,
        peerEmail: agent?.email,
        communicationEmail: map?.communication_email || agent?.email,
        applicationId,
      };
    }
  }

  if (role === 'agent') {
    const mappings = await fetchHierarchyMapping(pool, userId);
    const primary = mappings.find((m) => m.is_primary) || mappings[0];
    if (!primary) return null;
    return {
      peerId: primary.employee_user_id,
      peerName: primary.employee_name,
      peerEmail: primary.employee_email,
      communicationEmail: primary.communication_email || primary.employee_email,
      hierarchyLevel: primary.hierarchy_level,
      mappings,
    };
  }

  if (role === 'employee') {
    const [rows] = await pool.execute(
      `SELECT h.*, ag.full_name AS agent_name, ag.email AS agent_email
       FROM agent_employee_hierarchy h
       LEFT JOIN user_profiles ag ON ag.id = h.agent_user_id
       WHERE h.employee_user_id = :id
       ORDER BY h.is_primary DESC, h.hierarchy_level ASC`,
      { id: userId },
    );
    const primary = rows.find((m) => m.is_primary) || rows[0];
    if (!primary) return null;
    return {
      peerId: primary.agent_user_id,
      peerName: primary.agent_name,
      peerEmail: primary.agent_email,
      communicationEmail: primary.communication_email || primary.agent_email,
      hierarchyLevel: primary.hierarchy_level,
      mappings: rows,
    };
  }

  return null;
}

function formatMessageRow(row, attachments = []) {
  return {
    id: row.id,
    threadKey: row.thread_key,
    applicationId: row.application_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    subject: row.subject,
    body: row.body,
    channel: row.channel,
    emailTo: row.email_to,
    createdAt: row.created_at,
    readAt: row.read_at,
    attachments,
  };
}

// ——— Admin hierarchy CRUD ———

adminHierarchyRouter.get(
  '/',
  authenticate,
  authorize({ resource: 'agents', action: 'read' }),
  async (req, res, next) => {
    try {
      await ensureStaffMessagingSchema();
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT h.*,
                ag.full_name AS agent_name, ag.email AS agent_email, ao.agent_code,
                em.full_name AS employee_name, em.email AS employee_email, eo.employee_code
         FROM agent_employee_hierarchy h
         LEFT JOIN user_profiles ag ON ag.id = h.agent_user_id
         LEFT JOIN agent_onboarding ao ON ao.user_id = h.agent_user_id
         LEFT JOIN user_profiles em ON em.id = h.employee_user_id
         LEFT JOIN employee_onboarding eo ON eo.user_id = h.employee_user_id
         ORDER BY h.is_primary DESC, h.hierarchy_level ASC, ag.full_name ASC`,
      );
      res.json(
        rows.map((r) => ({
          id: r.id,
          agentUserId: r.agent_user_id,
          employeeUserId: r.employee_user_id,
          agentName: r.agent_name,
          agentEmail: r.agent_email,
          agentCode: r.agent_code,
          employeeName: r.employee_name,
          employeeEmail: r.employee_email,
          employeeCode: r.employee_code,
          communicationEmail: r.communication_email,
          hierarchyLevel: r.hierarchy_level,
          isPrimary: Boolean(r.is_primary),
          notes: r.notes,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

const HierarchySchema = z.object({
  agentUserId: z.string().min(1),
  employeeUserId: z.string().min(1),
  communicationEmail: z.string().email(),
  hierarchyLevel: z.number().int().min(1).max(10).optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional(),
});

adminHierarchyRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'agents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureStaffMessagingSchema();
      const input = HierarchySchema.parse(req.body);
      const pool = getPool();
      const id = newId();

      if (input.isPrimary) {
        await pool.execute(
          `UPDATE agent_employee_hierarchy SET is_primary = 0 WHERE agent_user_id = :agentId`,
          { agentId: input.agentUserId },
        );
      }

      await pool.execute(
        `INSERT INTO agent_employee_hierarchy
         (id, agent_user_id, employee_user_id, communication_email, hierarchy_level, is_primary, notes, created_by)
         VALUES
         (:id, :agent_user_id, :employee_user_id, :communication_email, :hierarchy_level, :is_primary, :notes, :created_by)`,
        {
          id,
          agent_user_id: input.agentUserId,
          employee_user_id: input.employeeUserId,
          communication_email: input.communicationEmail,
          hierarchy_level: input.hierarchyLevel ?? 1,
          is_primary: input.isPrimary ? 1 : 0,
          notes: input.notes || null,
          created_by: req.auth.userId,
        },
      );

      await writeAuditLog({
        userId: req.auth.userId,
        actionType: 'create',
        tableName: 'agent_employee_hierarchy',
        recordId: id,
        newValues: input,
      });

      res.status(201).json({ id });
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'This agent is already mapped to that employee' });
      }
      next(err);
    }
  },
);

adminHierarchyRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'agents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureStaffMessagingSchema();
      const input = HierarchySchema.partial().parse(req.body);
      const pool = getPool();

      const [[existing]] = await pool.execute(
        `SELECT * FROM agent_employee_hierarchy WHERE id = :id LIMIT 1`,
        { id: req.params.id },
      );
      if (!existing) return res.status(404).json({ error: 'Mapping not found' });

      if (input.isPrimary) {
        await pool.execute(
          `UPDATE agent_employee_hierarchy SET is_primary = 0 WHERE agent_user_id = :agentId`,
          { agentId: existing.agent_user_id },
        );
      }

      await pool.execute(
        `UPDATE agent_employee_hierarchy SET
          communication_email = COALESCE(:communication_email, communication_email),
          hierarchy_level = COALESCE(:hierarchy_level, hierarchy_level),
          is_primary = COALESCE(:is_primary, is_primary),
          notes = COALESCE(:notes, notes)
         WHERE id = :id`,
        {
          id: req.params.id,
          communication_email: input.communicationEmail || null,
          hierarchy_level: input.hierarchyLevel ?? null,
          is_primary: input.isPrimary == null ? null : input.isPrimary ? 1 : 0,
          notes: input.notes ?? null,
        },
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

adminHierarchyRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'agents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureStaffMessagingSchema();
      const pool = getPool();
      const [result] = await pool.execute(
        `DELETE FROM agent_employee_hierarchy WHERE id = :id`,
        { id: req.params.id },
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Mapping not found' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ——— Portal communication (agent + employee) ———

staffCommunicationRouter.use(authenticate);

staffCommunicationRouter.get('/context', async (req, res, next) => {
  try {
    if (!STAFF_ROLES.has(req.auth.role)) {
      const e = new Error('Staff access only');
      e.status = 403;
      throw e;
    }
    await ensureStaffMessagingSchema();
    const pool = getPool();
    const applicationId = req.query.applicationId || null;
    const peer = await resolvePeerForUser(pool, req.auth.userId, req.auth.role, applicationId);

    let applications = [];
    if (req.auth.role === 'agent') {
      const [apps] = await pool.execute(
        `SELECT la.id, la.application_number, c.full_name AS customer_name
         FROM loan_applications la
         LEFT JOIN user_profiles c ON c.id = la.customer_id
         WHERE la.agent_id = :id
         ORDER BY la.updated_at DESC LIMIT 50`,
        { id: req.auth.userId },
      );
      applications = apps.map((a) => ({
        id: a.id,
        applicationNumber: a.application_number,
        customerName: a.customer_name,
      }));
    } else if (req.auth.role === 'employee') {
      const [apps] = await pool.execute(
        `SELECT la.id, la.application_number, c.full_name AS customer_name
         FROM loan_applications la
         LEFT JOIN user_profiles c ON c.id = la.customer_id
         WHERE la.assigned_employee_id = :id
         ORDER BY la.updated_at DESC LIMIT 50`,
        { id: req.auth.userId },
      );
      applications = apps.map((a) => ({
        id: a.id,
        applicationNumber: a.application_number,
        customerName: a.customer_name,
      }));
    }

    const hierarchyRows =
      req.auth.role === 'agent'
        ? await fetchHierarchyMapping(pool, req.auth.userId)
        : [];

    res.json({
      role: req.auth.role,
      peer: peer
        ? {
            id: peer.peerId,
            name: peer.peerName,
            email: peer.peerEmail,
            communicationEmail: peer.communicationEmail,
            hierarchyLevel: peer.hierarchyLevel,
          }
        : null,
      hierarchy: hierarchyRows.map((r) => ({
        employeeUserId: r.employee_user_id,
        employeeName: r.employee_name,
        communicationEmail: r.communication_email,
        hierarchyLevel: r.hierarchy_level,
        isPrimary: Boolean(r.is_primary),
      })),
      applications,
      canCommunicate: Boolean(peer?.peerId),
    });
  } catch (err) {
    next(err);
  }
});

staffCommunicationRouter.get('/messages', async (req, res, next) => {
  try {
    if (!STAFF_ROLES.has(req.auth.role)) {
      const e = new Error('Staff access only');
      e.status = 403;
      throw e;
    }
    await ensureStaffMessagingSchema();
    const pool = getPool();
    const peerId = req.query.peerId;
    const applicationId = req.query.applicationId || null;

    if (!peerId) {
      return res.status(400).json({ error: 'peerId is required' });
    }

    const threadKey = threadKeyForPair(req.auth.userId, peerId, applicationId);
    const [rows] = await pool.execute(
      `SELECT * FROM staff_messages
       WHERE thread_key = :threadKey
       ORDER BY created_at ASC
       LIMIT 200`,
      { threadKey },
    );

    const messageIds = rows.map((r) => r.id);
    let attachmentsByMessage = {};
    if (messageIds.length) {
      const placeholders = messageIds.map((_, i) => `:id${i}`).join(',');
      const attParams = Object.fromEntries(messageIds.map((id, i) => [`id${i}`, id]));
      const [atts] = await pool.execute(
        `SELECT * FROM staff_message_attachments WHERE message_id IN (${placeholders})`,
        attParams,
      );
      attachmentsByMessage = atts.reduce((acc, att) => {
        if (!acc[att.message_id]) acc[att.message_id] = [];
        acc[att.message_id].push({
          id: att.id,
          documentId: att.document_id,
          fileName: att.file_name,
          fileUrl: att.file_url,
          documentType: att.document_type,
          mimeType: att.mime_type,
        });
        return acc;
      }, {});
    }

    await pool.execute(
      `UPDATE staff_messages SET read_at = NOW(3)
       WHERE thread_key = :threadKey AND recipient_id = :userId AND read_at IS NULL`,
      { threadKey, userId: req.auth.userId },
    );

    res.json(rows.map((r) => formatMessageRow(r, attachmentsByMessage[r.id] || [])));
  } catch (err) {
    next(err);
  }
});

const SendMessageSchema = z.object({
  peerId: z.string().min(1),
  applicationId: z.string().optional(),
  subject: z.string().max(255).optional(),
  body: z.string().min(1),
  channel: z.enum(['internal', 'email']).optional(),
  documentIds: z.array(z.string()).optional(),
});

staffCommunicationRouter.post('/messages', async (req, res, next) => {
  try {
    if (!STAFF_ROLES.has(req.auth.role)) {
      const e = new Error('Staff access only');
      e.status = 403;
      throw e;
    }
    await ensureStaffMessagingSchema();
    const input = SendMessageSchema.parse(req.body);
    const pool = getPool();

    const peer = await resolvePeerForUser(
      pool,
      req.auth.userId,
      req.auth.role,
      input.applicationId || null,
    );
    if (!peer?.peerId || peer.peerId !== input.peerId) {
      const [[target]] = await pool.execute(
        `SELECT id, role, email FROM user_profiles WHERE id = :id LIMIT 1`,
        { id: input.peerId },
      );
      if (!target) return res.status(404).json({ error: 'Recipient not found' });

      if (!['admin', 'super_admin'].includes(req.auth.role)) {
        let mapped = false;
        if (req.auth.role === 'agent' && target.role === 'employee') {
          const [[row]] = await pool.execute(
            `SELECT id FROM agent_employee_hierarchy
             WHERE agent_user_id = :agentId AND employee_user_id = :employeeId LIMIT 1`,
            { agentId: req.auth.userId, employeeId: input.peerId },
          );
          mapped = Boolean(row);
        } else if (req.auth.role === 'employee' && target.role === 'agent') {
          const [[row]] = await pool.execute(
            `SELECT id FROM agent_employee_hierarchy
             WHERE employee_user_id = :employeeId AND agent_user_id = :agentId LIMIT 1`,
            { employeeId: req.auth.userId, agentId: input.peerId },
          );
          mapped = Boolean(row);
        }
        if (!mapped) {
          return res.status(403).json({ error: 'You can only message your mapped hierarchy contact' });
        }
      }
    }

    const communicationEmail =
      peer?.communicationEmail
      || (await pool.execute(`SELECT email FROM user_profiles WHERE id = :id`, { id: input.peerId }))[0][0]
        ?.email;

    const channel = input.channel || 'internal';
    const messageId = newId();
    const threadKey = threadKeyForPair(req.auth.userId, input.peerId, input.applicationId || null);

    await pool.execute(
      `INSERT INTO staff_messages
       (id, thread_key, application_id, sender_id, recipient_id, subject, body, channel, email_to)
       VALUES
       (:id, :thread_key, :application_id, :sender_id, :recipient_id, :subject, :body, :channel, :email_to)`,
      {
        id: messageId,
        thread_key: threadKey,
        application_id: input.applicationId || null,
        sender_id: req.auth.userId,
        recipient_id: input.peerId,
        subject: input.subject || null,
        body: input.body,
        channel,
        email_to: channel === 'email' ? communicationEmail : null,
      },
    );

    const documentIds = input.documentIds || [];
    const attachments = [];
    for (const docId of documentIds) {
      const [[doc]] = await pool.execute(
        `SELECT cd.*, la.agent_id, la.assigned_employee_id
         FROM customer_documents cd
         LEFT JOIN loan_applications la ON la.id = cd.application_id
         WHERE cd.id = :id LIMIT 1`,
        { id: docId },
      );
      if (!doc) continue;
      const canAttach =
        req.auth.role === 'admin'
        || req.auth.role === 'super_admin'
        || (req.auth.role === 'agent' && doc.agent_id === req.auth.userId)
        || (req.auth.role === 'employee' && doc.assigned_employee_id === req.auth.userId);
      if (!canAttach) continue;

      const attId = newId();
      const fileUrl = doc.document_url || `/documents/${doc.id}/download`;
      await pool.execute(
        `INSERT INTO staff_message_attachments
         (id, message_id, document_id, file_name, file_url, document_type, mime_type)
         VALUES (:id, :message_id, :document_id, :file_name, :file_url, :document_type, :mime_type)`,
        {
          id: attId,
          message_id: messageId,
          document_id: doc.id,
          file_name: doc.document_name,
          file_url: fileUrl,
          document_type: doc.document_type,
          mime_type: doc.mime_type,
        },
      );
      attachments.push({
        id: attId,
        documentId: doc.id,
        fileName: doc.document_name,
        fileUrl,
        documentType: doc.document_type,
        mimeType: doc.mime_type,
      });
    }

    if (channel === 'email' && communicationEmail) {
      const appUrl = process.env.APP_PUBLIC_URL || 'http://127.0.0.1:4028';
      const attachLines = attachments.length
        ? attachments.map((a) => `- ${a.fileName}: ${appUrl}${a.fileUrl}`).join('\n')
        : '';
      await sendEmail({
        to: communicationEmail,
        subject: input.subject || 'Rfincare — message from your assigned contact',
        text: [
          input.body,
          '',
          attachLines ? 'Attached documents:\n' + attachLines : '',
          '',
          '— Rfincare Staff Communication',
        ].join('\n'),
      });
    }

    const [[row]] = await pool.execute(`SELECT * FROM staff_messages WHERE id = :id`, { id: messageId });
    res.status(201).json(formatMessageRow(row, attachments));
  } catch (err) {
    next(err);
  }
});

staffCommunicationRouter.get('/documents', async (req, res, next) => {
  try {
    if (!STAFF_ROLES.has(req.auth.role)) {
      const e = new Error('Staff access only');
      e.status = 403;
      throw e;
    }
    const applicationId = req.query.applicationId;
    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId is required' });
    }

    const pool = getPool();
    const [[app]] = await pool.execute(
      `SELECT agent_id, assigned_employee_id, customer_id FROM loan_applications WHERE id = :id LIMIT 1`,
      { id: applicationId },
    );
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const allowed =
      ['admin', 'super_admin'].includes(req.auth.role)
      || (req.auth.role === 'agent' && app.agent_id === req.auth.userId)
      || (req.auth.role === 'employee' && app.assigned_employee_id === req.auth.userId);
    if (!allowed) {
      return res.status(403).json({ error: 'Insufficient permissions for this application' });
    }

    const [rows] = await pool.execute(
      `SELECT id, document_type, document_name, mime_type, document_url, verification_status, status, uploaded_at
       FROM customer_documents
       WHERE application_id = :applicationId
       ORDER BY uploaded_at DESC`,
      { applicationId },
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        documentType: r.document_type,
        documentName: r.document_name,
        mimeType: r.mime_type,
        fileUrl: r.document_url || `/documents/${r.id}/download`,
        verificationStatus: r.verification_status || r.status,
        uploadedAt: r.uploaded_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});
