const express = require("express");
const { z } = require("zod");
const { get, all, run, nowIso } = require("../db");
const { newId } = require("../utils/ids");
const { requireAuth } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

function serializeProfile(p) {
  if (!p) return null;
  return {
    userId: p.user_id,
    displayName: p.display_name,
    username: p.username,
    bio: p.bio,
    avatarUrl: p.avatar_url,
    country: p.country,
    languages: JSON.parse(p.languages || "[]"),
    categories: JSON.parse(p.categories || "[]"),
    verified: !!p.verified,
    ratingAvg: p.rating_avg,
    ratingCount: p.rating_count,
    completedCampaigns: p.completed_campaigns,
  };
}
function serializeSocial(s) {
  return {
    id: s.id,
    platform: s.platform,
    handle: s.handle,
    profileUrl: s.profile_url,
    followers: s.followers,
    engagementRate: s.engagement_rate,
    verifiedAt: s.verified_at,
    // OAuth-verified connection fields (§8) — null/"NOT_CONNECTED" for
    // legacy self-reported rows, so existing clients that ignore these
    // fields keep working exactly as before.
    connectedVia: s.connected_via || "SELF_REPORTED",
    verificationStatus: s.verification_status || "NOT_CONNECTED",
    username: s.username,
    displayName: s.display_name,
    profileImageUrl: s.profile_image_url,
    followerCount: s.follower_count,
    followingCount: s.following_count,
    mediaCount: s.media_count,
    engagementMetrics: s.engagement_metrics ? JSON.parse(s.engagement_metrics) : null,
    lastVerifiedAt: s.last_verified_at,
    lastSyncedAt: s.last_synced_at,
    // Deliberately omitted: access_token_encrypted, refresh_token_encrypted.
  };
}

router.get("/me/profile", requireAuth, asyncHandler(async (req, res) => {
  const p = await get("SELECT * FROM profiles WHERE user_id = ?", [req.user.id]);
  res.json({ profile: serializeProfile(p) });
}));

// Combined view for the Account Settings screen: identity + profile +
// (for creators) real campaign history and real wallet totals — nothing here
// is derived from anything other than actual DB rows.
router.get("/me/account", requireAuth, asyncHandler(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  const profile = await get("SELECT * FROM profiles WHERE user_id = ?", [req.user.id]);
  const socialAccounts = await all("SELECT * FROM social_accounts WHERE user_id = ?", [req.user.id]);
  const wallet = await get("SELECT balance_cents, total_earned_cents FROM wallets WHERE user_id = ?", [req.user.id]);

  let campaignHistory;
  if (user.role === "CREATOR") {
    const totalRow = await get("SELECT COUNT(*) as n FROM campaign_applications WHERE creator_id = ?", [req.user.id]);
    const completedRow = await get(
      `SELECT COUNT(*) as n FROM campaign_applications a
       JOIN campaign_deliverables d ON d.application_id = a.id
       WHERE a.creator_id = ? AND d.status = 'APPROVED'`,
      [req.user.id]
    );
    campaignHistory = { totalApplications: Number(totalRow.n), completedCampaigns: Number(completedRow.n) };
  } else if (user.role === "ADVERTISER") {
    const totalRow = await get("SELECT COUNT(*) as n FROM campaigns WHERE advertiser_id = ?", [req.user.id]);
    const completedRow = await get("SELECT COUNT(*) as n FROM campaigns WHERE advertiser_id = ? AND status = 'COMPLETED'", [req.user.id]);
    campaignHistory = { totalCampaigns: Number(totalRow.n), completedCampaigns: Number(completedRow.n) };
  }

  res.json({
    user: {
      id: user.id, email: user.email, role: user.role,
      accountStatus: user.suspended ? "SUSPENDED" : "ACTIVE",
      emailVerified: !!user.email_verified,
      createdAt: user.created_at,
    },
    profile: serializeProfile(profile),
    socialAccounts: socialAccounts.map(serializeSocial),
    wallet: wallet ? { balance: wallet.balance_cents / 100, totalEarned: wallet.total_earned_cents / 100 } : { balance: 0, totalEarned: 0 },
    campaignHistory,
  });
}));

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_.]+$/).optional(),
  bio: z.string().max(500).optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  languages: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
});

router.patch("/me/profile", requireAuth, validate(updateProfileSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.username) {
    const clash = await get("SELECT user_id FROM profiles WHERE username = ? AND user_id != ?", [b.username, req.user.id]);
    if (clash) return res.status(409).json({ error: "Username already taken" });
  }
  await run(
    `UPDATE profiles SET display_name=COALESCE(?,display_name), username=COALESCE(?,username), bio=COALESCE(?,bio),
     avatar_url=COALESCE(?,avatar_url), country=COALESCE(?,country),
     languages=COALESCE(?,languages), categories=COALESCE(?,categories), updated_at=? WHERE user_id=?`,
    [
      b.displayName ?? null, b.username ?? null, b.bio ?? null, b.avatarUrl ?? null, b.country ?? null,
      b.languages ? JSON.stringify(b.languages) : null, b.categories ? JSON.stringify(b.categories) : null,
      nowIso(), req.user.id,
    ]
  );
  res.json({ profile: serializeProfile(await get("SELECT * FROM profiles WHERE user_id = ?", [req.user.id])) });
}));

