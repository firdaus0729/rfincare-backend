import { getPool } from './pool.js';

let ensured = false;

export async function ensureStaffMessagingSchema() {
  if (ensured) return;
  const pool = getPool();

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS agent_employee_hierarchy (
      id CHAR(36) NOT NULL,
      agent_user_id CHAR(36) NOT NULL,
      employee_user_id CHAR(36) NOT NULL,
      communication_email VARCHAR(255) NOT NULL,
      hierarchy_level INT NOT NULL DEFAULT 1,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_agent_employee (agent_user_id, employee_user_id),
      KEY idx_hierarchy_agent (agent_user_id),
      KEY idx_hierarchy_employee (employee_user_id)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS staff_messages (
      id CHAR(36) NOT NULL,
      thread_key VARCHAR(128) NOT NULL,
      application_id CHAR(36) NULL,
      sender_id CHAR(36) NOT NULL,
      recipient_id CHAR(36) NOT NULL,
      subject VARCHAR(255) NULL,
      body TEXT NOT NULL,
      channel VARCHAR(16) NOT NULL DEFAULT 'internal',
      email_to VARCHAR(255) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      read_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      KEY idx_staff_msg_thread (thread_key),
      KEY idx_staff_msg_recipient (recipient_id),
      KEY idx_staff_msg_application (application_id)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS staff_message_attachments (
      id CHAR(36) NOT NULL,
      message_id CHAR(36) NOT NULL,
      document_id CHAR(36) NULL,
      file_name VARCHAR(255) NULL,
      file_url TEXT NULL,
      document_type VARCHAR(64) NULL,
      mime_type VARCHAR(128) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_staff_msg_att_message (message_id)
    )
  `);

  ensured = true;
}
