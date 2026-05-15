import { getPool } from '../db/pool.js';

const CREDIT_SCORE_MAP = {
  excellent: 780,
  good: 725,
  fair: 675,
  poor: 600,
};

function parseRuleData(row) {
  if (!row?.data) return {};
  if (typeof row.data === 'object') return row.data;
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

export async function calculateEligibility(input) {
  const pool = getPool();
  const monthlyIncome = Number(input.monthlyIncome) || 0;
  const loanAmount = Number(input.loanAmount) || 0;
  const existingLoans = Number(input.existingLoans) || 0;
  const creditScore = CREDIT_SCORE_MAP[input.creditScore] ?? CREDIT_SCORE_MAP[input.creditScoreRange] ?? 700;
  const employmentType = input.employmentType || 'salaried';
  const loanType = input.loanType || input.loanPurpose || null;

  const [banks] = await pool.query(
    `SELECT b.id, b.name, bp.id AS product_id, bp.name AS product_name, bp.data AS product_data
     FROM banks b
     LEFT JOIN bank_products bp ON bp.bank_id = b.id AND bp.is_active = 1
     WHERE b.status = 'active'
     ORDER BY b.display_priority DESC`,
  );

  const [rules] = await pool.query(
    `SELECT bank_id, approval_probability, priority, data
     FROM approval_matrix_rules
     WHERE is_active = 1
     ORDER BY priority DESC`,
  );

  const rulesByBank = new Map();
  for (const r of rules) {
    if (!rulesByBank.has(r.bank_id)) rulesByBank.set(r.bank_id, []);
    rulesByBank.get(r.bank_id).push(r);
  }

  const maxEmi = Math.max(0, monthlyIncome * 0.5 - existingLoans);
  const eligibleAmount = maxEmi * 60;

  const bankResults = [];
  const bankMap = new Map();

  for (const row of banks) {
    if (!bankMap.has(row.id)) {
      bankMap.set(row.id, { bankId: row.id, bankName: row.name, products: [], bestProbability: 0 });
    }
    const entry = bankMap.get(row.id);
    if (row.product_id) {
      entry.products.push({ id: row.product_id, name: row.product_name });
    }
  }

  for (const [bankId, bank] of bankMap) {
    const bankRules = rulesByBank.get(bankId) || [];
    let probability = 50;

    if (bankRules.length > 0) {
      const scores = bankRules.map((rule) => {
        const d = parseRuleData(rule);
        let score = rule.approval_probability ?? 50;
        const minIncome = Number(d.min_income ?? d.minIncome ?? 0);
        const maxIncome = Number(d.max_income ?? d.maxIncome ?? Infinity);
        const minCredit = Number(d.min_credit_score ?? d.minCreditScore ?? 0);
        const maxCredit = Number(d.max_credit_score ?? d.maxCreditScore ?? 900);
        const minLoan = Number(d.min_loan_amount ?? d.minLoanAmount ?? 0);
        const maxLoan = Number(d.max_loan_amount ?? d.maxLoanAmount ?? Infinity);

        if (monthlyIncome < minIncome || monthlyIncome > maxIncome) score -= 25;
        if (creditScore < minCredit || creditScore > maxCredit) score -= 20;
        if (loanAmount < minLoan || loanAmount > maxLoan) score -= 20;
        if (d.employment_types && !String(d.employment_types).includes(employmentType)) score -= 15;
        if (d.loan_types && loanType && !String(d.loan_types).includes(loanType)) score -= 10;
        return Math.max(0, Math.min(100, score));
      });
      probability = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    } else {
      const incomeRatio = loanAmount > 0 ? eligibleAmount / loanAmount : 1;
      probability = Math.min(95, Math.round(40 + incomeRatio * 30 + (creditScore - 600) / 10));
    }

    bank.bestProbability = probability;
    bankResults.push(bank);
  }

  bankResults.sort((a, b) => b.bestProbability - a.bestProbability);
  const overallProbability = bankResults.length
    ? Math.round(bankResults.reduce((s, b) => s + b.bestProbability, 0) / bankResults.length)
    : 0;

  const approved = overallProbability >= 70 && loanAmount <= eligibleAmount;

  return {
    overallProbability,
    eligibleAmount: Math.round(eligibleAmount),
    maxMonthlyEmi: Math.round(maxEmi),
    status: approved ? 'likely_approved' : overallProbability >= 50 ? 'conditional' : 'unlikely',
    message: approved
      ? 'Strong match with lender criteria based on current parameters.'
      : 'Additional documentation or co-applicant may improve approval odds.',
    banks: bankResults.slice(0, 12),
    input: {
      monthlyIncome,
      loanAmount,
      creditScore,
      employmentType,
      loanType,
    },
  };
}
