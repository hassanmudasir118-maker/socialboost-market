// Versioned, transactional Postgres migration runner.
//
//   node src/db/migrate.js up       — apply all pending migrations (default)
//   node src/db/migrate.js status   — list applied / pending migrations
//   node src/db/migrate.js reset    — DEV ONLY: drops and recreates the public
//                                     schema, then re-applies every migration.
//                                     Refuses to run when NODE_ENV=production.
//
// Migrations live in server/migrations/NNNN_description.sql and are applied
// in filename order. Each file runs inside its own transaction — if it
// throws partway through, that migration's changes are rolled back and later
// migrations are not attempted. Applied filenames are recorded in
// `_migrations` so re-running `up` is always safe (already-applied files are
// skipped). This intentionally never auto-generates a DROP/DELETE — a
// destructive schema change must be its own explicit migration file that a
// human wrote and reviewed.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool, query, transaction, closePool } = require("./index");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function getAppliedFilenames() {
  const res = await pool.query("SELECT filename FROM _migrations ORDER BY filename");
  return new Set(res.rows.map((r) => r.filename));
}

async function up() {
  await ensureMigrationsTable();
  const files = listMigrationFiles();
  const applied = await getAppliedFilenames();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("No pending migrations. Database is up to date.");
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`Applying ${file} ...`);
    try {
      await transaction(async () => {
        // query() (not pool.query) is required here so this runs on the same
        // client that BEGIN/COMMIT above are scoped to via AsyncLocalStorage.
        await query(sql);
        await query("INSERT INTO _migrations (filename) VALUES (?)", [file]);
      });
      console.log(`  ✓ ${file}`);
    } catch (err) {
      console.error(`  ✗ ${file} failed — rolled back. Later migrations were NOT applied.`);
      console.error(`    ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`Applied ${pending.length} migration(s).`);
}

async function status() {
  await ensureMigrationsTable();
  const files = listMigrationFiles();
  const applied = await getAppliedFilenames();
  console.log("Migration status:");
  for (const f of files) {
    console.log(`  [${applied.has(f) ? "x" : " "}] ${f}`);
  }
  const pendingCount = files.filter((f) => !applied.has(f)).length;
  console.log(pendingCount === 0 ? "Up to date." : `${pendingCount} pending.`);
}

async function reset() {
  if ((process.env.NODE_ENV || "development") === "production") {
    console.error("Refusing to reset: NODE_ENV=production. This command is development-only and drops all data.");
    process.exitCode = 1;
    return;
  }
  console.log("Dropping and recreating the public schema (development reset)...");
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await up();
}

async function main() {
  const cmd = process.argv[2] || "up";
  try {
    if (cmd === "up") await up();
    else if (cmd === "status") await status();
    else if (cmd === "reset") await reset();
    else {
      console.error(`Unknown command "${cmd}". Use: up | status | reset`);
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

main();