// Public profile — used by the advertiser-facing creator marketplace.
router.get("/:id/public-profile", requireAuth, asyncHandler(async (req, res) => {
  const user = await get("SELECT id, role FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  const profile = await get("SELECT * FROM profiles WHERE user_id = ?", [user.id]);
  const socialAccounts = await all("SELECT * FROM social_accounts WHERE user_id = ?", [user.id]);
  const reviews = await all(
    `SELECT r.*, p.display_name as from_name FROM reviews r
     LEFT JOIN profiles p ON p.user_id = r.from_user_id
     WHERE r.to_user_id = ? ORDER BY r.created_at DESC LIMIT 20`,
    [user.id]
  );
  res.json({
    profile: serializeProfile(profile),
    socialAccounts: socialAccounts.map(serializeSocial),
    reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, text: r.text, fromName: r.from_name, verified: !!r.verified, createdAt: r.created_at })),
  });
}));

// ---------------------------------------------------------------------------
// Social accounts
// ---------------------------------------------------------------------------

router.get("/me/social-accounts", requireAuth, asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM social_accounts WHERE user_id = ?", [req.user.id]);
  res.json({ socialAccounts: rows.map(serializeSocial) });
}));

const addSocialSchema = z.object({
  platform: z.enum(["YOUTUBE", "TIKTOK", "INSTAGRAM", "FACEBOOK", "OTHER"]),
  handle: z.string().min(1),
  profileUrl: z.string().url(),
  followers: z.number().int().min(0).optional().default(0),
  engagementRate: z.number().min(0).max(100).optional().default(0),
});

// NOTE: followers/engagementRate are self-reported until OAuth-based platform
// verification is wired up (see README "Remaining production integrations").
// verifiedAt stays null so the UI can visibly distinguish self-reported stats
// from platform-verified ones once that integration lands.
router.post("/me/social-accounts", requireAuth, validate(addSocialSchema), asyncHandler(async (req, res) => {
  const id = newId("soc");
  const ts = nowIso();
  await run(
    `INSERT INTO social_accounts (id, user_id, platform, handle, profile_url, followers, engagement_rate, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [id, req.user.id, req.body.platform, req.body.handle, req.body.profileUrl, req.body.followers, req.body.engagementRate, ts, ts]
  );
  res.status(201).json({ socialAccount: serializeSocial(await get("SELECT * FROM social_accounts WHERE id = ?", [id])) });
}));

router.delete("/me/social-accounts/:id", requireAuth, asyncHandler(async (req, res) => {
  const row = await get("SELECT * FROM social_accounts WHERE id = ?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: "Not yours" });
  await run("DELETE FROM social_accounts WHERE id = ?", [req.params.id]);
  res.status(204).end();
}));

// Creator marketplace listing — advertisers/admins browse REAL registered
// creators only. There is no seeded/fake roster: if no creators have signed
// up and added social accounts yet, this legitimately returns an empty list.
router.get("/creators", requireAuth, asyncHandler(async (req, res) => {
  const { platform, country, category, minFollowers, maxFollowers, minEngagement, minRating } = req.query;

  const creators = await all(`SELECT u.id as user_id FROM users u WHERE u.role = 'CREATOR' AND u.suspended = 0`);

  const results = (
    await Promise.all(
      creators.map(async (row) => {
        const profile = await get("SELECT * FROM profiles WHERE user_id = ?", [row.user_id]);
        const socialAccounts = await all("SELECT * FROM social_accounts WHERE user_id = ?", [row.user_id]);
        // Prefer a verified OAuth follower_count over the self-reported
        // `followers` number when both exist for the same row — advertisers
        // browsing the marketplace should see real numbers first.
        const totalFollowers = socialAccounts.reduce((s, a) => s + (a.follower_count ?? a.followers), 0);
        const topEngagement = socialAccounts.length ? Math.max(...socialAccounts.map((a) => a.engagement_rate)) : 0;
        return { userId: row.user_id, profile: serializeProfile(profile), socialAccounts: socialAccounts.map(serializeSocial), totalFollowers, topEngagement };
      })
    )
  )
    .filter((c) => c.socialAccounts.length > 0) // only show creators who've added at least one account
    .filter((c) => !platform || c.socialAccounts.some((a) => a.platform === platform))
    .filter((c) => !country || c.profile.country === country)
    .filter((c) => !category || (c.profile.categories || []).includes(category))
    .filter((c) => !minFollowers || c.totalFollowers >= Number(minFollowers))
    .filter((c) => !maxFollowers || c.totalFollowers <= Number(maxFollowers))
    .filter((c) => !minEngagement || c.topEngagement >= Number(minEngagement))
    .filter((c) => !minRating || c.profile.ratingAvg >= Number(minRating));

  res.json({ creators: results });
}));

module.exports = router;
