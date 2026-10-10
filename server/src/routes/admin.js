const express = require("express");
const { z } = require("zod");
const { get, all, run, nowIso, transaction } = require("../db");
const { newId } = require("../utils/ids");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { centsToDollars, dollarsToCents } = require("../utils/money");
const settingsService = require("../services/settingsService");
const withdrawalService = require("../services/withdrawalService");
const paymentService = require("../services/paymentService");
const paymentGatewayService = require("../services/paymentGatewayService");
const notificationService = require("../services/notificationService");
const auditService = require("../services/auditService");
const statusService = require("../services/campaignStatusService");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth, requireRole("ADMIN")); // everything below is admin-only

// ---------------------------------------------------------------------------
// Overview KPIs — computed live from the DB, never cached client-side numbers
// ---------------------------------------------------------------------------
router.get("/overview", asyncHandler(async (req, res) => {
  const [
    totalUsersRow, advertisersRow, creatorsRow, activeCampaignsRow, completedCampaignsRow,
    revenueRow, creatorEarningsRow, pendingPaymentsRow, withdrawalRequestsRow, openDisputesRow,
  ] = await Promise.all([
    get("SELECT COUNT(*) as n FROM users"),
    get("SELECT COUNT(*) as n FROM users WHERE role='ADVERTISER'"),
    get("SELECT COUNT(*) as n FROM users WHERE role='CREATOR'"),
    get("SELECT COUNT(*) as n FROM campaigns WHERE status IN ('ACTIVE','IN_PROGRESS')"),
    get("SELECT COUNT(*) as n FROM campaigns WHERE status='COMPLETED'"),
    get("SELECT COALESCE(SUM(platform_fee_cents),0) as s FROM transactions WHERE type='CREATOR_PAYOUT' AND status='COMPLETED'"),
    get("SELECT COALESCE(SUM(net_cents),0) as s FROM transactions WHERE type='CREATOR_PAYOUT' AND status='COMPLETED'"),
    get("SELECT COALESCE(SUM(amount_cents),0) as s FROM transactions WHERE status='HELD_IN_ESCROW'"),
    get("SELECT COUNT(*) as n FROM withdrawals WHERE status='PENDING'"),
    get("SELECT COUNT(*) as n FROM disputes WHERE status='OPEN'"),
  ]);

  res.json({
    totalUsers: Number(totalUsersRow.n), advertisers: Number(advertisersRow.n), creators: Number(creatorsRow.n),
    activeCampaigns: Number(activeCampaignsRow.n), completedCampaigns: Number(completedCampaignsRow.n),
    totalPlatformRevenue: centsToDollars(revenueRow.s),
    totalCreatorEarnings: centsToDollars(creatorEarningsRow.s),
    pendingPayments: centsToDollars(pendingPaymentsRow.s),
    withdrawalRequests: Number(withdrawalRequestsRow.n), openDisputes: Number(openDisputesRow.n),
  });
}));

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
router.get("/users", asyncHandler(async (req, res) => {
  const { q, role, status } = req.query;
  let rows = await all(
    `SELECT u.*, p.display_name, p.username, p.verified FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.created_at DESC`
  );

  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((u) => u.email.toLowerCase().includes(needle) || (u.display_name || "").toLowerCase().includes(needle) || (u.username || "").toLowerCase().includes(needle));
  }
  if (role) rows = rows.filter((u) => u.role === role);
  if (status === "suspended") rows = rows.filter((u) => u.suspended);
  if (status === "active") rows = rows.filter((u) => !u.suspended);

  res.json({
    users: rows.map((u) => ({
      id: u.id, email: u.email, role: u.role, suspended: !!u.suspended,
      name: u.display_name, username: u.username, verified: !!u.verified,
      emailVerified: !!u.email_verified, createdAt: u.created_at,
    })),
  });
}));

