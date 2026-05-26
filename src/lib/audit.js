import { getPool } from '../db/pool.js';
import { newId } from './ids.js';

export async function writeAuditLog({
  userId,
  actionType,
  tableName,
  recordId = null,
  oldValues = null,
  newValues = null,
}) {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO audit_logs (id, user_id, action_type, table_name, record_id, old_values, new_values)
     VALUES (:id, :user_id, :action_type, :table_name, :record_id, :old_values, :new_values)`,
    {
      id: newId(),
      user_id: userId,
      action_type: actionType,
      table_name: tableName,
      record_id: recordId != null ? String(recordId) : null,
      old_values: oldValues != null ? JSON.stringify(oldValues) : null,
      new_values: newValues != null ? JSON.stringify(newValues) : null,
    },
  );
}
