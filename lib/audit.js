import { nowMs } from './clock.js';

// Immutable Audit Log for all critical merchant and compliance operations
export function logAudit(db, { actorType, actorId, action, targetType = null, targetId = null, details = {}, ip = null }) {
  try {
    const detailJson = typeof details === 'string' ? details : JSON.stringify(details);
    db.prepare(`
      INSERT INTO audit_logs(actor_type, actor_id, action, target_type, target_id, details, ip, ts)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actorType || 'SYSTEM',
      actorId || 0,
      action,
      targetType,
      targetId ? String(targetId) : null,
      detailJson,
      ip,
      nowMs()
    );
  } catch (err) {
    // Audit logging should never bring down the primary flow, but must warn in console
    console.error('Audit log write failed:', err.message);
  }
}

export function queryAuditLogs(db, { limit = 50, actorType = null, actorId = null } = {}) {
  let sql = 'SELECT * FROM audit_logs';
  const params = [];
  const clauses = [];
  if (actorType) {
    clauses.push('actor_type = ?');
    params.push(actorType);
  }
  if (actorId) {
    clauses.push('actor_id = ?');
    params.push(actorId);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}