// Full detail view for a single user — everything an admin needs to review
// an account, minus the password hash. Real data only: wallet totals and
// campaign counts come straight from the DB, never fabricated.
router.get("/users/:id/profile", asyncHandler(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  const profile = await get("SELECT * FROM profiles WHERE user_id = ?", [user.id]);
  const socialAccounts = await all("SELECT * FROM social_accounts WHERE user_id = ?", [user.id]);
  const wallet = await get("SELECT balance_cents, total_earned_cents FROM wallets WHERE user_id = ?", [user.id]);
  const reviewAgg = await get("SELECT COUNT(*) as n, COALESCE(AVG(rating),0) as avg FROM reviews WHERE to_user_id = ?", [user.id]);

  res.json({
    user: {
      id: user.id, email: user.email, role: user.role,
      accountStatus: user.suspended ? "SUSPENDED" : "ACTIVE",
      emailVerified: !!user.email_verified, createdAt: user.created_at,
    },
    profile: profile ? {
      displayName: profile.display_name, username: profile.username, bio: profile.bio,
      avatarUrl: profile.avatar_url, country: profile.country,
      languages: JSON.parse(profile.languages || "[]"), categories: JSON.parse(profile.categories || "[]"),
      verified: !!profile.verified, ratingAvg: Number(reviewAgg.avg), ratingCount: Number(reviewAgg.n),
      completedCampaigns: profile.completed_campaigns,
    } : null,
    socialAccounts: socialAccounts.map((s) => ({
      platform: s.platform, handle: s.handle, profileUrl: s.profile_url,
      followers: s.followers, engagementRate: s.engagement_rate, verifiedAt: s.verified_at,
    })),
    wallet: wallet ? { balance: centsToDollars(wallet.balance_cents), totalEarned: centsToDollars(wallet.total_earned_cents) } : null,
  });
}));

// Login/session activity — real records from user_sessions, not a fabricated log.
router.get("/users/:id/activity", asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT id, user_agent, ip_address, created_at, last_used_at, revoked_at, expires_at
     FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json({ activity: rows });
}));

router.post("/users/:id/suspend", asyncHandler(async (req, res) => {
  const user = await get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "User not found" });
  const next = user.suspended ? 0 : 1;
  await run("UPDATE users SET suspended = ?, updated_at = ? WHERE id = ?", [next, nowIso(), user.id]);
  await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: next ? "Suspended user" : "Reactivated user", targetType: "User", targetId: user.id, details: user.email });
  await notificationService.notify(user.id, {
    icon: next ? "alert" : "success",
    title: next ? "Account suspended" : "Account reactivated",
    body: next ? "Your account has been suspended by an administrator." : "Your account has been reactivated.",
  });
  res.json({ suspended: !!next });
}));

router.post("/users/:id/verify", asyncHandler(async (req, res) => {
  const profile = await get("SELECT * FROM profiles WHERE user_id = ?", [req.params.id]);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const next = profile.verified ? 0 : 1;
  await run("UPDATE profiles SET verified = ?, updated_at = ? WHERE user_id = ?", [next, nowIso(), req.params.id]);
  await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: next ? "Verified creator" : "Removed verification", targetType: "User", targetId: req.params.id });
  if (next) await notificationService.notify(req.params.id, { icon: "success", title: "You're verified!", body: "Your account now shows a verified badge." });
  res.json({ verified: !!next });
}));

// ---------------------------------------------------------------------------
// Campaigns oversight
// ---------------------------------------------------------------------------
router.get("/campaigns", asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM campaigns ORDER BY created_at DESC");
  const withCounts = await Promise.all(rows.map(async (c) => {
    const advertiserProfile = await get("SELECT display_name FROM profiles WHERE user_id = ?", [c.advertiser_id]);
    const applicantCountRow = await get("SELECT COUNT(*) as n FROM campaign_applications WHERE campaign_id = ?", [c.id]);
    return {
      id: c.id, title: c.title, platform: c.platform, status: c.status, adminApproved: !!c.admin_approved,
      budget: centsToDollars(c.budget_cents),
      advertiserName: advertiserProfile?.display_name,
      applicantCount: Number(applicantCountRow.n),
    };
  }));
  res.json({ campaigns: withCounts });
}));

