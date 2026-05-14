import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';

export const loanApplicationsRouter = Router();

loanApplicationsRouter.post('/', async (req, res, next) => {
  try {
    const data = req.body;
    const pool = getPool();
    const id = newId();
    
    await pool.execute(
      `INSERT INTO loan_applications (
        id, application_number, customer_id, agent_id, assigned_employee_id, selected_bank_id, status, status_notes, review_notes, eligibility_status, rejection_reason, submitted_at, reviewed_by, reviewed_at, data
      ) VALUES (
        :id, :application_number, :customer_id, :agent_id, :assigned_employee_id, :selected_bank_id, :status, :status_notes, :review_notes, :eligibility_status, :rejection_reason, :submitted_at, :reviewed_by, :reviewed_at, :data
      )`, {
        id,
        application_number: data.application_number || `RFC${Date.now()}`,
        customer_id: data.customer_id,
        agent_id: data.agent_id || null,
        assigned_employee_id: data.assigned_employee_id || null,
        selected_bank_id: data.selected_bank_id || null,
        status: data.status || 'draft',
        status_notes: data.status_notes || null,
        review_notes: data.review_notes || null,
        eligibility_status: data.eligibility_status || null,
        rejection_reason: data.rejection_reason || null,
        submitted_at: data.submitted_at ? new Date(data.submitted_at) : null,
        reviewed_by: data.reviewed_by || null,
        reviewed_at: data.reviewed_at ? new Date(data.reviewed_at) : null,
        data: JSON.stringify(data)
      }
    );
    
    res.status(201).json({ id, status: 'success' });
  } catch (err) {
    next(err);
  }
});
