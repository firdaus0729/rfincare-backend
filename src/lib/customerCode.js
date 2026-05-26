import { randomUUID } from 'node:crypto';

import { getPool } from '../db/pool.js';

/** Customer display ID: CUST-{first 8 hex chars of UUID, uppercase} */
export function generateCustomerCode() {
  const hex = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `CUST-${hex}`;
}

export async function assignUniqueCustomerCode(connOrPool, userId) {
  const pool = connOrPool?.execute ? connOrPool : getPool();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCustomerCode();
    try {
      const [result] = await pool.execute(
        `UPDATE user_profiles SET customer_code = :code WHERE id = :id AND customer_code IS NULL`,
        { code, id: userId },
      );
      if (result?.affectedRows > 0) return code;
      const [[row]] = await pool.execute(
        `SELECT customer_code FROM user_profiles WHERE id = :id LIMIT 1`,
        { id: userId },
      );
      if (row?.customer_code) return row.customer_code;
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') continue;
      throw err;
    }
  }
  throw new Error('Could not assign unique customer code');
}