router.post("/campaigns/:id/approve", asyncHandler(async (req, res) => {
  const c = await get("SELECT * FROM campaigns WHERE id = ?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  await run("UPDATE campaigns SET admin_approved = 1, updated_at = ? WHERE id = ?", [nowIso(), c.id]);
  await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Approved campaign", targetType: "Campaign", targetId: c.id, campaignId: c.id, details: c.title });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------
router.get("/withdrawals", asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT w.*, u.email FROM withdrawals w JOIN users u ON u.id = w.user_id ORDER BY w.requested_at DESC`
  );
  res.json({
    withdrawals: rows.map((w) => ({
      id: w.id, userEmail: w.email, amount: centsToDollars(w.amount_cents), fee: centsToDollars(w.fee_cents),
      net: centsToDollars(w.net_cents), status: w.status, payoutProvider: w.payout_provider, payoutProviderId: w.payout_provider_id,
      payoutStatus: w.payout_status, payoutFailureReason: w.payout_failure_reason, payoutRetryCount: w.payout_retry_count,
      requestedAt: w.requested_at, decidedAt: w.decided_at,
    })),
  });
}));

// payoutMethod "AUTO" (default) routes through the configured automated
// payout provider; "MANUAL" lets the admin pay the creator themselves
// outside the system (JazzCash/EasyPaisa/bank transfer) and confirm it
// afterwards via the existing payout-completed/payout-failed endpoints.
const resolveWithdrawSchema = z.object({ approve: z.boolean(), payoutMethod: z.enum(["AUTO", "MANUAL"]).optional() });
router.post("/withdrawals/:id/resolve", validate(resolveWithdrawSchema), async (req, res) => {
  try {
    const w = await withdrawalService.resolveWithdrawal({
      withdrawalId: req.params.id,
      approve: req.body.approve,
      adminId: req.user.id,
      payoutMethod: req.body.payoutMethod === "MANUAL" ? "MANUAL" : undefined,
    });
    await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: req.body.approve ? `Approved withdrawal (payout ${req.body.payoutMethod === "MANUAL" ? "MANUAL" : "processing"})` : "Rejected withdrawal", targetType: "Withdrawal", targetId: w.id, details: `$${centsToDollars(w.amount_cents)}` });
    await notificationService.notify(w.user_id, {
      icon: req.body.approve ? "payment" : "alert",
      title: req.body.approve ? "Withdrawal approved — payout processing" : "Withdrawal rejected",
      body: req.body.approve ? `Your withdrawal of $${centsToDollars(w.amount_cents)} was approved and is being processed.` : `Your withdrawal of $${centsToDollars(w.amount_cents)} was rejected and refunded.`,
    });
    res.json({ ok: true, payoutStatus: w.payout_status });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to resolve withdrawal" });
  }
});

// Test-mode / ops helpers: a real payout provider would confirm these via
// its own webhook, exactly like the payment side. Exposed to admins so the
// completion/failure/retry paths are testable end-to-end (§18 scenario 10).
router.post("/withdrawals/:id/payout-completed", async (req, res) => {
  try {
    const w = await withdrawalService.markPayoutCompleted(req.params.id);
    await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Marked payout completed", targetType: "Withdrawal", targetId: w.id });
    await notificationService.notify(w.user_id, { icon: "payment", title: "Withdrawal paid out", body: `Your withdrawal of $${centsToDollars(w.amount_cents)} has been paid.` });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post("/withdrawals/:id/payout-failed", validate(z.object({ reason: z.string().min(1) })), async (req, res) => {
  try {
    const w = await withdrawalService.markPayoutFailed(req.params.id, req.body.reason);
    await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Marked payout failed", targetType: "Withdrawal", targetId: w.id, details: req.body.reason });
    await notificationService.notify(w.user_id, { icon: "alert", title: "Payout failed", body: `Your withdrawal failed: ${req.body.reason}. Funds were returned to your balance.` });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.post("/withdrawals/:id/retry", async (req, res) => {
  try {
    const w = await withdrawalService.retryPayout(req.params.id);
    await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Retried payout", targetType: "Withdrawal", targetId: w.id });
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// Manual (human-confirmed) payment review — EasyPaisa/JazzCash personal
// account, bank transfer. An advertiser submits a reference after sending
// money themselves; escrow is only funded once an admin confirms it here.
// ---------------------------------------------------------------------------
router.get("/payments/manual/pending", asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT p.*, u.email AS advertiser_email, c.title AS campaign_title
       FROM payments p JOIN users u ON u.id = p.user_id JOIN campaigns c ON c.id = p.campaign_id
      WHERE p.provider = 'manual' AND p.manual_review_status = 'PENDING_REVIEW'
      ORDER BY p.updated_at ASC`
  );
  res.json({
    payments: rows.map((p) => ({
      id: p.id, advertiserEmail: p.advertiser_email, campaignTitle: p.campaign_title,
      amount: centsToDollars(p.amount_cents), method: p.payment_method,
      reference: p.manual_reference, note: p.manual_note, updatedAt: p.updated_at,
    })),
  });
}));

const resolveManualSchema = z.object({ confirm: z.boolean(), reason: z.string().optional().nullable() });
router.post("/payments/:id/manual-resolve", validate(resolveManualSchema), async (req, res) => {
  try {
    const payment = await paymentGatewayService.resolveManualPayment({
      paymentId: req.params.id, adminId: req.user.id, confirm: req.body.confirm, reason: req.body.reason,
    });
    res.json({ ok: true, status: payment.status, manualReviewStatus: payment.manual_review_status });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to resolve manual payment" });
  }
});

// ---------------------------------------------------------------------------
// Payment Center (§12)
// ---------------------------------------------------------------------------
router.get("/payments/overview", asyncHandler(async (req, res) => {
  const [
    totalVolumeRow, platformRevenueRow, creatorPayoutsRow, activeEscrowRow, reservedEscrowRow,
    totalRefundsRow, failedPaymentsRow, pendingWithdrawalsRow, processingPayoutsRow, failedPayoutsRow,
  ] = await Promise.all([
    get("SELECT COALESCE(SUM(amount_cents),0) as s FROM payments WHERE status='SUCCEEDED'"),
    get("SELECT COALESCE(SUM(platform_fee_cents),0) as s FROM transactions WHERE type='CREATOR_PAYOUT' AND status='COMPLETED'"),
    get("SELECT COALESCE(SUM(net_cents),0) as s FROM transactions WHERE type='CREATOR_PAYOUT' AND status='COMPLETED'"),
    get("SELECT COALESCE(SUM(funded_cents - reserved_cents - released_cents - refunded_cents),0) as s FROM campaign_escrow"),
    get("SELECT COALESCE(SUM(reserved_cents),0) as s FROM campaign_escrow"),
    get("SELECT COALESCE(SUM(amount_cents),0) as s FROM transactions WHERE type='REFUND'"),
    get("SELECT COUNT(*) as n FROM payments WHERE status='FAILED'"),
    get("SELECT COUNT(*) as n FROM withdrawals WHERE status='PENDING'"),
    get("SELECT COUNT(*) as n FROM withdrawals WHERE payout_status='PROCESSING'"),
    get("SELECT COUNT(*) as n FROM withdrawals WHERE payout_status='FAILED'"),
  ]);

  res.json({
    totalPaymentVolume: centsToDollars(totalVolumeRow.s),
    platformRevenue: centsToDollars(platformRevenueRow.s),
    creatorPayouts: centsToDollars(creatorPayoutsRow.s),
    activeEscrow: centsToDollars(activeEscrowRow.s),
    reservedEscrow: centsToDollars(reservedEscrowRow.s),
    totalRefunds: centsToDollars(totalRefundsRow.s),
    failedPayments: Number(failedPaymentsRow.n), pendingWithdrawals: Number(pendingWithdrawalsRow.n),
    processingPayouts: Number(processingPayoutsRow.n), failedPayouts: Number(failedPayoutsRow.n),
  });
}));

router.get("/payments", asyncHandler(async (req, res) => {
  const { status, q } = req.query;
  let rows = await all(`SELECT p.*, u.email, c.title as campaign_title FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN campaigns c ON c.id = p.campaign_id ORDER BY p.created_at DESC LIMIT 300`);
  if (status) rows = rows.filter((p) => p.status === status);
  if (q) { const needle = String(q).toLowerCase(); rows = rows.filter((p) => p.email.toLowerCase().includes(needle) || p.provider_payment_id.toLowerCase().includes(needle) || (p.campaign_title || "").toLowerCase().includes(needle)); }
  res.json({
    payments: rows.map((p) => ({
      id: p.id, userEmail: p.email, campaignTitle: p.campaign_title, provider: p.provider, providerPaymentId: p.provider_payment_id,
      amount: centsToDollars(p.amount_cents), currency: p.currency, platformFee: centsToDollars(p.platform_fee_cents),
      status: p.status, testMode: !!p.test_mode, failureReason: p.failure_reason, refunded: centsToDollars(p.refunded_cents), createdAt: p.created_at,
    })),
  });
}));

router.get("/webhook-events", asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 200");
  res.json({ events: rows });
}));

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
router.get("/disputes", asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM disputes ORDER BY created_at DESC");
  const enriched = await Promise.all(rows.map(async (d) => {
    const campaign = await get("SELECT title FROM campaigns WHERE id = ?", [d.campaign_id]);
    const raisedBy = await get("SELECT display_name FROM profiles WHERE user_id = ?", [d.raised_by_user_id]);
    return { ...d, campaignName: campaign?.title, raisedByName: raisedBy?.display_name };
  }));
  res.json({ disputes: enriched });
}));

