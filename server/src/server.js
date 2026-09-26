const app = require("./app");

function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const required = ["JWT_SECRET", "CORS_ORIGIN", "APP_URL", "PAYMENT_PROVIDER", "PAYMENT_SECRET_KEY", "PAYMENT_WEBHOOK_SECRET", "DATABASE_URL", "SOCIAL_TOKEN_ENCRYPTION_KEY"];
  const missing = required.filter((key) => !process.env[key] || /placeholder|change-me|dev-only/i.test(process.env[key]));
  if (missing.length) {
    console.error(`Production configuration incomplete. Missing/unsafe: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (process.env.PAYMENT_PROVIDER === "mock" || process.env.PAYMENT_TEST_MODE === "true") {
    console.error("Production cannot start with mock/test payments enabled.");
    process.exit(1);
  }
  // Fails safely rather than silently falling back to SQLite or any other
  // datastore — this is the whole point of the migration (§15).
  if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
    console.error("DATABASE_URL must be a postgres:// or postgresql:// connection string in production.");
    process.exit(1);
  }
  // Fail loudly rather than let an invalid encryption key surface later as a
  // decrypt failure on someone's stored OAuth token.
  if (!require("./utils/crypto").isEncryptionConfigured()) {
    console.error("SOCIAL_TOKEN_ENCRYPTION_KEY is missing or invalid (must decode to exactly 32 bytes, base64 or hex).");
    process.exit(1);
  }
}

validateProductionConfig();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SocialBoost Market API listening on http://localhost:${PORT}`);
});
