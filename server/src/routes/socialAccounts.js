const express = require("express");
const { requireAuth } = require("../middleware/auth");
const socialAccountService = require("../services/socialAccountService");
const { SUPPORTED_PLATFORMS } = require("../services/socialProviders");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

function assertSupportedPlatform(req, res, next) {
  const platform = req.params.platform?.toUpperCase();
  if (!SUPPORTED_PLATFORMS.includes(platform)) return res.status(400).json({ error: `Unsupported platform. Supported: ${SUPPORTED_PLATFORMS.join(", ")}` });
  req.platform = platform;
  next();
}

// ---------------------------------------------------------------------------
// GET /api/social-accounts — list the current user's connections (own only, §12)
// ---------------------------------------------------------------------------
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  res.json({ socialAccounts: await socialAccountService.listForUser(req.user.id) });
}));

// ---------------------------------------------------------------------------
// GET /api/social-accounts/:platform/connect — Bearer-authenticated; returns
// the authorization URL for the frontend to navigate the browser to.
// ---------------------------------------------------------------------------
router.get("/:platform/connect", requireAuth, assertSupportedPlatform, async (req, res) => {
  try {
    const url = await socialAccountService.beginConnect({ userId: req.user.id, platform: req.platform });
    res.json({ authorizationUrl: url });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to start connection" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/social-accounts/:platform/callback — hit directly by the
// provider's redirect (a plain browser navigation, no Bearer token — see
// oauthStateService.js for why identity comes from the state instead).
// Always ends in an HTTP redirect back to the frontend, success or failure,
// so the user lands somewhere sensible either way rather than seeing raw JSON.
// ---------------------------------------------------------------------------
router.get("/:platform/callback", assertSupportedPlatform, async (req, res) => {
  const frontendBase = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";
  const redirect = (params) => res.redirect(`${frontendBase}/settings?${new URLSearchParams(params).toString()}`);

  try {
    const { code, state, error: providerError, error_description } = req.query;
    await socialAccountService.handleCallback({
      platform: req.platform,
      code,
      state,
      error: providerError ? (error_description || providerError) : null,
    });
    redirect({ social: "connected", platform: req.platform });
  } catch (err) {
    redirect({ social: "error", platform: req.platform, message: err.message || "Connection failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/social-accounts/:id/sync — manual metric refresh
// ---------------------------------------------------------------------------
router.post("/:id/sync", requireAuth, async (req, res) => {
  try {
    const account = await socialAccountService.syncOne(req.params.id, req.user.id);
    res.json({ socialAccount: account });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Sync failed" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/social-accounts/:id — disconnect (§10)
// ---------------------------------------------------------------------------
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await socialAccountService.disconnect({ userId: req.user.id, accountId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to disconnect" });
  }
});

module.exports = router;