const resolveDisputeSchema = z.object({ resolution: z.enum(["RELEASED_TO_CREATOR", "REFUNDED_TO_ADVERTISER"]) });
router.post("/disputes/:id/resolve", validate(resolveDisputeSchema), async (req, res) => {
  try {
    // The whole resolution — payment movement, deliverable/assignment/campaign
    // status, and the dispute record itself — is one atomic unit: either all
    // of it lands or none of it does.
    await transaction(async () => {
      const dispute = await get("SELECT * FROM disputes WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!dispute) throw Object.assign(new Error("Dispute not found"), { status: 404 });
      if (dispute.status !== "OPEN") throw Object.assign(new Error("Dispute already resolved"), { status: 400 });
      const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [dispute.campaign_id]);
      const application = await get("SELECT * FROM campaign_applications WHERE id = ?", [dispute.application_id]);
      const assignment = await get("SELECT * FROM campaign_assignments WHERE application_id = ?", [application.id]);

      if (req.body.resolution === "RELEASED_TO_CREATOR") {
        await paymentService.releaseAssignmentPayment({ assignment, campaign });
        const deliverable = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
        if (deliverable) await run("UPDATE campaign_deliverables SET status='APPROVED' WHERE id=?", [deliverable.id]);
        await run("UPDATE campaign_assignments SET status='COMPLETED', ended_at=? WHERE id=?", [nowIso(), assignment.id]);
        const remainingRow = await get("SELECT COUNT(*) as n FROM campaign_assignments WHERE campaign_id = ? AND status='ACTIVE'", [campaign.id]);
        await statusService.transitionCampaign(campaign.id, Number(remainingRow.n) === 0 ? "COMPLETED" : "IN_PROGRESS", { actorId: req.user.id, note: "Dispute resolved in favor of the creator" });
        await notificationService.notify(assignment.creator_id, { icon: "success", title: "Dispute resolved in your favor", body: `Payment for "${campaign.title}" has been released.` });
        await notificationService.notify(campaign.advertiser_id, { icon: "info", title: "Dispute resolved", body: `The dispute for "${campaign.title}" was resolved in favor of the creator.` });
      } else {
        await run("UPDATE campaign_assignments SET status='CANCELLED', ended_at=? WHERE id=?", [nowIso(), assignment.id]);
        await paymentService.cancelAssignmentReservation(campaign.id, assignment.agreed_rate_cents); // free the reservation back to available escrow
        await paymentService.refundCampaignFunding({ campaignId: campaign.id, advertiserId: campaign.advertiser_id, amountCentsOverride: assignment.agreed_rate_cents });
        const remainingRow = await get("SELECT COUNT(*) as n FROM campaign_assignments WHERE campaign_id = ? AND status='ACTIVE'", [campaign.id]);
        await statusService.transitionCampaign(campaign.id, Number(remainingRow.n) === 0 ? "PUBLISHED" : "IN_PROGRESS", { actorId: req.user.id, note: "Dispute resolved in favor of the advertiser" });
        await notificationService.notify(campaign.advertiser_id, { icon: "success", title: "Dispute resolved in your favor", body: `You've been refunded for "${campaign.title}".` });
        await notificationService.notify(assignment.creator_id, { icon: "info", title: "Dispute resolved", body: `The dispute for "${campaign.title}" was resolved in favor of the advertiser.` });
      }
      await run("UPDATE disputes SET status='RESOLVED', resolution=?, resolved_by_user_id=?, resolved_at=? WHERE id=?", [req.body.resolution, req.user.id, nowIso(), dispute.id]);
      await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Resolved dispute", targetType: "Dispute", targetId: dispute.id, campaignId: campaign.id, details: req.body.resolution });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to resolve dispute" });
  }
});

