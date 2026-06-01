import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { ensureOnboardingSchema } from '../db/ensureOnboardingSchema.js';
import { newId } from './ids.js';
import { sendStaffWelcomeEmail } from './email.js';
import { reserveUniqueAgentCode } from './agentCode.js';
import { ensureMilestone4Schema } from '../db/ensureMilestone4Schema.js';

const baseStaffFields = {
  username: z.string().min(3).max(128),
  password: z.string().min(8),
  email: z.string().email(),
  mobileNumber: z.string().min(10).max(32),
  accountNumber: z.string().min(1),
  bankName: z.string().min(1),
  ifscCode: z.string().min(4).max(32),
};

export const CreateAgentSchema = z
  .object({
    ...baseStaffFields,
    agentName: z.string().min(1),
    agentCode: z.string().min(1).max(64).optional(),
  })
  .passthrough();

export const CreateEmployeeSchema = z
  .object({
    ...baseStaffFields,
    employeeName: z.string().min(1),
    employeeCode: z.string().min(1).max(64),
  })
  .passthrough();

function normalizeBody(body = {}) {
  return {
    username: body.username ?? body.user_name,
    password: body.password,
    email: body.email,
    mobileNumber: body.mobileNumber ?? body.mobile_number,
    accountNumber: body.accountNumber ?? body.account_number,
    bankName: body.bankName ?? body.bank_name,
    ifscCode: body.ifscCode ?? body.ifsc_code,
    agentName: body.agentName ?? body.agent_name,
    agentCode: body.agentCode ?? body.agent_code,
    employeeName: body.employeeName ?? body.employee_name,
    employeeCode: body.employeeCode ?? body.employee_code,
  };
}

export async function createAgentAccount(input, createdByUserId) {
  await ensureOnboardingSchema();
  await ensureMilestone4Schema();
  const data = CreateAgentSchema.parse(normalizeBody(input));
  const pool = getPool();
  const userId = newId();
  const onboardingId = newId();
  const passwordHash = await bcrypt.hash(data.password, 12);
  const agentCode =
    data.agentCode?.trim() || (await reserveUniqueAgentCode(pool));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
      { id: userId, email: data.email, ph: passwordHash },
    );

    await conn.execute(
      `INSERT INTO user_profiles (
         id, email, full_name, phone, role, account_status, is_active, onboarding_status
       ) VALUES (
         :id, :email, :fullName, :phone, 'agent', 'pending', 0, 'pending'
       )`,
      {
        id: userId,
        email: data.email,
        fullName: data.agentName,
        phone: data.mobileNumber,
      },
    );

    await conn.execute(
      `INSERT INTO agent_onboarding (
         id, user_id, username, agent_name, agent_code, email, mobile_number,
         account_number, bank_name, ifsc_code, onboarding_status, qc_status, created_by
       ) VALUES (
         :id, :user_id, :username, :agent_name, :agent_code, :email, :mobile_number,
         :account_number, :bank_name, :ifsc_code, 'pending', 'pending_qc', :created_by
       )`,
      {
        id: onboardingId,
        user_id: userId,
        username: data.username,
        agent_name: data.agentName,
        agent_code: agentCode,
        email: data.email,
        mobile_number: data.mobileNumber,
        account_number: data.accountNumber,
        bank_name: data.bankName,
        ifsc_code: data.ifscCode.toUpperCase(),
        created_by: createdByUserId,
      },
    );

    await conn.commit();

    const [[row]] = await pool.execute(
      `SELECT up.*, ao.agent_code, ao.username, ao.onboarding_status AS ao_status
       FROM user_profiles up
       LEFT JOIN agent_onboarding ao ON ao.user_id = up.id
       WHERE up.id = :id LIMIT 1`,
      { id: userId },
    );

    await sendStaffWelcomeEmail({
      email: data.email,
      fullName: data.agentName,
      role: 'agent',
      password: data.password,
      loginPath: '/agent-login',
    }).catch((err) => console.warn('[staff-email]', err.message));

    return row;
  } catch (err) {
    await conn.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      const e = new Error('Username, agent code, or email already exists');
      e.status = 409;
      throw e;
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function createEmployeeAccount(input, createdByUserId) {
  await ensureOnboardingSchema();
  const data = CreateEmployeeSchema.parse(normalizeBody(input));
  const pool = getPool();
  const userId = newId();
  const onboardingId = newId();
  const passwordHash = await bcrypt.hash(data.password, 12);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
      { id: userId, email: data.email, ph: passwordHash },
    );

    await conn.execute(
      `INSERT INTO user_profiles (
         id, email, full_name, phone, role, account_status, is_active, onboarding_status
       ) VALUES (
         :id, :email, :fullName, :phone, 'employee', 'active', 1, 'active'
       )`,
      {
        id: userId,
        email: data.email,
        fullName: data.employeeName,
        phone: data.mobileNumber,
      },
    );

    await conn.execute(
      `INSERT INTO employee_onboarding (
         id, user_id, username, employee_name, employee_code, email, mobile_number,
         account_number, bank_name, ifsc_code, onboarding_status, created_by
       ) VALUES (
         :id, :user_id, :username, :employee_name, :employee_code, :email, :mobile_number,
         :account_number, :bank_name, :ifsc_code, 'active', :created_by
       )`,
      {
        id: onboardingId,
        user_id: userId,
        username: data.username,
        employee_name: data.employeeName,
        employee_code: data.employeeCode,
        email: data.email,
        mobile_number: data.mobileNumber,
        account_number: data.accountNumber,
        bank_name: data.bankName,
        ifsc_code: data.ifscCode.toUpperCase(),
        created_by: createdByUserId,
      },
    );

    await conn.commit();

    const [[row]] = await pool.execute(
      `SELECT up.*, eo.employee_code, eo.username, eo.onboarding_status AS eo_status
       FROM user_profiles up
       LEFT JOIN employee_onboarding eo ON eo.user_id = up.id
       WHERE up.id = :id LIMIT 1`,
      { id: userId },
    );

    await sendStaffWelcomeEmail({
      email: data.email,
      fullName: data.employeeName,
      role: 'employee',
      password: data.password,
      loginPath: '/employee-login',
    }).catch((err) => console.warn('[staff-email]', err.message));

    return row;
  } catch (err) {
    await conn.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      const e = new Error('Username, employee code, or email already exists');
      e.status = 409;
      throw e;
    }
    throw err;
  } finally {
    conn.release();
  }
}
