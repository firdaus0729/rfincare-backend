import { getPool } from './pool.js';

let ensured = false;

export async function ensureDocumentSchema() {
  if (ensured) return;
  const pool = getPool();
  try {
    await pool.execute(
      'ALTER TABLE customer_documents ADD COLUMN verification_notes TEXT NULL AFTER verification_status',
    );
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
  ensured = true;
}
