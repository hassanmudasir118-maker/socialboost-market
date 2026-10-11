const app = require("./app");

function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  // Note: PAYMENT_PROVIDER/PAYMENT_SECRET_KEY/PAYMENT_WEBHOOK_SECRET are
  // intentionally NOT required here. This deployment only accepts manual
  // (human-confirmed) payments such as EasyPaisa — there is no Stripe/card
  // gateway configured, and requiring those vars would stop the server from
  // starting at all. If a real card gateway is added later, set
  // PAYMENT_PROVIDER=stripe plus its keys and that code path will pick them
  // up on its own; nothing here needs to change.
  const required = ["JWT_SECRET", "CORS_ORIGIN", "APP_URL", "DATABASE_URL", "SOCIAL_TOKEN_ENCRYPTION_KEY"];
  const missing = required.filter((key) => !process.env[key] || /placeholder|change-me|dev-only/i.test(process.env[key]));
  if (missing.length) {
    console.error(`Production configuration incomplete. Missing/unsafe: ${missing.join(", ")}`);
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
