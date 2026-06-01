import bcrypt from 'bcryptjs';

import { getPool } from '../db/pool.js';
import { ensureOnboardingSchema } from '../db/ensureOnboardingSchema.js';
import { sendStaffWelcomeEmail } from './email.js';
import { ensureAgentCodeForUser } from './agentCode.js';

function pick(body, ...keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      return body[key];
    }
  }
  return undefined;
}

export async function fetchAgentDetail(userId) {
  await ensureOnboardingSchema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT up.*, ao.username, ao.agent_name, ao.agent_code, ao.email AS ao_email,
            ao.mobile_number, ao.account_number, ao.bank_name, ao.ifsc_code,
            ao.onboarding_status AS ao_status
     FROM user_profiles up
     LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
     WHERE up.id = :id AND up.role = 'agent' LIMIT 1`,
    { id: userId },
  );
  if (!row) {
    const e = new Error('Agent not found');
    e.status = 404;
    throw e;
  }
  const agentCode = (await ensureAgentCodeForUser(pool, userId)) || row.agent_code;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name || row.agent_name,
    phone: row.phone || row.mobile_number,
    username: row.username,
    agentCode,
    agentName: row.agent_name || row.full_name,
    mobileNumber: row.mobile_number,
    accountNumber: row.account_number,
    bankName: row.bank_name,
    ifscCode: row.ifsc_code,
    accountStatus: row.account_status,
    onboardingStatus: row.ao_status || row.onboarding_status,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

export async function fetchEmployeeDetail(userId) {
  await ensureOnboardingSchema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT up.*, eo.username, eo.employee_name, eo.employee_code, eo.email AS eo_email,
            eo.mobile_number, eo.account_number, eo.bank_name, eo.ifsc_code,
            eo.onboarding_status AS eo_status
     FROM user_profiles up
     LEFT JOIN employee_onboarding eo ON eo.user_id = up.id
     WHERE up.id = :id AND up.role = 'employee' LIMIT 1`,
    { id: userId },
  );
  if (!row) {
    const e = new Error('Employee not found');
    e.status = 404;
    throw e;
  }
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name || row.employee_name,
    phone: row.phone || row.mobile_number,
    username: row.username,
    employeeCode: row.employee_code,
    employeeName: row.employee_name || row.full_name,
    mobileNumber: row.mobile_number,
    accountNumber: row.account_number,
    bankName: row.bank_name,
    ifscCode: row.ifsc_code,
    accountStatus: row.account_status,
    onboardingStatus: row.eo_status || row.onboarding_status,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

export async function updateAgentDetails(userId, body) {
  await ensureOnboardingSchema();
  const pool = getPool();
  const fullName = pick(body, 'agentName', 'agent_name', 'fullName', 'full_name');
  const email = pick(body, 'email');
  const phone = pick(body, 'mobileNumber', 'mobile_number', 'phone');
  const username = pick(body, 'username');
  const accountNumber = pick(body, 'accountNumber', 'account_number');
  const bankName = pick(body, 'bankName', 'bank_name');
  const ifscCode = pick(body, 'ifscCode', 'ifsc_code');
  const accountStatus = pick(body, 'accountStatus', 'account_status');
  const onboardingStatus = pick(body, 'onboardingStatus', 'onboarding_status');

  if (email) {
    const [[dup]] = await pool.execute(
      `SELECT id FROM auth_users WHERE email = :email AND id != :id LIMIT 1`,
      { email, id: userId },
    );
    if (dup) {
      const e = new Error('Email already in use');
      e.status = 409;
      throw e;
    }
    await pool.execute(`UPDATE auth_users SET email = :email WHERE id = :id`, { email, id: userId });
  }

  await pool.execute(
    `UPDATE user_profiles SET
       full_name = COALESCE(:full_name, full_name),
       email = COALESCE(:email, email),
       phone = COALESCE(:phone, phone),
       account_status = COALESCE(:account_status, account_status),
       onboarding_status = COALESCE(:onboarding_status, onboarding_status),
       is_active = CASE
         WHEN :account_status = 'active' THEN 1
         WHEN :account_status IN ('inactive', 'suspended') THEN 0
         ELSE is_active
       END
     WHERE id = :id AND role = 'agent'`,
    {
      id: userId,
      full_name: fullName || null,
      email: email || null,
      phone: phone || null,
      account_status: accountStatus || null,
      onboarding_status: onboardingStatus || null,
    },
  );

  await pool.execute(
    `UPDATE agent_onboarding SET
       agent_name = COALESCE(:agent_name, agent_name),
       email = COALESCE(:email, email),
       mobile_number = COALESCE(:mobile_number, mobile_number),
       username = COALESCE(:username, username),
       account_number = COALESCE(:account_number, account_number),
       bank_name = COALESCE(:bank_name, bank_name),
       ifsc_code = COALESCE(:ifsc_code, ifsc_code),
       onboarding_status = COALESCE(:onboarding_status, onboarding_status)
     WHERE user_id = :id`,
    {
      id: userId,
      agent_name: fullName || null,
      email: email || null,
      mobile_number: phone || null,
      username: username || null,
      account_number: accountNumber || null,
      bank_name: bankName || null,
      ifsc_code: ifscCode ? String(ifscCode).toUpperCase() : null,
      onboarding_status: onboardingStatus || null,
    },
  );

  return fetchAgentDetail(userId);
}

