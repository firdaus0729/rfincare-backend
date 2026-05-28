import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from '../db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_ID = 'default';
let ensured = false;

export const SMS_PROVIDERS = ['console', 'twilio', 'msg91'];
export const EMAIL_PROVIDERS = ['console', 'smtp'];
export const WHATSAPP_PROVIDERS = ['console', 'twilio', 'msg91'];

const DEFAULTS = {
  smsProvider: 'console',
  whatsappProvider: 'console',
  emailProvider: 'console',
  requireMobileOtp: true,
  requireEmailOtp: true,
  requireWhatsappOtp: false,
  providerConfig: {
    msg91SenderId: '',
    msg91TemplateId: '',
    otpMessageTemplate: 'Your Rfincare verification code is {{otp}}. Valid for 10 minutes.',
  },
};

function parseConfig(value) {
  if (!value) return { ...DEFAULTS.providerConfig };
  if (typeof value === 'object') return { ...DEFAULTS.providerConfig, ...value };
  try {
    const parsed = JSON.parse(value);
    return { ...DEFAULTS.providerConfig, ...(parsed || {}) };
  } catch {
    return { ...DEFAULTS.providerConfig };
  }
}

export async function ensureOtpProviderSchema() {
  if (ensured) return;
  const sql = readFileSync(
    join(__dirname, '../../migrations/015_otp_provider_settings.sql'),
    'utf8',
  );
  const pool = getPool();
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      await pool.execute(statement);
    } catch (err) {
      if (err.code !== 'ER_TABLE_EXISTS_ERROR' && err.code !== 'ER_DUP_ENTRY') {
        throw err;
      }
    }
  }

  // Backward-compatible column upgrades for older databases.
  await pool.execute(
    `ALTER TABLE otp_provider_settings
     ADD COLUMN IF NOT EXISTS whatsapp_provider VARCHAR(32) NOT NULL DEFAULT 'console' AFTER sms_provider`,
  );
  await pool.execute(
    `ALTER TABLE otp_provider_settings
     ADD COLUMN IF NOT EXISTS require_whatsapp_otp TINYINT(1) NOT NULL DEFAULT 0 AFTER require_email_otp`,
  );

  ensured = true;
}

function formatRow(row) {
  if (!row) {
    return { ...DEFAULTS };
  }
  return {
    smsProvider: SMS_PROVIDERS.includes(row.sms_provider) ? row.sms_provider : 'console',
    whatsappProvider: WHATSAPP_PROVIDERS.includes(row.whatsapp_provider)
      ? row.whatsapp_provider
      : 'console',
    emailProvider: EMAIL_PROVIDERS.includes(row.email_provider) ? row.email_provider : 'console',
    requireMobileOtp: row.require_mobile_otp !== 0,
    requireEmailOtp: row.require_email_otp !== 0,
    requireWhatsappOtp: row.require_whatsapp_otp !== 0,
    providerConfig: parseConfig(row.provider_config_json),
    updatedAt: row.updated_at,
  };
}

export async function getOtpProviderSettings() {
  await ensureOtpProviderSchema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT * FROM otp_provider_settings WHERE id = :id LIMIT 1`,
    { id: SETTINGS_ID },
  );
  return formatRow(row);
}

export async function updateOtpProviderSettings(input, updatedBy) {
  await ensureOtpProviderSchema();
  const pool = getPool();

  const smsProvider = SMS_PROVIDERS.includes(input.smsProvider) ? input.smsProvider : 'console';
  const whatsappProvider = WHATSAPP_PROVIDERS.includes(input.whatsappProvider)
    ? input.whatsappProvider
    : 'console';
  const emailProvider = EMAIL_PROVIDERS.includes(input.emailProvider)
    ? input.emailProvider
    : 'console';

  await pool.execute(
    `INSERT INTO otp_provider_settings (
       id, sms_provider, whatsapp_provider, email_provider,
       require_mobile_otp, require_email_otp, require_whatsapp_otp,
       provider_config_json, updated_by
     ) VALUES (
       :id, :sms, :whatsapp, :email, :req_mobile, :req_email, :req_whatsapp, :config, :updated_by
     )
     ON DUPLICATE KEY UPDATE
       sms_provider = VALUES(sms_provider),
       whatsapp_provider = VALUES(whatsapp_provider),
       email_provider = VALUES(email_provider),
       require_mobile_otp = VALUES(require_mobile_otp),
       require_email_otp = VALUES(require_email_otp),
       require_whatsapp_otp = VALUES(require_whatsapp_otp),
       provider_config_json = VALUES(provider_config_json),
       updated_by = VALUES(updated_by)`,
    {
      id: SETTINGS_ID,
      sms: smsProvider,
      whatsapp: whatsappProvider,
      email: emailProvider,
      req_mobile: input.requireMobileOtp !== false ? 1 : 0,
      req_email: input.requireEmailOtp !== false ? 1 : 0,
      req_whatsapp: input.requireWhatsappOtp === true ? 1 : 0,
      config: JSON.stringify({
        ...DEFAULTS.providerConfig,
        ...(input.providerConfig || {}),
      }),
      updated_by: updatedBy ?? null,
    },
  );

  return getOtpProviderSettings();
}
