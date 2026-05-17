import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { calculateEligibility } from '../lib/eligibilityEngine.js';
import { verifyAccessToken } from '../lib/jwt.js';

function getOptionalCustomerId(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (!token) return null;
  try {
    return verifyAccessToken(token).sub;
  } catch {
    return null;
  }
}

export const eligibilityAssessmentsRouter = Router();

const CreateSchema = z.object({
  loanType: z.string().optional(),
  loan_type: z.string().optional(),
  loanAmount: z.coerce.number().optional(),
  loan_amount: z.coerce.number().optional(),
  monthlyIncome: z.coerce.number().optional(),
  monthly_income: z.coerce.number().optional(),
  employmentType: z.string().optional(),
  employment_type: z.string().optional(),
  creditScoreRange: z.string().optional(),
  credit_score_range: z.string().optional(),
  existingLoans: z.coerce.number().optional(),
  existing_loans: z.coerce.number().optional(),
  eligibilityScore: z.coerce.number().optional(),
  eligibility_score: z.coerce.number().optional(),
  eligibilityStatus: z.string().optional(),
  eligibility_status: z.string().optional(),
  eligibleAmount: z.coerce.number().optional(),
  eligible_amount: z.coerce.number().optional(),
  leadId: z.string().optional(),
  lead_id: z.string().optional(),
  bankResults: z.array(z.unknown()).optional(),
  bank_results: z.array(z.unknown()).optional(),
});

eligibilityAssessmentsRouter.post('/', async (req, res, next) => {
  try {
    const body = CreateSchema.parse(req.body);
    const pool = getPool();
    const id = newId();
    const customerId = getOptionalCustomerId(req);

    const calcInput = {
      loanType: body.loanType || body.loan_type,
      loanAmount: body.loanAmount ?? body.loan_amount,
      monthlyIncome: body.monthlyIncome ?? body.monthly_income,
      employmentType: body.employmentType || body.employment_type,
      creditScore: body.creditScoreRange || body.credit_score_range,
      creditScoreRange: body.creditScoreRange || body.credit_score_range,
      existingLoans: body.existingLoans ?? body.existing_loans ?? 0,
    };

    let bankResults = body.bankResults || body.bank_results;
    let score = body.eligibilityScore ?? body.eligibility_score;
    let eligibleAmount = body.eligibleAmount ?? body.eligible_amount;

    if (!bankResults?.length) {
      const calculated = await calculateEligibility(calcInput);
      bankResults = calculated.banks;
      score = score ?? calculated.overallProbability;
      eligibleAmount = eligibleAmount ?? calculated.eligibleAmount;
    }

    await pool.execute(
      `INSERT INTO eligibility_assessments (
         id, customer_id, lead_id, loan_type, loan_amount, monthly_income,
         employment_type, credit_score_range, existing_loans,
         eligibility_score, eligibility_status, eligible_amount, bank_results
       ) VALUES (
         :id, :customer_id, :lead_id, :loan_type, :loan_amount, :monthly_income,
         :employment_type, :credit_score_range, :existing_loans,
         :score, :status, :eligible_amount, :bank_results
       )`,
      {
        id,
        customer_id: customerId,
        lead_id: body.leadId || body.lead_id || null,
        loan_type: calcInput.loanType || null,
        loan_amount: calcInput.loanAmount ?? null,
        monthly_income: calcInput.monthlyIncome ?? null,
        employment_type: calcInput.employmentType || null,
        credit_score_range: calcInput.creditScoreRange || null,
        existing_loans: calcInput.existingLoans ?? null,
        score: score ?? null,
        status: body.eligibilityStatus || body.eligibility_status || null,
        eligible_amount: eligibleAmount ?? null,
        bank_results: JSON.stringify(bankResults || []),
      },
    );

    res.status(201).json({
      id,
      eligibilityScore: score,
      eligibleAmount,
      bankResults,
    });
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      err.status = 503;
      err.message = 'Run database migration 007_milestone2_leads.sql';
    }
    next(err);
  }
});

eligibilityAssessmentsRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const pool = getPool();
    const customerId = req.query.customerId || req.auth?.userId;
    const [rows] = await pool.execute(
      `SELECT * FROM eligibility_assessments
       WHERE customer_id = :cid OR (:cid IS NULL AND customer_id IS NULL)
       ORDER BY created_at DESC LIMIT 50`,
      { cid: customerId || req.auth.userId },
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
