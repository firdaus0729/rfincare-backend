import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { ensureApprovalMatrixSchema } from '../db/ensureApprovalMatrixSchema.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { hasPermission } from '../auth/permissions.js';

export const approvalMatrixRouter = Router();

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function pick(body, ...keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== '') return body[key];
  }
  return undefined;
}

function normalizeRuleInput(body = {}) {
  const bankId = pick(body, 'bank_id', 'bankId');
  const ruleName = pick(body, 'rule_name', 'ruleName');
  if (!bankId) {
    const e = new Error('bankId is required');
    e.status = 400;
    throw e;
  }
  if (!ruleName) {
    const e = new Error('ruleName is required');
    e.status = 400;
    throw e;
  }

  const data = {
    loan_type: pick(body, 'loan_type', 'loanType') ?? null,
    min_annual_income: pick(body, 'min_annual_income', 'minAnnualIncome') ?? null,
    max_annual_income: pick(body, 'max_annual_income', 'maxAnnualIncome') ?? null,
    min_credit_score: pick(body, 'min_credit_score', 'minCreditScore') ?? null,
    max_credit_score: pick(body, 'max_credit_score', 'maxCreditScore') ?? null,
    employment_types: body.employment_types ?? body.employmentTypes ?? [],
    eligible_states: body.eligible_states ?? body.eligibleStates ?? [],
    eligible_cities: body.eligible_cities ?? body.eligibleCities ?? [],
    min_loan_amount: pick(body, 'min_loan_amount', 'minLoanAmount') ?? null,
    max_loan_amount: pick(body, 'max_loan_amount', 'maxLoanAmount') ?? null,
    min_age: pick(body, 'min_age', 'minAge') ?? null,
    max_age: pick(body, 'max_age', 'maxAge') ?? null,
    foir_unsecured: pick(body, 'foir_unsecured', 'foirUnsecured') ?? null,
    foir_secured: pick(body, 'foir_secured', 'foirSecured') ?? null,
    tenure_unsecured_months: pick(body, 'tenure_unsecured_months', 'tenureUnsecuredMonths') ?? null,
    tenure_secured_months: pick(body, 'tenure_secured_months', 'tenureSecuredMonths') ?? null,
    ltv_ratio: pick(body, 'ltv_ratio', 'ltvRatio') ?? null,
  };

  return {
    bankId,
    ruleName,
    priority: Number(body.priority ?? 0) || 0,
    isActive:
      body.is_active !== undefined
        ? Boolean(body.is_active)
        : body.isActive !== undefined
          ? Boolean(body.isActive)
          : true,
    approvalProbability: Number(body.approval_probability ?? body.approvalProbability ?? 75) || 75,
    data,
  };
}

function formatRule(row) {
  const d = parseJson(row.data);
  return {
    id: row.id,
    bank_id: row.bank_id,
    bankId: row.bank_id,
    rule_name: row.rule_name,
    ruleName: row.rule_name,
    loan_type: d.loan_type ?? d.loanType ?? null,
    loanType: d.loan_type ?? d.loanType ?? null,
    min_annual_income: d.min_annual_income ?? d.minAnnualIncome ?? null,
    minAnnualIncome: d.min_annual_income ?? d.minAnnualIncome ?? null,
    max_annual_income: d.max_annual_income ?? d.maxAnnualIncome ?? null,
    maxAnnualIncome: d.max_annual_income ?? d.maxAnnualIncome ?? null,
    min_credit_score: d.min_credit_score ?? d.minCreditScore ?? null,
    minCreditScore: d.min_credit_score ?? d.minCreditScore ?? null,
    max_credit_score: d.max_credit_score ?? d.maxCreditScore ?? null,
    maxCreditScore: d.max_credit_score ?? d.maxCreditScore ?? null,
    employment_types: d.employment_types ?? d.employmentTypes ?? [],
    employmentTypes: d.employment_types ?? d.employmentTypes ?? [],
    eligible_states: d.eligible_states ?? d.eligibleStates ?? [],
    eligibleStates: d.eligible_states ?? d.eligibleStates ?? [],
    eligible_cities: d.eligible_cities ?? d.eligibleCities ?? [],
    eligibleCities: d.eligible_cities ?? d.eligibleCities ?? [],
    min_loan_amount: d.min_loan_amount ?? d.minLoanAmount ?? null,
    minLoanAmount: d.min_loan_amount ?? d.minLoanAmount ?? null,
    max_loan_amount: d.max_loan_amount ?? d.maxLoanAmount ?? null,
    maxLoanAmount: d.max_loan_amount ?? d.maxLoanAmount ?? null,
    min_age: d.min_age ?? d.minAge ?? null,
    minAge: d.min_age ?? d.minAge ?? null,
    max_age: d.max_age ?? d.maxAge ?? null,
    maxAge: d.max_age ?? d.maxAge ?? null,
    foir_unsecured: d.foir_unsecured ?? d.foirUnsecured ?? null,
    foirUnsecured: d.foir_unsecured ?? d.foirUnsecured ?? null,
    foir_secured: d.foir_secured ?? d.foirSecured ?? null,
    foirSecured: d.foir_secured ?? d.foirSecured ?? null,
    tenure_unsecured_months:
      d.tenure_unsecured_months ?? d.tenureUnsecuredMonths ?? null,
    tenureUnsecuredMonths:
      d.tenure_unsecured_months ?? d.tenureUnsecuredMonths ?? null,
    tenure_secured_months:
      d.tenure_secured_months ?? d.tenureSecuredMonths ?? null,
    tenureSecuredMonths:
      d.tenure_secured_months ?? d.tenureSecuredMonths ?? null,
    ltv_ratio: d.ltv_ratio ?? d.ltvRatio ?? null,
    ltvRatio: d.ltv_ratio ?? d.ltvRatio ?? null,
    approval_probability: row.approval_probability,
    approvalProbability: row.approval_probability,
    is_active: !!row.is_active,
    isActive: !!row.is_active,
    priority: row.priority,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    banks: row.bank_name ? { id: row.bank_id, name: row.bank_name } : null,
  };
}

