const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { get, run, nowIso, transaction } = require("../db");
const { newId } = require("../utils/ids");
const { generateToken, hashToken } = require("../utils/tokens");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const sessionService = require("../services/sessionService");
const emailService = require("../services/emailService");
const auditService = require("../services/auditService");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const isDev = process.env.NODE_ENV !== "production";

function makeReferralCode(name) {
  const base = (name || "USER").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4) || "USER";
  return `${base}${Math.floor(100 + Math.random() * 900)}`;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    suspended: !!row.suspended,
    emailVerified: !!row.email_verified,
    accountStatus: row.suspended ? "SUSPENDED" : "ACTIVE",
    createdAt: row.created_at,
  };
}

function clientMeta(req) {
  return { userAgent: req.headers["user-agent"] || null, ip: req.ip };
}

// ---------------------------------------------------------------------------
// Register / Login / Logout / Refresh
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(["ADVERTISER", "CREATOR", "ADMIN"]),
  referralCode: z.string().optional().nullable(),
});

router.post("/register", validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password, role, referralCode } = req.body;

  const existing = await get("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
  if (existing) return res.status(409).json({ error: "An account with this email already exists" });

  const userId = await transaction(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const id = newId("usr");
    const ts = nowIso();
    await run(
      `INSERT INTO users (id, email, password_hash, role, suspended, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
      [id, email.toLowerCase(), passwordHash, role, ts, ts]
    );

    const profileId = newId("prf");
    const myCode = makeReferralCode(name);
    await run(
      `INSERT INTO profiles (id, user_id, display_name, languages, categories, referral_code, created_at, updated_at)
       VALUES (?, ?, ?, '[]', '[]', ?, ?, ?)`,
      [profileId, id, name, myCode, ts, ts]
    );

    await run(
      `INSERT INTO wallets (id, user_id, balance_cents, pending_cents, total_earned_cents, created_at, updated_at)
       VALUES (?, ?, 0, 0, 0, ?, ?)`,
      [newId("wal"), id, ts, ts]
    );

    if (referralCode) {
      const referrerProfile = await get("SELECT user_id FROM profiles WHERE referral_code = ?", [referralCode.trim().toUpperCase()]);
      if (referrerProfile && referrerProfile.user_id !== id) {
        await run(`INSERT INTO referrals (id, referrer_user_id, referred_user_id, created_at) VALUES (?, ?, ?, ?)`, [newId("ref"), referrerProfile.user_id, id, ts]);
      }
    }

    await auditService.log({ actorId: id, actorRole: role, action: "Account created", targetType: "User", targetId: id, details: email });
    return id;
  });

  // Issue an email verification token immediately on signup.
  const { raw, hash } = generateToken();
  await run(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [newId("evt"), userId, hash, new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString(), nowIso()]
  );
  const verifyLink = emailService.sendVerificationEmail(email.toLowerCase(), raw);

  const user = await get("SELECT * FROM users WHERE id = ?", [userId]);
  const { accessToken, refreshToken } = await sessionService.createSession(userId, clientMeta(req));

  res.status(201).json({
    accessToken, refreshToken, user: publicUser(user),
    ...(isDev ? { devVerifyLink: verifyLink } : {}),
  });
}));

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post("/login", validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);

  // Same generic error whether the email doesn't exist or the password is
  // wrong — never reveal which one it was (account enumeration protection).
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.suspended) return res.status(403).json({ error: "This account has been suspended. Contact support." });

  const { accessToken, refreshToken } = await sessionService.createSession(user.id, clientMeta(req));
  res.json({ accessToken, refreshToken, user: publicUser(user) });
}));

const refreshSchema = z.object({ refreshToken: z.string().min(1) });
router.post("/refresh", validate(refreshSchema), asyncHandler(async (req, res) => {
  const result = await sessionService.refreshSession(req.body.refreshToken, clientMeta(req));
  if (!result) return res.status(401).json({ error: "Session expired — please log in again" });
  res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
}));

router.post("/logout", validate(refreshSchema), asyncHandler(async (req, res) => {
  await sessionService.revokeSession(req.body.refreshToken);
  res.json({ ok: true });
}));

router.post("/logout-all", requireAuth, asyncHandler(async (req, res) => {
  await sessionService.revokeAllSessions(req.user.id);
  await auditService.log({ actorId: req.user.id, actorRole: req.user.role, action: "Logged out of all sessions", targetType: "User", targetId: req.user.id });
  res.json({ ok: true });
}));

router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  const profile = await get("SELECT * FROM profiles WHERE user_id = ?", [req.user.id]);
  res.json({ user: publicUser(user), profile });
}));

router.get("/sessions", requireAuth, asyncHandler(async (req, res) => {
  res.json({ sessions: await sessionService.listActivity(req.user.id) });
}));

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

router.post("/verify-email/request", requireAuth, asyncHandler(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });

  await run("UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL", [nowIso(), user.id]);
  const { raw, hash } = generateToken();
  await run(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [newId("evt"), user.id, hash, new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString(), nowIso()]
  );
  const link = emailService.sendVerificationEmail(user.email, raw);
  res.json({ ok: true, ...(isDev ? { devVerifyLink: link } : {}) });
}));

const verifyConfirmSchema = z.object({ token: z.string().min(1) });
router.post("/verify-email/confirm", validate(verifyConfirmSchema), asyncHandler(async (req, res) => {
  const hash = hashToken(req.body.token);
  const record = await get("SELECT * FROM email_verification_tokens WHERE token_hash = ?", [hash]);
  if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: "This verification link is invalid or has expired" });
  }
  await run("UPDATE email_verification_tokens SET used_at = ? WHERE id = ?", [nowIso(), record.id]);
  await run("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?", [nowIso(), record.user_id]);
  await auditService.log({ actorId: record.user_id, actorRole: null, action: "Email verified", targetType: "User", targetId: record.user_id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Forgot / reset password
// ---------------------------------------------------------------------------

const forgotSchema = z.object({ email: z.string().email() });
router.post("/forgot-password", validate(forgotSchema), asyncHandler(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE email = ?", [req.body.email.toLowerCase()]);
  let devLink;
  if (user) {
    await run("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL", [nowIso(), user.id]);
    const { raw, hash } = generateToken();
    await run(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
      [newId("prt"), user.id, hash, new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(), nowIso()]
    );
    devLink = emailService.sendPasswordResetEmail(user.email, raw);
    await auditService.log({ actorId: user.id, actorRole: user.role, action: "Requested password reset", targetType: "User", targetId: user.id });
  }
  // Always return the same generic response — never reveal whether the email exists.
  res.json({ ok: true, message: "If an account with that email exists, a reset link has been sent.", ...(isDev && devLink ? { devResetLink: devLink } : {}) });
}));

const resetSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8).max(200) });
router.post("/reset-password", validate(resetSchema), asyncHandler(async (req, res) => {
  const hash = hashToken(req.body.token);
  const record = await get("SELECT * FROM password_reset_tokens WHERE token_hash = ?", [hash]);
  if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: "This reset link is invalid or has expired" });
  }
  const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  const ts = nowIso();
  await run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [passwordHash, ts, record.user_id]);
  await run("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", [ts, record.id]);
  // Resetting the password invalidates every existing session — a stolen
  // session token becomes useless the moment the real owner regains access.
  await sessionService.revokeAllSessions(record.user_id);
  await auditService.log({ actorId: record.user_id, actorRole: null, action: "Password reset completed", targetType: "User", targetId: record.user_id });
  res.json({ ok: true });
}));

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });
router.post("/change-password", requireAuth, validate(changePasswordSchema), asyncHandler(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!(await bcrypt.compare(req.body.currentPassword, user.password_hash))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  await run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [passwordHash, nowIso(), user.id]);
  await auditService.log({ actorId: user.id, actorRole: user.role, action: "Password changed", targetType: "User", targetId: user.id });
  res.json({ ok: true });
}));

module.exports = router;