export async function updateEmployeeDetails(userId, body) {
  await ensureOnboardingSchema();
  const pool = getPool();
  const fullName = pick(body, 'employeeName', 'employee_name', 'fullName', 'full_name');
  const email = pick(body, 'email');
  const phone = pick(body, 'mobileNumber', 'mobile_number', 'phone');
  const username = pick(body, 'username');
  const employeeCode = pick(body, 'employeeCode', 'employee_code');
  const accountNumber = pick(body, 'accountNumber', 'account_number');
  const bankName = pick(body, 'bankName', 'bank_name');
  const ifscCode = pick(body, 'ifscCode', 'ifsc_code');
  const accountStatus = pick(body, 'accountStatus', 'account_status');
  const onboardingStatus = pick(body, 'onboardingStatus', 'onboarding_status');

  if (email) {
    const [[dup]] = await pool.execute(
      `SELECT id FROM auth_users WHERE email = :email AND id != :id LIMIT 1`,
      { email, id: userId },
    );
    if (dup) {
      const e = new Error('Email already in use');
      e.status = 409;
      throw e;
    }
    await pool.execute(`UPDATE auth_users SET email = :email WHERE id = :id`, { email, id: userId });
  }

  await pool.execute(
    `UPDATE user_profiles SET
       full_name = COALESCE(:full_name, full_name),
       email = COALESCE(:email, email),
       phone = COALESCE(:phone, phone),
       account_status = COALESCE(:account_status, account_status),
       onboarding_status = COALESCE(:onboarding_status, onboarding_status),
       is_active = CASE
         WHEN :account_status = 'active' THEN 1
         WHEN :account_status IN ('inactive', 'suspended') THEN 0
         ELSE is_active
       END
     WHERE id = :id AND role = 'employee'`,
    {
      id: userId,
      full_name: fullName || null,
      email: email || null,
      phone: phone || null,
      account_status: accountStatus || null,
      onboarding_status: onboardingStatus || null,
    },
  );

  await pool.execute(
    `UPDATE employee_onboarding SET
       employee_name = COALESCE(:employee_name, employee_name),
       email = COALESCE(:email, email),
       mobile_number = COALESCE(:mobile_number, mobile_number),
       username = COALESCE(:username, username),
       employee_code = COALESCE(:employee_code, employee_code),
       account_number = COALESCE(:account_number, account_number),
       bank_name = COALESCE(:bank_name, bank_name),
       ifsc_code = COALESCE(:ifsc_code, ifsc_code),
       onboarding_status = COALESCE(:onboarding_status, onboarding_status)
     WHERE user_id = :id`,
    {
      id: userId,
      employee_name: fullName || null,
      email: email || null,
      mobile_number: phone || null,
      username: username || null,
      employee_code: employeeCode || null,
      account_number: accountNumber || null,
      bank_name: bankName || null,
      ifsc_code: ifscCode ? String(ifscCode).toUpperCase() : null,
      onboarding_status: onboardingStatus || null,
    },
  );

  return fetchEmployeeDetail(userId);
}

export async function resetStaffPassword({ userId, password, role, fullName, email, notifyEmail }) {
  if (!password || String(password).length < 8) {
    const e = new Error('Password must be at least 8 characters');
    e.status = 400;
    throw e;
  }
  const pool = getPool();
  const hashed = await bcrypt.hash(password, 12);
  await pool.execute(`UPDATE auth_users SET password_hash = :ph WHERE id = :id`, {
    ph: hashed,
    id: userId,
  });
  await pool.execute(
    `UPDATE user_profiles SET password_change_required = 0 WHERE id = :id`,
    { id: userId },
  );

  if (notifyEmail && email) {
    const loginPath = role === 'agent' ? '/agent-login' : '/employee-login';
    await sendStaffWelcomeEmail({
      email,
      fullName: fullName || email,
      role,
      password,
      loginPath,
    }).catch((err) => console.warn('[staff-password-reset-email]', err.message));
  }

  return { success: true };
}
