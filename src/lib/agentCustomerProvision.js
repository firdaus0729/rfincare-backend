import bcrypt from 'bcryptjs';

import { newId } from './ids.js';
import { assignUniqueCustomerCode } from './customerCode.js';
import { ensureMilestone3Schema } from '../db/ensureMilestone3Schema.js';

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Create or resolve a customer account for agent-assisted applications (no token switch). */
export async function provisionCustomerForAgent(pool, {
  email,
  phone,
  fullName,
  firstName,
  lastName,
  password,
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const e = new Error('Customer email is required');
    e.status = 400;
    throw e;
  }

  const displayName =
    fullName?.trim()
    || [firstName, lastName].filter(Boolean).join(' ').trim()
    || normalizedEmail;

  const [[existingAuth]] = await pool.execute(
    `SELECT au.id, up.role FROM auth_users au
     LEFT JOIN user_profiles up ON up.id = au.id
     WHERE au.email = :email LIMIT 1`,
    { email: normalizedEmail },
  );

  if (existingAuth?.id) {
    if (existingAuth.role && existingAuth.role !== 'customer') {
      const e = new Error('This email belongs to a staff account. Use a different customer email.');
      e.status = 409;
      throw e;
    }
    return { customerId: existingAuth.id, created: false };
  }

  const userId = newId();
  const tempPassword =
    password
    || `RFC${String(phone || '').replace(/\D/g, '').slice(-4) || '0000'}Cust!`;

  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await ensureMilestone3Schema();

  await pool.execute(
    `INSERT INTO auth_users (id, email, password_hash) VALUES (:id, :email, :ph)`,
    { id: userId, email: normalizedEmail, ph: passwordHash },
  );

  await pool.execute(
    `INSERT INTO user_profiles (id, email, full_name, phone, role, account_status, is_active)
     VALUES (:id, :email, :fullName, :phone, 'customer', 'active', 1)`,
    {
      id: userId,
      email: normalizedEmail,
      fullName: displayName,
      phone: phone || null,
    },
  );

  await assignUniqueCustomerCode(pool, userId);

  return { customerId: userId, created: true, temporaryPassword: tempPassword };
}

export function calculateCommissionFromApplication(row, config) {
  const data = parseJson(row.data);
  const loanAmount = Number(
    data.requested_loan_amount
    || data.requestedLoanAmount
    || data.loan_amount
    || data.loanAmount
    || 0,
  );
  const commissionType = config?.commission_type || 'percentage';
  const commissionValue = Number(config?.commission_value ?? 2.5);
  if (!loanAmount || loanAmount <= 0) return 0;
  if (commissionType === 'fixed') return Math.round(commissionValue);
  return Math.round((loanAmount * commissionValue) / 100);
}

export function commissionStatusForApplication(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'paid';
  if (['submitted', 'under_review', 'pending'].includes(s)) return 'processing';
  return 'pending';
}