async function listRules(pool, { bankId } = {}) {
  const conditions = [];
  const params = {};
  if (bankId) {
    conditions.push('r.bank_id = :bankId');
    params.bankId = bankId;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `SELECT r.*, b.name AS bank_name
     FROM approval_matrix_rules r
     LEFT JOIN banks b ON b.id = r.bank_id
     ${where}
     ORDER BY r.priority DESC, r.created_at DESC`,
    params,
  );
  return rows.map(formatRule);
}

function canManageMatrix(role) {
  return (
    hasPermission(role, 'manage:approval_matrix')
    || hasPermission(role, 'update:*')
    || hasPermission(role, 'manage:*')
  );
}

function canReadMatrix(role) {
  return (
    hasPermission(role, 'read:approval_matrix')
    || hasPermission(role, 'read:*')
    || canManageMatrix(role)
  );
}

approvalMatrixRouter.get('/', authenticate, async (req, res, next) => {
  try {
    if (!canReadMatrix(req.auth.role)) {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }
    await ensureApprovalMatrixSchema();
    const pool = getPool();
    res.json(await listRules(pool));
  } catch (err) {
    next(err);
  }
});

approvalMatrixRouter.post('/', authenticate, async (req, res, next) => {
  try {
    if (!canManageMatrix(req.auth.role)) {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }
    await ensureApprovalMatrixSchema();
    const input = normalizeRuleInput(req.body);
    const pool = getPool();
    const id = newId();

    const [[bank]] = await pool.execute(`SELECT id FROM banks WHERE id = :id LIMIT 1`, {
      id: input.bankId,
    });
    if (!bank) {
      const e = new Error('Bank not found');
      e.status = 404;
      throw e;
    }

    await pool.execute(
      `INSERT INTO approval_matrix_rules (
         id, bank_id, rule_name, priority, is_active, approval_probability, data, created_by
       ) VALUES (
         :id, :bank_id, :rule_name, :priority, :is_active, :approval_probability, :data, :created_by
       )`,
      {
        id,
        bank_id: input.bankId,
        rule_name: input.ruleName,
        priority: input.priority,
        is_active: input.isActive ? 1 : 0,
        approval_probability: input.approvalProbability,
        data: JSON.stringify(input.data),
        created_by: req.auth.userId,
      },
    );

    const rules = await listRules(pool, { bankId: input.bankId });
    const created = rules.find((r) => r.id === id);
    res.status(201).json(created || rules[0]);
  } catch (err) {
    next(err);
  }
});

const PatchSchema = z.object({}).passthrough();

approvalMatrixRouter.patch('/:id', authenticate, async (req, res, next) => {
  try {
    if (!canManageMatrix(req.auth.role)) {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }
    const pool = getPool();
    const [[existing]] = await pool.execute(
      `SELECT * FROM approval_matrix_rules WHERE id = :id LIMIT 1`,
      { id: req.params.id },
    );
    if (!existing) {
      const e = new Error('Rule not found');
      e.status = 404;
      throw e;
    }

    const body = PatchSchema.parse(req.body);
    const merged = {
      ...formatRule(existing),
      ...body,
      bankId: body.bankId ?? body.bank_id ?? existing.bank_id,
      ruleName: body.ruleName ?? body.rule_name ?? existing.rule_name,
    };
    const input = normalizeRuleInput(merged);

    await pool.execute(
      `UPDATE approval_matrix_rules SET
         bank_id = :bank_id,
         rule_name = :rule_name,
         priority = :priority,
         is_active = :is_active,
         approval_probability = :approval_probability,
         data = :data
       WHERE id = :id`,
      {
        id: req.params.id,
        bank_id: input.bankId,
        rule_name: input.ruleName,
        priority: input.priority,
        is_active: input.isActive ? 1 : 0,
        approval_probability: input.approvalProbability,
        data: JSON.stringify(input.data),
      },
    );

    const rules = await listRules(pool, { bankId: input.bankId });
    const updated = rules.find((r) => r.id === req.params.id);
    res.json(updated || formatRule({ ...existing, bank_id: input.bankId, rule_name: input.ruleName }));
  } catch (err) {
    next(err);
  }
});

approvalMatrixRouter.delete('/:id', authenticate, async (req, res, next) => {
  try {
    if (!canManageMatrix(req.auth.role)) {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      throw e;
    }
    const pool = getPool();
    await pool.execute(`DELETE FROM approval_matrix_rules WHERE id = :id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Used by banksRouter: GET /banks/:bankId/approval-matrix-rules */
export async function listRulesForBank(pool, bankId) {
  return listRules(pool, { bankId });
}
