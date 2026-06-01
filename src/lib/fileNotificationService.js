import { getPool } from '../db/pool.js';
import { newId } from './ids.js';
import { sendEmail } from './email.js';
import { getOtpProviderSettings } from './otpProviderSettings.js';
import { createCustomerNotification } from '../routes/notifications.js';
import { ensureMilestone4Schema } from '../db/ensureMilestone4Schema.js';

const DEFAULT_SETTINGS = {
  channels: { sms: true, email: true, whatsapp: true },
  agentNotificationsEnabled: true,
  events: {
    customer_document_upload: { customer: false, employee: true, agent: 'optional' },
    employee_document_decision: { customer: true, employee: false, agent: 'optional' },
    application_stage_after_bank: { customer: true, employee: true, agent: 'if_sourced' },
  },
};

function parseSettings(row) {
  if (!row?.settings_json) return { ...DEFAULT_SETTINGS };
  const raw = typeof row.settings_json === 'string' ? JSON.parse(row.settings_json) : row.settings_json;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    channels: { ...DEFAULT_SETTINGS.channels, ...(raw.channels || {}) },
    events: { ...DEFAULT_SETTINGS.events, ...(raw.events || {}) },
  };
}

export async function getFileNotificationSettings() {
  await ensureMilestone4Schema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT settings_json FROM file_notification_settings WHERE id = 'default' LIMIT 1`,
  );
  return parseSettings(row);
}

export async function saveFileNotificationSettings(settings, updatedBy) {
  await ensureMilestone4Schema();
  const pool = getPool();
  await pool.execute(
    `INSERT INTO file_notification_settings (id, settings_json, updated_by, updated_at)
     VALUES ('default', :json, :by, NOW(3))
     ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
    { json: JSON.stringify(settings), by: updatedBy || null },
  );
  return getFileNotificationSettings();
}

async function createStaffNotification(pool, { userId, role, applicationId, eventType, title, message }) {
  await pool.execute(
    `INSERT INTO staff_notifications (id, user_id, role, application_id, event_type, title, message)
     VALUES (:id, :uid, :role, :app, :event, :title, :msg)`,
    {
      id: newId(),
      uid: userId,
      role,
      app: applicationId || null,
      event: eventType,
      title,
      msg: message,
    },
  );
}

async function deliverChannels({ phone, email, title, message, settings }) {
  const channels = [];
  const body = `${title}\n\n${message}`;
  const otpSettings = await getOtpProviderSettings();

  if (settings.channels?.email && email) {
    await sendEmail({ to: email, subject: title, text: body });
    channels.push('email');
  }
  if (settings.channels?.sms && phone) {
    const { sendOtpNotification } = await import('./otp.js');
    await sendOtpNotification({ phone, otp: message.slice(0, 160), channel: 'sms', settings: otpSettings });
    channels.push('sms');
  }
  if (settings.channels?.whatsapp && phone) {
    const { sendOtpNotification } = await import('./otp.js');
    await sendOtpNotification({
      phone,
      otp: message.slice(0, 160),
      channel: 'whatsapp',
      settings: otpSettings,
    });
    channels.push('whatsapp');
  }
  return channels;
}

function shouldNotify(rule, roleKey) {
  const val = rule?.[roleKey];
  if (val === true) return true;
  if (val === false) return false;
  return val === 'optional' || val === 'if_sourced';
}

async function loadApplicationContext(pool, applicationId) {
  const [[app]] = await pool.execute(
    `SELECT la.*, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            e.id AS assigned_employee_id, up_agent.email AS agent_email, up_agent.phone AS agent_phone,
            ao.agent_name
     FROM loan_applications la
     JOIN user_profiles c ON c.id = la.customer_id
     LEFT JOIN user_profiles e ON e.id = la.assigned_employee_id
     LEFT JOIN user_profiles up_agent ON up_agent.id = la.agent_id
     LEFT JOIN agent_onboarding ao ON ao.user_id = la.agent_id
     WHERE la.id = :id LIMIT 1`,
    { id: applicationId },
  );
  return app || null;
}

export async function dispatchFileUpdateNotification(eventKey, { applicationId, extra = {} }) {
  await ensureMilestone4Schema();
  const settings = await getFileNotificationSettings();
  const rule = settings.events?.[eventKey];
  if (!rule) return { skipped: true };

  const pool = getPool();
  const app = await loadApplicationContext(pool, applicationId);
  if (!app) return { skipped: true, reason: 'no_application' };

  const appNo = app.application_number || applicationId.slice(0, 8);
  const title = extra.title || 'Application update';
  const message =
    extra.message || `Update on application ${appNo} for ${app.customer_name || 'customer'}.`;

  const results = { inApp: [], channels: [] };

  if (shouldNotify(rule, 'customer')) {
    try {
      await createCustomerNotification(pool, {
        customerId: app.customer_id,
        title,
        message,
      });
      results.inApp.push('customer');
      const ch = await deliverChannels({
        phone: app.customer_phone,
        email: app.customer_email,
        title,
        message,
        settings,
      });
      results.channels.push(...ch);
    } catch {
      /* ignore */
    }
  }

  if (shouldNotify(rule, 'employee') && app.assigned_employee_id) {
    await createStaffNotification(pool, {
      userId: app.assigned_employee_id,
      role: 'employee',
      applicationId,
      eventType: eventKey,
      title,
      message,
    });
    results.inApp.push('employee');
    const [[emp]] = await pool.execute(
      `SELECT email, phone FROM user_profiles WHERE id = :id LIMIT 1`,
      { id: app.assigned_employee_id },
    );
    const ch = await deliverChannels({
      phone: emp?.phone,
      email: emp?.email,
      title,
      message,
      settings,
    });
    results.channels.push(...ch);
  } else if (shouldNotify(rule, 'employee')) {
    const [employees] = await pool.execute(
      `SELECT id, email, phone FROM user_profiles WHERE role = 'employee' AND is_active = 1 LIMIT 20`,
    );
    for (const emp of employees) {
      await createStaffNotification(pool, {
        userId: emp.id,
        role: 'employee',
        applicationId,
        eventType: eventKey,
        title,
        message,
      });
      await deliverChannels({
        phone: emp.phone,
        email: emp.email,
        title,
        message,
        settings,
      });
    }
    results.inApp.push('employees_broadcast');
  }

  const notifyAgent =
    settings.agentNotificationsEnabled
    && app.agent_id
    && (shouldNotify(rule, 'agent') || rule.agent === 'if_sourced');

  if (notifyAgent) {
    await createStaffNotification(pool, {
      userId: app.agent_id,
      role: 'agent',
      applicationId,
      eventType: eventKey,
      title,
      message,
    });
    results.inApp.push('agent');
    const ch = await deliverChannels({
      phone: app.agent_phone,
      email: app.agent_email,
      title,
      message,
      settings,
    });
    results.channels.push(...ch);
  }

  return results;
}