// ---------------------------------------------------------------------------
// Transactions (full ledger view)
// ---------------------------------------------------------------------------
router.get("/transactions", asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM transactions ORDER BY created_at DESC LIMIT 500");
  res.json({
    transactions: rows.map((t) => ({
      id: t.id, type: t.type, status: t.status, userId: t.user_id, campaignId: t.campaign_id,
      amount: centsToDollars(t.amount_cents), platformFee: centsToDollars(t.platform_fee_cents),
      netCents: centsToDollars(t.net_cents), createdAt: t.created_at,
    })),
  });
}));

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
router.get("/analytics", asyncHandler(async (req, res) => {
  const [statusRows, platformRows, roleRows] = await Promise.all([
    all("SELECT status, COUNT(*) as n FROM campaigns GROUP BY status"),
    all("SELECT platform, COUNT(*) as n FROM campaigns GROUP BY platform"),
    all("SELECT role, COUNT(*) as n FROM users GROUP BY role"),
  ]);

  const days = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });
  const revenueByDay = await Promise.all(days.map(async (day) => {
    const row = await get(
      `SELECT COALESCE(SUM(platform_fee_cents),0) as s FROM transactions
       WHERE type='CREATOR_PAYOUT' AND status='COMPLETED' AND substr(created_at,1,10) = ?`,
      [day]
    );
    return { date: day.slice(5), amount: centsToDollars(row.s) };
  }));

  res.json({
    campaignsByStatus: statusRows.map((r) => ({ name: r.status, value: Number(r.n) })),
    campaignsByPlatform: platformRows.map((r) => ({ name: r.platform, value: Number(r.n) })),
    usersByRole: roleRows.map((r) => ({ name: r.role, value: Number(r.n) })),
    revenueByDay,
  });
}));

