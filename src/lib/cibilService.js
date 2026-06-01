import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getPool } from '../db/pool.js';
import { newId } from './ids.js';
import { buildSimpleTextPdf } from './simplePdf.js';
import { getUploadDir } from './uploadPaths.js';
import { ensureMilestone4Schema } from '../db/ensureMilestone4Schema.js';

const VENDOR_KEYS = ['transunion_cibil', 'experian', 'equifax', 'crif_high_mark'];

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function listCibilVendors() {
  await ensureMilestone4Schema();
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT vendor_key, display_name, sandbox_mode, is_active,
            CASE WHEN api_key IS NOT NULL AND api_key != '' THEN 1 ELSE 0 END AS has_key,
            updated_at
     FROM cibil_vendors ORDER BY vendor_key`,
  );
  return rows.map((r) => ({
    vendorKey: r.vendor_key,
    displayName: r.display_name,
    sandboxMode: Boolean(r.sandbox_mode),
    isActive: Boolean(r.is_active),
    hasCredentials: Boolean(r.has_key),
    updatedAt: r.updated_at,
  }));
}

export async function updateCibilVendor(vendorKey, payload, updatedBy) {
  if (!VENDOR_KEYS.includes(vendorKey)) {
    const e = new Error('Unknown CIBIL vendor');
    e.status = 400;
    throw e;
  }
  await ensureMilestone4Schema();
  const pool = getPool();
  await pool.execute(
    `UPDATE cibil_vendors
     SET api_key = COALESCE(:api_key, api_key),
         api_secret = COALESCE(:api_secret, api_secret),
         sandbox_mode = COALESCE(:sandbox, sandbox_mode),
         is_active = COALESCE(:active, is_active),
         updated_by = :by,
         updated_at = NOW(3)
     WHERE vendor_key = :key`,
    {
      key: vendorKey,
      api_key: payload.apiKey ?? null,
      api_secret: payload.apiSecret ?? null,
      sandbox: payload.sandboxMode == null ? null : payload.sandboxMode ? 1 : 0,
      active: payload.isActive == null ? null : payload.isActive ? 1 : 0,
      by: updatedBy,
    },
  );
  if (payload.isActive) {
    await pool.execute(`UPDATE cibil_vendors SET is_active = 0 WHERE vendor_key != :key`, {
      key: vendorKey,
    });
    await pool.execute(`UPDATE cibil_vendors SET is_active = 1 WHERE vendor_key = :key`, {
      key: vendorKey,
    });
  }
  return listCibilVendors();
}

async function getActiveVendor(pool) {
  const [[row]] = await pool.execute(
    `SELECT * FROM cibil_vendors WHERE is_active = 1 LIMIT 1`,
  );
  return row;
}

async function sandboxPull({ vendor, application, customer }) {
  const data = parseJson(application.data);
  const score = 680 + Math.floor(Math.random() * 120);
  const reportDir = resolve(getUploadDir(), 'cibil-reports');
  mkdirSync(reportDir, { recursive: true });
  const fileName = `${application.id}-${Date.now()}.pdf`;
  const reportPath = resolve(reportDir, fileName);

  const lines = [
    'Rfincare — Credit Bureau Report (Sandbox)',
    `Vendor: ${vendor.display_name}`,
    `Application: ${application.application_number || application.id}`,
    `Customer: ${customer.full_name || '—'}`,
    `PAN: ${data.pan_number || data.panNumber || '—'}`,
    `Score: ${score}`,
    `Checked at: ${new Date().toISOString()}`,
    '',
    'This is a sandbox report for QC and manual review.',
  ];
  writeFileSync(reportPath, buildSimpleTextPdf(lines));

  return {
    status: 'success',
    creditScore: score,
    reportPath: `/uploads/cibil-reports/${fileName}`,
    response: { sandbox: true, vendor: vendor.vendor_key, score },
  };
}

async function productionPull({ vendor, application, customer }) {
  if (!vendor.api_key || !vendor.api_secret) {
    return {
      status: 'failed',
      creditScore: null,
      reportPath: null,
      errorMessage: 'API key and secret required for production pull',
      response: { error: 'missing_credentials' },
    };
  }
  // Production adapter placeholder — wire vendor SDK/REST when credentials are live.
  return sandboxPull({ vendor, application, customer });
}

export async function pullCibilForApplication(applicationId, { forceSandbox = false } = {}) {
  await ensureMilestone4Schema();
  const pool = getPool();
  const [[application]] = await pool.execute(
    `SELECT la.*, c.full_name, c.email, c.phone
     FROM loan_applications la
     JOIN user_profiles c ON c.id = la.customer_id
     WHERE la.id = :id LIMIT 1`,
    { id: applicationId },
  );
  if (!application) {
    const e = new Error('Application not found');
    e.status = 404;
    throw e;
  }

  const vendor = await getActiveVendor(pool);
  if (!vendor) {
    const e = new Error('No active CIBIL vendor configured in admin panel');
    e.status = 400;
    throw e;
  }

  const useSandbox = forceSandbox || Boolean(vendor.sandbox_mode);
  const result = useSandbox
    ? await sandboxPull({ vendor, application, customer: application })
    : await productionPull({ vendor, application, customer: application });

  const checkId = newId();
  await pool.execute(
    `INSERT INTO cibil_checks
     (id, application_id, customer_id, vendor_key, status, credit_score, report_path, error_message, response_payload)
     VALUES (:id, :app, :cust, :vendor, :status, :score, :path, :err, :resp)`,
    {
      id: checkId,
      app: applicationId,
      cust: application.customer_id,
      vendor: vendor.vendor_key,
      status: result.status,
      score: result.creditScore,
      path: result.reportPath,
      err: result.errorMessage || null,
      resp: JSON.stringify(result.response || {}),
    },
  );

  await pool.execute(
    `UPDATE loan_applications
     SET cibil_status = :status, cibil_checked_at = NOW(3)
     WHERE id = :id`,
    { id: applicationId, status: result.status },
  );

  return {
    checkId,
    vendorKey: vendor.vendor_key,
    vendorName: vendor.display_name,
    ...result,
  };
}

export async function getLatestCibilCheck(applicationId) {
  await ensureMilestone4Schema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT cc.*, cv.display_name AS vendor_name
     FROM cibil_checks cc
     LEFT JOIN cibil_vendors cv ON cv.vendor_key = cc.vendor_key
     WHERE cc.application_id = :id
     ORDER BY cc.checked_at DESC LIMIT 1`,
    { id: applicationId },
  );
  if (!row) return null;
  return {
    id: row.id,
    applicationId: row.application_id,
    vendorKey: row.vendor_key,
    vendorName: row.vendor_name,
    status: row.status,
    creditScore: row.credit_score,
    reportPath: row.report_path,
    errorMessage: row.error_message,
    checkedAt: row.checked_at,
  };
}

export async function requireSuccessfulCibilForSubmit(applicationId) {
  const latest = await getLatestCibilCheck(applicationId);
  if (!latest || latest.status !== 'success') {
    const pull = await pullCibilForApplication(applicationId);
    if (pull.status !== 'success') {
      const e = new Error(
        pull.errorMessage
          || 'CIBIL verification failed. Application saved for manual review — contact operations.',
      );
      e.status = 422;
      e.cibilStatus = pull.status;
      throw e;
    }
    return pull;
  }
  return latest;
}
