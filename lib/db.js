import { DatabaseSync } from 'node:sqlite';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS jewellers(
  id INTEGER PRIMARY KEY, phone TEXT UNIQUE NOT NULL, owner_name TEXT, shop_name TEXT, city TEXT,
  store_code TEXT UNIQUE, upi_vpa TEXT, pan_masked TEXT, pan_hash TEXT, gstin TEXT, bis_no TEXT,
  spread_bps INTEGER DEFAULT 100, calib_gold REAL DEFAULT 0, calib_silver REAL DEFAULT 0,
  gst_mode TEXT DEFAULT 'REGULAR', approval_required INTEGER DEFAULT 0,
  status TEXT DEFAULT 'SETUP', checklist TEXT DEFAULT '{}', hook_token TEXT,
  totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, created_ts INTEGER);

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT, dob TEXT,
  pan_enc TEXT, pan_masked TEXT, pan_hash TEXT, kyc_status TEXT DEFAULT 'NONE',
  jeweller_id INTEGER, link_status TEXT DEFAULT 'NONE',
  dpdp_consent_ts INTEGER, dpdp_consent_version TEXT, deleted_ts INTEGER, created_ts INTEGER);

CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, role TEXT, subject_id INTEGER, created_ts INTEGER);
CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY, jeweller_id INTEGER, used_by INTEGER, expires_ts INTEGER, created_ts INTEGER, staff_id TEXT);

CREATE TABLE IF NOT EXISTS enrolments(
  id INTEGER PRIMARY KEY, user_id INTEGER, jeweller_id INTEGER, product TEXT, frequency TEXT, instalment_paise INTEGER,
  start_date TEXT, maturity_date TEXT, expiry_date TEXT, status TEXT DEFAULT 'ACTIVE', redeem_requested_ts INTEGER,
  paused INTEGER DEFAULT 0, pause_count INTEGER DEFAULT 0, paused_ts INTEGER, staff_id TEXT, debit_day TEXT, created_ts INTEGER);

CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE, enrolment_id INTEGER, user_id INTEGER, jeweller_id INTEGER, amount_paise INTEGER,
  quote_rate_paise INTEGER, quote_ts INTEGER, quote_expires INTEGER, status TEXT DEFAULT 'CREATED',
  utr TEXT, submitted_ts INTEGER, confirmed_ts INTEGER, confirmed_by TEXT, note TEXT, created_ts INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS payments_utr ON payments(jeweller_id, utr) WHERE utr IS NOT NULL AND status NOT IN ('REJECTED','EXPIRED');

CREATE TABLE IF NOT EXISTS ledger(
  id INTEGER PRIMARY KEY AUTOINCREMENT, jeweller_id INTEGER, enrolment_id INTEGER, user_id INTEGER, type TEXT, product TEXT,
  amount_paise INTEGER, rate_paise INTEGER, rate_source TEXT, rate_ts INTEGER, grams_u INTEGER, balance_u INTEGER,
  payment_id INTEGER UNIQUE, utr TEXT, note TEXT, ts INTEGER, prev_hash TEXT, hash TEXT);

CREATE TABLE IF NOT EXISTS rate_history(ts INTEGER, xau REAL, xag REAL, usdinr REAL, source TEXT);
CREATE TABLE IF NOT EXISTS inbound_credits(id INTEGER PRIMARY KEY, jeweller_id INTEGER, amount_paise INTEGER, utr TEXT, raw TEXT, ts INTEGER, matched_payment_id INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_utr ON inbound_credits(jeweller_id, utr);

CREATE TABLE IF NOT EXISTS calib_log(id INTEGER PRIMARY KEY, jeweller_id INTEGER, product TEXT, board_rate_paise INTEGER, old_factor REAL, new_factor REAL, ts INTEGER);

CREATE TABLE IF NOT EXISTS audit_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, action TEXT,
  target_type TEXT, target_id TEXT, details TEXT, ip TEXT, ts INTEGER);

CREATE TABLE IF NOT EXISTS referrals(
  id INTEGER PRIMARY KEY AUTOINCREMENT, jeweller_id INTEGER, referrer_user_id INTEGER, referee_user_id INTEGER,
  status TEXT DEFAULT 'PENDING', reward_type TEXT, reward_pct REAL, created_ts INTEGER, rewarded_ts INTEGER);

CREATE TABLE IF NOT EXISTS gateway_configs(
  jeweller_id INTEGER PRIMARY KEY, provider TEXT NOT NULL, credentials_enc TEXT, webhook_secret_enc TEXT,
  active INTEGER DEFAULT 1, updated_ts INTEGER);

CREATE TABLE IF NOT EXISTS gateway_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, jeweller_id INTEGER, provider TEXT, event_id TEXT UNIQUE,
  event_type TEXT, payload TEXT, processed INTEGER DEFAULT 1, ts INTEGER);
`;

export function validateEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    const key = process.env.DATA_KEY;
    if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error('FATAL: DATA_KEY must be a 64-character hex string in production mode (for AES-256-GCM)');
    }
  }
}

function runMigrations(db) {
  // Ensure any columns added to existing SQLite tables are present
  const safeAddColumn = (table, colDef) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
    } catch {
      // Column already exists
    }
  };
  safeAddColumn('jewellers', 'totp_secret TEXT');
  safeAddColumn('jewellers', 'totp_enabled INTEGER DEFAULT 0');
  safeAddColumn('users', 'dpdp_consent_ts INTEGER');
  safeAddColumn('users', 'dpdp_consent_version TEXT');
  safeAddColumn('users', 'deleted_ts INTEGER');
  safeAddColumn('enrolments', 'paused INTEGER DEFAULT 0');
  safeAddColumn('enrolments', 'pause_count INTEGER DEFAULT 0');
  safeAddColumn('enrolments', 'paused_ts INTEGER');
  safeAddColumn('enrolments', 'staff_id TEXT');
  safeAddColumn('enrolments', 'debit_day TEXT');
  safeAddColumn('invites', 'staff_id TEXT');
}

export function openDb(path = process.env.DB_PATH || './data.db') {
  validateEnvironment();
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  runMigrations(db);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// PostgreSQL production migration DDL exporter
export function generatePostgresSchema() {
  return SCHEMA.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY')
    .replace(/INTEGER PRIMARY KEY/g, 'BIGINT PRIMARY KEY')
    .replace(/REAL/g, 'DOUBLE PRECISION')
    .replace(/TEXT/g, 'VARCHAR')
    .trim();
}
