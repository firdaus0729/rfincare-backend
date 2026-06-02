import { getPool } from '../db/pool.js';

const CREDIT_SCORE_MAP = {
  excellent: 780,
  good: 725,
  fair: 675,
  poor: 600,
  very_poor: 550,
  unknown: 650,
  '-1': 0,
  minus_1: 0,
  '0': 0,
  zero: 0,
  no_history: 0,
};

function normalizeCreditScoreKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === '-1' || raw === 'minus_1' || raw === 'minus 1') return '-1';
  if (raw === '0' || raw === 'zero') return '0';
  if (raw === 'no_history' || raw === 'no history' || raw === 'nohistory') return 'no_history';
  return String(value || '').trim();
}

function parseRuleData(row) {
  if (!row?.data) return {};
  if (typeof row.data === 'object') return row.data;
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferSecuredCategory(loanType) {
  const key = normalizeKey(loanType);
  if (!key) return 'unsecured';
  if (
    key.includes('home') ||
    key.includes('mortgage') ||
    key.includes('property') ||
    key.includes('auto') ||
    key.includes('car') ||
    key.includes('gold') ||
    key.includes('lap') ||
    key.includes('secured')
  ) {
    return 'secured';
  }
  return 'unsecured';
}

function normalizeEmploymentType(value) {
  return String(value || 'salaried').toLowerCase();
}

function pmt(annualRatePercent, months, principal) {
  const monthlyRate = Number(annualRatePercent || 0) / 1200;
  if (!months || months <= 0 || !principal || principal <= 0) return 0;
  if (monthlyRate <= 0) return principal / months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * factor) / (factor - 1);
}

function principalFromEmi(annualRatePercent, months, emi) {
  const monthlyRate = Number(annualRatePercent || 0) / 1200;
  if (!months || months <= 0 || !emi || emi <= 0) return 0;
  if (monthlyRate <= 0) return emi * months;
  const factor = Math.pow(1 + monthlyRate, months);
  return (emi * (factor - 1)) / (monthlyRate * factor);
}

