require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const campaignRoutes = require("./routes/campaigns");
const walletRoutes = require("./routes/wallet");
const notificationRoutes = require("./routes/notifications");
const referralRoutes = require("./routes/referrals");
const adminRoutes = require("./routes/admin");
const paymentRoutes = require("./routes/payments");
const socialAccountRoutes = require("./routes/socialAccounts");
const db = require("./db");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));

// The webhook route needs the RAW request body to verify the provider's
// signature, so it must be wired up with express.raw() BEFORE the global
// express.json() parser below (which would otherwise consume/parse the body
// and make signature verification impossible).
app.use("/api/payments/webhook", express.raw({ type: "*/*", limit: "1mb" }));

app.use(express.json({ limit: "2mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Generic rate limit; auth routes get a tighter one to slow credential stuffing.
app.use("/api/", rateLimit({ windowMs: 60_000, max: 300 }));
app.use("/api/auth/", rateLimit({ windowMs: 60_000, max: 20 }));
app.use("/api/auth/forgot-password", rateLimit({ windowMs: 15 * 60_000, max: 5 }));

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Verifies the app can actually talk to Postgres — used by load balancers /
// orchestrators to distinguish "process is up" from "process can serve
// requests". Never returns connection details, credentials, or raw errors.
app.get("/api/health/database", async (req, res) => {
  try {
    const result = await db.healthCheck();
    res.json({ ok: true, latencyMs: result.latencyMs });
  } catch (err) {
    console.error("Database health check failed:", err.message);
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/social-accounts", socialAccountRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Centralized error handler — never leak stack traces in production.
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
});

module.exports = app;