// ---------------------------------------------------------------------------
// Settings, categories, platforms, promo codes
// ---------------------------------------------------------------------------
router.get("/settings", asyncHandler(async (req, res) => {
  const s = await settingsService.getSettings();
  res.json({
    settings: {
      commissionPercent: s.commission_bps / 100,
      minWithdrawal: centsToDollars(s.min_withdrawal_cents),
      maxWithdrawal: centsToDollars(s.max_withdrawal_cents),
      processingFeePercent: s.processing_fee_bps / 100,
      processingFeeFixed: centsToDollars(s.processing_fee_fixed_cents),
      categories: JSON.parse(s.categories),
      platforms: JSON.parse(s.platforms),
    },
  });
}));

const settingsSchema = z.object({
  commissionPercent: z.number().min(0).max(100).optional(),
  minWithdrawal: z.number().min(0).optional(),
  maxWithdrawal: z.number().min(0).optional(),
  processingFeePercent: z.number().min(0).optional(),
  processingFeeFixed: z.number().min(0).optional(),
});
router.put("/settings", validate(settingsSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  await settingsService.updateSettings({
    commissionBps: b.commissionPercent != null ? Math.round(b.commissionPercent * 100) : undefined,
    minWithdrawalCents: b.minWithdrawal != null ? dollarsToCents(b.minWithdrawal) : undefined,
    maxWithdrawalCents: b.maxWithdrawal != null ? dollarsToCents(b.maxWithdrawal) : undefined,
    processingFeeBps: b.processingFeePercent != null ? Math.round(b.processingFeePercent * 100) : undefined,
    processingFeeFixedCents: b.processingFeeFixed != null ? dollarsToCents(b.processingFeeFixed) : undefined,
  });
  await auditService.log({ actorId: req.user.id, actorRole: "ADMIN", action: "Updated payment settings", targetType: "Settings", targetId: "singleton" });
  res.json({ ok: true });
}));