function getRuleNumber(ruleData, keys, fallback) {
  for (const key of keys) {
    const value = ruleData?.[key];
    if (value !== undefined && value !== null && value !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

export async function calculateEligibility(input) {
  const pool = getPool();
  const monthlyIncome = Number(input.monthlyIncome) || 0;
  const loanAmount = Number(input.loanAmount) || 0;
  const existingLoans = Number(input.existingLoans) || 0;
  const creditKey = normalizeCreditScoreKey(input.creditScore || input.creditScoreRange);
  const creditScore =
    CREDIT_SCORE_MAP[creditKey] ??
    CREDIT_SCORE_MAP[input.creditScore] ??
    CREDIT_SCORE_MAP[input.creditScoreRange] ??
    700;
  const employmentType = normalizeEmploymentType(input.employmentType);
  const loanType = input.loanType || input.loanPurpose || null;
  const loanCategory = inferSecuredCategory(loanType);
  const collateralValue = Number(input.collateralValue) || Number(input.propertyValue) || 0;

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

  const [matrixRates] = await pool.query(
    `SELECT bank_id, product_type, loan_type, interest_rate, credit_score_min, credit_score_max,
            loan_amount_min, loan_amount_max, term_max
     FROM interest_matrix_rates
     WHERE status = 'active'`,
  );

  const rulesByBank = new Map();
  for (const r of rules) {
    if (!rulesByBank.has(r.bank_id)) rulesByBank.set(r.bank_id, []);
    rulesByBank.get(r.bank_id).push(r);
  }

  const bankResults = [];
  const bankMap = new Map();
  const ratesByBank = new Map();

  for (const rate of matrixRates) {
    const bankId = rate.bank_id || '__generic__';
    if (!ratesByBank.has(bankId)) ratesByBank.set(bankId, []);
    ratesByBank.get(bankId).push(rate);
  }

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
    let matchedRate = null;
    let eligibleAmount = 0;
    let maxMonthlyEmi = 0;

    const bankRates = [...(ratesByBank.get(bankId) || []), ...(ratesByBank.get('__generic__') || [])];
    const loanTypeKey = normalizeKey(loanType);
    const categoryKey = normalizeKey(loanCategory);
    const productMatch = bankRates.find((rate) => {
      const productKey = normalizeKey(rate.product_type);
      const rateLoanKey = normalizeKey(rate.loan_type);
      const creditOk = creditScore >= Number(rate.credit_score_min || 0) && creditScore <= Number(rate.credit_score_max || 900);
      const amountOk = loanAmount <= 0
        || (loanAmount >= Number(rate.loan_amount_min || 0) && loanAmount <= Number(rate.loan_amount_max || Number.MAX_SAFE_INTEGER));
      const loanMatch = !loanTypeKey || productKey.includes(loanTypeKey) || loanTypeKey.includes(productKey);
      const categoryMatch = !rateLoanKey || rateLoanKey.includes(categoryKey);
      return creditOk && amountOk && loanMatch && categoryMatch;
    });
    matchedRate = Number(productMatch?.interest_rate || (loanCategory === 'secured' ? 9.5 : 15.5));

    if (bankRules.length > 0) {
      const scores = bankRules.map((rule) => {
        const d = parseRuleData(rule);
        let score = rule.approval_probability ?? 50;
        const minIncome = Number(d.min_annual_income ?? d.minAnnualIncome ?? d.min_income ?? d.minIncome ?? 0);
        const maxIncome = Number(d.max_annual_income ?? d.maxAnnualIncome ?? d.max_income ?? d.maxIncome ?? Infinity);
        const minCredit = Number(d.min_credit_score ?? d.minCreditScore ?? 0);
        const maxCredit = Number(d.max_credit_score ?? d.maxCreditScore ?? 900);
        const minLoan = Number(d.min_loan_amount ?? d.minLoanAmount ?? 0);
        const maxLoan = Number(d.max_loan_amount ?? d.maxLoanAmount ?? Infinity);

        if (monthlyIncome < minIncome || monthlyIncome > maxIncome) score -= 25;
        if (creditScore < minCredit || creditScore > maxCredit) score -= 20;
        if (loanAmount < minLoan || loanAmount > maxLoan) score -= 20;
        if (d.employment_types && !String(d.employment_types).includes(employmentType)) score -= 15;
        if (d.loan_types && loanType && !String(d.loan_types).includes(loanType)) score -= 10;

        const foirDefault = loanCategory === 'secured' ? 0.65 : employmentType === 'salaried' ? 0.55 : 0.5;
        const tenureDefault = loanCategory === 'secured' ? 240 : 60;
        const ltvDefault = loanCategory === 'secured' ? 0.75 : 1;

        const foir = getRuleNumber(
          d,
          ['foir', `${loanCategory}_foir`, `foir_${loanCategory}`, 'max_foir'],
          foirDefault,
        );
        const tenureMonths = getRuleNumber(
          d,
          [
            'tenure_months',
            `${loanCategory}_tenure_months`,
            `tenure_${loanCategory}_months`,
            'max_tenure_months',
          ],
          tenureDefault,
        );
        const ltv = getRuleNumber(
          d,
          ['ltv', 'ltv_ratio', 'max_ltv', `${loanCategory}_ltv`, `ltv_${loanCategory}`],
          ltvDefault,
        );
        maxMonthlyEmi = Math.max(0, monthlyIncome * foir - existingLoans);
        const emiEligible = principalFromEmi(matchedRate, tenureMonths, maxMonthlyEmi);
        const assetCap = loanCategory === 'secured' && collateralValue > 0 ? collateralValue * ltv : Number.MAX_SAFE_INTEGER;
        eligibleAmount = Math.max(eligibleAmount, Math.max(0, Math.min(emiEligible, assetCap)));

        const expectedEmi = pmt(matchedRate, tenureMonths, loanAmount);
        if (expectedEmi > maxMonthlyEmi) score -= 12;
        if (loanCategory === 'secured' && collateralValue > 0 && loanAmount > collateralValue * ltv) score -= 10;
        return Math.max(0, Math.min(100, score));
      });
      probability = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    } else {
      const foir = loanCategory === 'secured' ? 0.65 : employmentType === 'salaried' ? 0.55 : 0.5;
      const tenureMonths = loanCategory === 'secured' ? 240 : 60;
      const ltv = loanCategory === 'secured' ? 0.75 : 1;
      maxMonthlyEmi = Math.max(0, monthlyIncome * foir - existingLoans);
      const emiEligible = principalFromEmi(matchedRate, tenureMonths, maxMonthlyEmi);
      const assetCap = loanCategory === 'secured' && collateralValue > 0 ? collateralValue * ltv : Number.MAX_SAFE_INTEGER;
      eligibleAmount = Math.max(0, Math.min(emiEligible, assetCap));
      const incomeRatio = loanAmount > 0 ? eligibleAmount / loanAmount : 1;
      probability = Math.min(95, Math.round(40 + incomeRatio * 30 + (creditScore - 600) / 10));
    }

    bank.bestProbability = probability;
    bank.loanCategory = loanCategory;
    bank.eligibleAmount = Math.round(eligibleAmount);
    bank.maxMonthlyEmi = Math.round(maxMonthlyEmi);
    bank.estimatedRate = Number(matchedRate.toFixed(2));
    bankResults.push(bank);
  }

  bankResults.sort((a, b) => b.bestProbability - a.bestProbability);
  const overallProbability = bankResults.length
    ? Math.round(bankResults.reduce((s, b) => s + b.bestProbability, 0) / bankResults.length)
    : 0;

  const bestEligibleAmount = bankResults.reduce((max, bank) => Math.max(max, bank.eligibleAmount || 0), 0);
  const maxMonthlyEmi = bankResults.reduce((max, bank) => Math.max(max, bank.maxMonthlyEmi || 0), 0);
  const approved = overallProbability >= 70 && loanAmount <= bestEligibleAmount;

  return {
    overallProbability,
    eligibleAmount: Math.round(bestEligibleAmount),
    maxMonthlyEmi: Math.round(maxMonthlyEmi),
    loanCategory,
    status: approved ? 'likely_approved' : overallProbability >= 50 ? 'conditional' : 'unlikely',
    message: approved
      ? 'Strong match with lender criteria based on current parameters.'
      : loanCategory === 'secured'
        ? 'For secured products, eligible amount is capped by FOIR and LTV. Higher collateral value can improve eligibility.'
        : 'For unsecured products, eligibility is calculated from FOIR-based EMI capacity and tenure. Lower existing EMI can improve approval odds.',
    banks: bankResults.slice(0, 12),
    input: {
      monthlyIncome,
      loanAmount,
      creditScore,
      employmentType,
      loanType,
      collateralValue,
    },
  };
}
