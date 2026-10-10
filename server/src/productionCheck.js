const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (!fs.existsSync(envPath)) {
  console.error("No server/.env found. Create it from .env.example.");
  process.exit(1);
}

const env = fs.readFileSync(envPath, "utf8");
const required = ["JWT_SECRET", "CORS_ORIGIN", "APP_URL", "PAYMENT_PROVIDER", "PAYMENT_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET", "DATABASE_URL", "SOCIAL_TOKEN_ENCRYPTION_KEY"];
const missing = required.filter((k) => !new RegExp(`^${k}\\s*=\\s*\\S`, "m").test(env)); // must have a non-empty value, not just the key
if (missing.length) {
  console.error("Missing production configuration:", missing.join(", "));
  process.exit(1);
}
if (/PAYMENT_PROVIDER\s*=\s*['"]?mock/i.test(env) || /PAYMENT_TEST_MODE\s*=\s*['"]?true/i.test(env)) {
  console.error("Payment provider is still configured for mock/test mode.");
  process.exit(1);
}
if (/placeholder|dev-only|change-me/i.test(env)) {
  console.error("Unsafe placeholder secrets remain in server/.env.");
  process.exit(1);
}
const dbUrlMatch = env.match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)/m);
const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim() : "";
if (!/^postgres(ql)?:\/\//i.test(dbUrl)) {
  console.error("DATABASE_URL must be a postgres:// or postgresql:// connection string. SQLite is not supported in production.");
  process.exit(1);
}
if (/localhost|127\.0\.0\.1/i.test(dbUrl)) {
  console.error("DATABASE_URL points at localhost — production must use a real managed/hosted Postgres instance.");
  process.exit(1);
}
const keyMatch = env.match(/^SOCIAL_TOKEN_ENCRYPTION_KEY\s*=\s*["']?([^"'\n]+)/m);
const rawKey = keyMatch ? keyMatch[1].trim() : "";
const keyBytes = /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, "hex") : Buffer.from(rawKey, "base64");
if (keyBytes.length !== 32) {
  console.error("SOCIAL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex). Generate one with `openssl rand -base64 32`.");
  process.exit(1);
}
const PLATFORM_ENV_VARS = {
  YOUTUBE: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REDIRECT_URI"],
  TIKTOK: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"],
  INSTAGRAM: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET", "INSTAGRAM_REDIRECT_URI"],
  FACEBOOK: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET", "FACEBOOK_REDIRECT_URI"],
};
for (const [platform, vars] of Object.entries(PLATFORM_ENV_VARS)) {
  const configured = vars.every((v) => new RegExp(`^${v}\\s*=\\s*\\S`, "m").test(env));
  if (!configured) console.warn(`Note: ${platform} OAuth is not fully configured — that "Connect" button will show a configuration error to users until it is (this is not a hard failure — platforms can be enabled incrementally).`);
}
console.log("Production configuration check passed.");