router.post("/settings/categories", validate(z.object({ name: z.string().min(1) })), asyncHandler(async (req, res) => {
  res.json({ categories: await settingsService.addCategory(req.body.name) });
}));
router.delete("/settings/categories/:name", asyncHandler(async (req, res) => {
  res.json({ categories: await settingsService.removeCategory(req.params.name) });
}));
router.post("/settings/platforms", validate(z.object({ name: z.string().min(1) })), asyncHandler(async (req, res) => {
  res.json({ platforms: await settingsService.addPlatform(req.body.name) });
}));
router.delete("/settings/platforms/:name", async (req, res) => {
  try {
    res.json({ platforms: await settingsService.removePlatform(req.params.name) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/promo-codes", asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM promo_codes ORDER BY created_at DESC");
  res.json({ promoCodes: rows.map((p) => ({ code: p.code, discountPercent: p.discount_bps / 100, active: !!p.active, uses: p.uses })) });
}));
router.post("/promo-codes", validate(z.object({ code: z.string().min(1), discountPercent: z.number().min(0).max(100) })), asyncHandler(async (req, res) => {
  const code = req.body.code.toUpperCase();
  const existing = await get("SELECT id FROM promo_codes WHERE code = ?", [code]);
  if (existing) {
    await run("UPDATE promo_codes SET discount_bps = ?, active = 1 WHERE code = ?", [Math.round(req.body.discountPercent * 100), code]);
  } else {
    await run("INSERT INTO promo_codes (id, code, discount_bps, active, uses, created_at) VALUES (?, ?, ?, 1, 0, ?)", [newId("prm"), code, Math.round(req.body.discountPercent * 100), nowIso()]);
  }
  res.status(201).json({ ok: true });
}));
router.post("/promo-codes/:code/toggle", asyncHandler(async (req, res) => {
  const promo = await get("SELECT * FROM promo_codes WHERE code = ?", [req.params.code.toUpperCase()]);
  if (!promo) return res.status(404).json({ error: "Not found" });
  await run("UPDATE promo_codes SET active = ? WHERE code = ?", [promo.active ? 0 : 1, promo.code]);
  res.json({ active: !promo.active });
}));

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
router.get("/audit-logs", asyncHandler(async (req, res) => {
  res.json({ logs: await auditService.list(200) });
}));

module.exports = router;
