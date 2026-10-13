require('dotenv').config();
const bcrypt = require('bcryptjs');
const { get, run, nowIso, closePool } = require('./src/db');
const { newId } = require('./src/utils/ids');

async function main() {
  const email = 'hassanmudasir111@gmail.com';
  const password = 'khemta1234';
  const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) { console.log('Already exists:', email); return; }
  const passwordHash = await bcrypt.hash(password, 12);
  const id = newId('usr');
  const ts = nowIso();
  await run(`INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at) VALUES (?, ?, ?, 'ADMIN', 0, 1, ?, ?)`, [id, email, passwordHash, ts, ts]);
  await run(`INSERT INTO profiles (id, user_id, display_name, languages, categories, created_at, updated_at) VALUES (?, ?, 'Platform Admin', '[]', '[]', ?, ?)`, [newId('prf'), id, ts, ts]);
  await run(`INSERT INTO wallets (id, user_id, balance_cents, pending_cents, total_earned_cents, created_at, updated_at) VALUES (?, ?, 0, 0, 0, ?, ?)`, [newId('wal'), id, ts, ts]);
  console.log('Admin account created:', email);
}
main().catch((e) => console.error(e)).finally(() => closePool());
