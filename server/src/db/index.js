const { Pool } = require("pg");
const { AsyncLocalStorage } = require("node:async_hooks");

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
// DATABASE_URL is required in every environment. There is no SQLite fallback:
// if it's missing or invalid, the process must fail loudly at boot rather
// than silently falling back to a local file (see productionCheck.js and the
// startup check in server.js).

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Postgres is required in every environment — " +
      "copy server/.env.example to server/.env and set DATABASE_URL."
  );
}
if (/^sqlite:/i.test(DATABASE_URL) || DATABASE_URL.endsWith(".db")) {
  throw new Error("DATABASE_URL points at SQLite. This runtime only supports PostgreSQL (postgres:// or postgresql://).");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Most managed Postgres providers (RDS, Supabase, Render, etc.) require TLS
  // but present a cert chain `pg` won't validate out of the box. Set
  // PGSSL=require to enable TLS without strict verification (documented in
  // DATABASE.md), or PGSSL=verify-full plus PGSSLROOTCERT for full verification.
  ssl:
    process.env.PGSSL === "disable"
      ? false
      : process.env.PGSSL === "verify-full"
      ? true
      : process.env.PGSSL === "require"
      ? { rejectUnauthorized: false }
      : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // Fired for idle clients that die in the background (e.g. network blip).
  // Never crash the process for this — just log it server-side.
  console.error("Unexpected idle Postgres client error:", err.message);
});

// ---------------------------------------------------------------------------
// Transaction-scoped client
// ---------------------------------------------------------------------------
// als holds the checked-out pg client for the duration of a withTransaction()
// call. Every db.query/get/all/run call below transparently uses it if
// present, so existing service code that calls other services (e.g.
// paymentService calling escrowService and walletService) automatically
// shares the same transaction and the same row locks without every function
// needing a `client` parameter threaded through it.
const als = new AsyncLocalStorage();

function currentExecutor() {
  return als.getStore() || pool;
}

// The whole codebase was written against SQLite's `?` positional
// placeholders. Rewriting every call site to `$1, $2, ...` would be a much
// larger, riskier diff than translating the placeholder style once, here.
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  const executor = currentExecutor();
  return executor.query(toPgPlaceholders(sql), params);
}

/** Like better-sqlite3's .get() — returns the first row or null. */
async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

/** Like better-sqlite3's .all() — returns every row. */
async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

/** Like better-sqlite3's .run() — returns { rowCount, rows } (rows populated if the query had RETURNING). */
async function run(sql, params = []) {
  const res = await query(sql, params);
  return { rowCount: res.rowCount, rows: res.rows };
}

/**
 * settingsService historically used SQLite's named `@param` placeholders
 * (better-sqlite3's `.run({ ...obj })`). Postgres's driver only supports
 * positional params, so this extracts `@name` tokens in order of first
 * appearance and builds the positional array from the supplied object —
 * letting that one call site keep its readable named-param SQL unchanged.
 */
async function namedRun(sql, paramsObj) {
  const order = [];
  const positional = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    order.push(name);
    return `$${order.length}`;
  });
  const values = order.map((name) => paramsObj[name]);
  return run(positional, values);
}

/**
 * Runs fn inside a single Postgres transaction (BEGIN/COMMIT/ROLLBACK) on one
 * dedicated client. fn may be sync or async, and any nested db.* calls or
 * other service functions it invokes (even in separate modules) will
 * transparently execute on the SAME client via AsyncLocalStorage, so a
 * financial operation across multiple services either fully commits or
 * fully rolls back.
 *
 * Reentrant: if a transaction is already open on the current async context
 * (als.getStore() is set), this just runs fn against that existing client
 * instead of opening a second connection — there is no real nested-BEGIN
 * support here, and two separate connections both trying to hold locks for
 * "one logical operation" is a deadlock waiting to happen. This is what lets
 * escrowService/walletService wrap their own bodies in transaction() for
 * correctness (see the FOR UPDATE lock comments in those files) while still
 * composing safely when a route wraps several of them in one outer
 * transaction() — the whole thing still commits or rolls back as one unit.
 */
async function transaction(fn) {
  const existingClient = als.getStore();
  if (existingClient) {
    return fn();
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await als.run(client, () => fn());
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Locks a single row for the remainder of the enclosing transaction —
 * required reading before any read-modify-write update (wallet balances,
 * escrow figures, withdrawal status) to prevent the double-spend / race
 * conditions called out in the PostgreSQL migration brief (§6). Must be
 * called from inside transaction(); throws (via a Postgres error) otherwise,
 * since FOR UPDATE outside a transaction is not meaningful.
 */
async function lockRow(table, idColumn, id) {
  return get(`SELECT * FROM ${table} WHERE ${idColumn} = ? FOR UPDATE`, [id]);
}

function nowIso() {
  return new Date().toISOString();
}

async function healthCheck() {
  const start = Date.now();
  await pool.query("SELECT 1");
  return { ok: true, latencyMs: Date.now() - start };
}

async function closePool() {
  await pool.end();
}

module.exports = {
  query,
  get,
  all,
  run,
  namedRun,
  transaction,
  lockRow,
  nowIso,
  healthCheck,
  closePool,
  pool,
};
