const express = require("express");
const { z } = require("zod");
const { get, all, run, nowIso, transaction } = require("../db");
const { newId } = require("../utils/ids");
const { dollarsToCents, centsToDollars } = require("../utils/money");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const paymentService = require("../services/paymentService");
const statusService = require("../services/campaignStatusService");
const notificationService = require("../services/notificationService");
const auditService = require("../services/auditService");
const socialAccountService = require("../services/socialAccountService");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

const PUBLIC_STATUSES = ["PUBLISHED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "COMPLETED"];

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
function serializeCampaign(c, extra = {}) {
  if (!c) return null;
  return {
    id: c.id,
    advertiserId: c.advertiser_id,
    title: c.title,
    description: c.description,
    platform: c.platform,
    contentUrl: c.content_url,
    category: c.category,
    campaignType: c.campaign_type,
    requirements: c.requirements,
    eligibilityRequirements: c.eligibility_requirements,
    targetCountry: c.target_country,
    audienceAgeMin: c.audience_age_min,
    audienceAgeMax: c.audience_age_max,
    audienceGender: c.audience_gender,
    audienceLocations: JSON.parse(c.audience_locations || "[]"),
    audienceInterests: JSON.parse(c.audience_interests || "[]"),
    budget: centsToDollars(c.budget_cents),
    budgetPerCreator: centsToDollars(c.budget_per_creator_cents),
    commissionPercent: c.commission_bps / 100,
    maxCreators: c.max_creators,
    creatorMinFollowers: c.creator_min_followers,
    creatorMinEngagementPercent: c.creator_min_engagement_bps != null ? c.creator_min_engagement_bps / 100 : null,
    creatorRequiredCountry: c.creator_required_country,
    startDate: c.start_date,
    endDate: c.end_date,
    status: c.status,
    adminApproved: !!c.admin_approved,
    promoCode: c.promo_code,
    fundedAt: c.funded_at,
    publishedAt: c.published_at,
    completedAt: c.completed_at,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    ...extra,
  };
}
function serializeApplication(a) {
  if (!a) return null;
  return {
    id: a.id, campaignId: a.campaign_id, creatorId: a.creator_id, message: a.message,
    proposedRate: centsToDollars(a.proposed_rate_cents),
    estimatedCompletionDays: a.estimated_completion_days,
    relevantExperience: a.relevant_experience, socialAccountId: a.social_account_id,
    supportingInfo: a.supporting_info, status: a.status,
    infoRequestedAt: a.info_requested_at, infoRequestedNote: a.info_requested_note,
    appliedAt: a.applied_at, decidedAt: a.decided_at,
  };
}
function serializeAssignment(a) {
  if (!a) return null;
  return {
    id: a.id, campaignId: a.campaign_id, applicationId: a.application_id,
    creatorId: a.creator_id, advertiserId: a.advertiser_id,
    agreedRate: centsToDollars(a.agreed_rate_cents), status: a.status,
    startedAt: a.started_at, endedAt: a.ended_at,
  };
}
function serializeDeliverable(d, versions = []) {
  if (!d) return null;
  return {
    id: d.id, assignmentId: d.assignment_id, status: d.status, currentVersion: d.current_version,
    reviewNote: d.review_note, createdAt: d.created_at, updatedAt: d.updated_at,
    versions: versions.map((v) => ({
      id: v.id, versionNumber: v.version_number, contentUrl: v.content_url, promotionUrl: v.promotion_url,
      screenshotUrl: v.screenshot_url, notes: v.notes, completionDate: v.completion_date, submittedAt: v.submitted_at,
    })),
  };
}
async function requirementsList(campaignId) {
  const rows = await all("SELECT requirement_text FROM campaign_requirements WHERE campaign_id = ? ORDER BY sort_order ASC", [campaignId]);
  return rows.map((r) => r.requirement_text);
}

async function loadCampaignOr404(id, res) {
  const c = await get("SELECT * FROM campaigns WHERE id = ?", [id]);
  if (!c) { res.status(404).json({ error: "Campaign not found" }); return null; }
  return c;
}
async function acceptedAssignmentCount(campaignId) {
  const row = await get("SELECT COUNT(*) as n FROM campaign_assignments WHERE campaign_id = ? AND status = 'ACTIVE'", [campaignId]);
  return Number(row.n);
}

// ---------------------------------------------------------------------------
// Create / edit campaigns
// ---------------------------------------------------------------------------

const campaignSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().min(10),
  platform: z.enum(["YOUTUBE", "TIKTOK", "INSTAGRAM", "FACEBOOK", "OTHER"]),
  contentUrl: z.string().url(),
  category: z.string().min(1),
  campaignType: z.string().min(1),
  requirements: z.string().min(10),
  eligibilityRequirements: z.string().optional().nullable(),
  requirementsList: z.array(z.string()).optional().default([]),
  targetCountry: z.string().optional().nullable(),
  audienceAgeMin: z.number().int().optional().nullable(),
  audienceAgeMax: z.number().int().optional().nullable(),
  audienceGender: z.string().optional().nullable(),
  audienceLocations: z.array(z.string()).optional().default([]),
  audienceInterests: z.array(z.string()).optional().default([]),
  budget: z.number().positive(),
  budgetPerCreator: z.number().positive(),
  maxCreators: z.number().int().positive(),
  creatorMinFollowers: z.number().int().min(0).optional().nullable(),
  creatorMinEngagementPercent: z.number().min(0).max(100).optional().nullable(),
  creatorRequiredCountry: z.string().optional().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  submit: z.boolean().optional().default(false),
});

async function saveRequirements(campaignId, list) {
  await run("DELETE FROM campaign_requirements WHERE campaign_id = ?", [campaignId]);
  for (let i = 0; i < list.length; i++) {
    const text = list[i];
    if (!text.trim()) continue;
    await run(
      "INSERT INTO campaign_requirements (id, campaign_id, requirement_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
      [newId("req"), campaignId, text.trim(), i, nowIso()]
    );
  }
}

router.post("/", requireAuth, requireRole("ADVERTISER"), validate(campaignSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  if (new Date(b.endDate) <= new Date(b.startDate)) return res.status(400).json({ error: "End date must be after start date" });
  if (dollarsToCents(b.budgetPerCreator) * b.maxCreators > dollarsToCents(b.budget)) {
    return res.status(400).json({ error: "Budget per creator × max creators cannot exceed the total budget" });
  }

  const id = newId("cmp");
  const ts = nowIso();
  await run(
    `INSERT INTO campaigns (id, advertiser_id, title, description, platform, content_url, category, campaign_type,
       requirements, eligibility_requirements, target_country, audience_age_min, audience_age_max, audience_gender,
       audience_locations, audience_interests, budget_cents, budget_per_creator_cents, commission_bps, max_creators,
       creator_min_followers, creator_min_engagement_bps, creator_required_country,
       start_date, end_date, status, admin_approved, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'DRAFT', 0, ?, ?)`,
    [
      id, req.user.id, b.title, b.description, b.platform, b.contentUrl, b.category, b.campaignType,
      b.requirements, b.eligibilityRequirements ?? null, b.targetCountry ?? null, b.audienceAgeMin ?? null, b.audienceAgeMax ?? null,
      b.audienceGender ?? null, JSON.stringify(b.audienceLocations), JSON.stringify(b.audienceInterests),
      dollarsToCents(b.budget), dollarsToCents(b.budgetPerCreator), b.maxCreators,
      b.creatorMinFollowers ?? null, b.creatorMinEngagementPercent != null ? Math.round(b.creatorMinEngagementPercent * 100) : null, b.creatorRequiredCountry ?? null,
      b.startDate, b.endDate, ts, ts,
    ]
  );
  await saveRequirements(id, b.requirementsList);

  let campaign = await get("SELECT * FROM campaigns WHERE id = ?", [id]);
  if (b.submit) campaign = await statusService.transitionCampaign(id, "PENDING_PAYMENT", { actorId: req.user.id, note: "Submitted for payment" });

  await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: b.submit ? "Submitted campaign for payment" : "Saved campaign draft", targetType: "Campaign", targetId: id, campaignId: id, details: b.title });
  res.status(201).json({ campaign: serializeCampaign(campaign, { requirementsList: await requirementsList(id) }) });
}));

router.get("/mine", requireAuth, requireRole("ADVERTISER"), asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM campaigns WHERE advertiser_id = ? ORDER BY created_at DESC", [req.user.id]);
  const withCounts = await Promise.all(rows.map(async (c) => {
    const applicantCountRow = await get("SELECT COUNT(*) as n FROM campaign_applications WHERE campaign_id = ?", [c.id]);
    return {
      ...serializeCampaign(c),
      applicantCount: Number(applicantCountRow.n),
      acceptedCount: await acceptedAssignmentCount(c.id),
    };
  }));
  res.json({ campaigns: withCounts });
}));

// ---------------------------------------------------------------------------
// Public marketplace — filters, search, sort
// ---------------------------------------------------------------------------
router.get("/marketplace", requireAuth, requireRole("CREATOR"), asyncHandler(async (req, res) => {
  const { platform, category, country, minBudget, maxBudget, campaignType, deadlineBefore, q, sort } = req.query;

  let rows = await all(`SELECT * FROM campaigns WHERE status IN ('PUBLISHED', 'IN_PROGRESS')`);
  rows = rows.filter((c) => new Date(c.end_date) > new Date()); // deadline not passed

  const acceptedCounts = new Map();
  for (const c of rows) acceptedCounts.set(c.id, await acceptedAssignmentCount(c.id));
  rows = rows.filter((c) => acceptedCounts.get(c.id) < c.max_creators); // slots remain

  if (platform) rows = rows.filter((c) => c.platform === platform);
  if (category) rows = rows.filter((c) => c.category === category);
  if (country) rows = rows.filter((c) => c.target_country === country);
  if (campaignType) rows = rows.filter((c) => c.campaign_type === campaignType);
  if (minBudget) rows = rows.filter((c) => c.budget_per_creator_cents >= dollarsToCents(Number(minBudget)));
  if (maxBudget) rows = rows.filter((c) => c.budget_per_creator_cents <= dollarsToCents(Number(maxBudget)));
  if (deadlineBefore) rows = rows.filter((c) => new Date(c.end_date) <= new Date(deadlineBefore));
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((c) => c.title.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle));
  }

  if (sort === "budget_desc") rows.sort((a, b) => b.budget_per_creator_cents - a.budget_per_creator_cents);
  else if (sort === "budget_asc") rows.sort((a, b) => a.budget_per_creator_cents - b.budget_per_creator_cents);
  else if (sort === "deadline") rows.sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
  else rows.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)); // newest first (default)

  const appliedRows = await all("SELECT campaign_id FROM campaign_applications WHERE creator_id = ?", [req.user.id]);
  const alreadyAppliedIds = new Set(appliedRows.map((r) => r.campaign_id));

  const campaigns = await Promise.all(rows.map(async (c) => {
    const accepted = acceptedCounts.get(c.id);
    const advertiserProfile = await get("SELECT display_name, verified FROM profiles WHERE user_id = ?", [c.advertiser_id]);
    return {
      ...serializeCampaign(c, { requirementsList: await requirementsList(c.id) }),
      advertiserName: advertiserProfile?.display_name || "Advertiser",
      advertiserVerified: !!advertiserProfile?.verified,
      slotsRemaining: c.max_creators - accepted,
      alreadyApplied: alreadyAppliedIds.has(c.id),
    };
  }));

  res.json({ campaigns });
}));

// ---------------------------------------------------------------------------
// Single campaign
// ---------------------------------------------------------------------------
router.get("/:id", requireAuth, asyncHandler(async (req, res) => {
  const c = await loadCampaignOr404(req.params.id, res);
  if (!c) return;
  const isOwner = c.advertiser_id === req.user.id;
  const isAdmin = req.user.role === "ADMIN";
  const isAssignedCreator = !!(await get("SELECT 1 FROM campaign_assignments WHERE campaign_id = ? AND creator_id = ?", [c.id, req.user.id]));
  const isPublicViewable = PUBLIC_STATUSES.includes(c.status);
  if (!isOwner && !isAdmin && !isAssignedCreator && !isPublicViewable) return res.status(403).json({ error: "Not authorized to view this campaign" });

  const accepted = await acceptedAssignmentCount(c.id);
  res.json({
    campaign: serializeCampaign(c, {
      requirementsList: await requirementsList(c.id),
      slotsRemaining: c.max_creators - accepted,
      acceptedCount: accepted,
    }),
  });
}));

router.get("/:id/history", requireAuth, asyncHandler(async (req, res) => {
  const c = await loadCampaignOr404(req.params.id, res);
  if (!c) return;
  const isOwner = c.advertiser_id === req.user.id;
  const isAdmin = req.user.role === "ADMIN";
  const isAssignedCreator = !!(await get("SELECT 1 FROM campaign_assignments WHERE campaign_id = ? AND creator_id = ?", [c.id, req.user.id]));
  if (!isOwner && !isAdmin && !isAssignedCreator) return res.status(403).json({ error: "Not authorized" });
  res.json({ history: await statusService.getHistory(c.id) });
}));

router.patch("/:id", requireAuth, requireRole("ADVERTISER"), asyncHandler(async (req, res) => {
  const c = await loadCampaignOr404(req.params.id, res);
  if (!c) return;
  if (c.advertiser_id !== req.user.id) return res.status(403).json({ error: "Not your campaign" });
  if (c.status !== "DRAFT") return res.status(400).json({ error: "Only draft campaigns can be edited" });

  const patch = campaignSchema.partial().safeParse(req.body);
  if (!patch.success) return res.status(400).json({ error: "Validation failed", issues: patch.error.issues });
  const b = patch.data;
  const ts = nowIso();
  await run(
    `UPDATE campaigns SET title=COALESCE(?,title), description=COALESCE(?,description), platform=COALESCE(?,platform),
     content_url=COALESCE(?,content_url), category=COALESCE(?,category), campaign_type=COALESCE(?,campaign_type),
     requirements=COALESCE(?,requirements), eligibility_requirements=COALESCE(?,eligibility_requirements),
     target_country=COALESCE(?,target_country), audience_age_min=COALESCE(?,audience_age_min),
     audience_age_max=COALESCE(?,audience_age_max), audience_gender=COALESCE(?,audience_gender),
     audience_locations=COALESCE(?,audience_locations), audience_interests=COALESCE(?,audience_interests),
     budget_cents=COALESCE(?,budget_cents), budget_per_creator_cents=COALESCE(?,budget_per_creator_cents),
     max_creators=COALESCE(?,max_creators), creator_min_followers=COALESCE(?,creator_min_followers),
     creator_min_engagement_bps=COALESCE(?,creator_min_engagement_bps), creator_required_country=COALESCE(?,creator_required_country),
     start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date),
     updated_at=? WHERE id=?`,
    [
      b.title ?? null, b.description ?? null, b.platform ?? null, b.contentUrl ?? null, b.category ?? null, b.campaignType ?? null,
      b.requirements ?? null, b.eligibilityRequirements ?? null, b.targetCountry ?? null, b.audienceAgeMin ?? null, b.audienceAgeMax ?? null,
      b.audienceGender ?? null, b.audienceLocations ? JSON.stringify(b.audienceLocations) : null, b.audienceInterests ? JSON.stringify(b.audienceInterests) : null,
      b.budget != null ? dollarsToCents(b.budget) : null, b.budgetPerCreator != null ? dollarsToCents(b.budgetPerCreator) : null,
      b.maxCreators ?? null, b.creatorMinFollowers ?? null, b.creatorMinEngagementPercent != null ? Math.round(b.creatorMinEngagementPercent * 100) : null, b.creatorRequiredCountry ?? null,
      b.startDate ?? null, b.endDate ?? null, ts, c.id,
    ]
  );
  if (b.requirementsList) await saveRequirements(c.id, b.requirementsList);

  let campaign = await get("SELECT * FROM campaigns WHERE id = ?", [c.id]);
  if (b.submit) campaign = await statusService.transitionCampaign(c.id, "PENDING_PAYMENT", { actorId: req.user.id, note: "Submitted for payment" });
  res.json({ campaign: serializeCampaign(campaign, { requirementsList: await requirementsList(c.id) }) });
}));

// Deprecated: campaign funding now goes through /api/payments/checkout +
// webhook confirmation (see paymentGatewayService). This endpoint is kept
// only to give a clear error to any old client still calling it directly —
// there is no code path left that lets a client mark a campaign funded.
router.post("/:id/fund", requireAuth, requireRole("ADVERTISER"), (req, res) => {
  res.status(410).json({ error: "Direct funding is disabled. Use POST /api/payments/checkout, then confirm via the payment provider." });
});

router.post("/:id/publish", requireAuth, requireRole("ADVERTISER"), async (req, res) => {
  try {
    const campaign = await paymentService.publishCampaign({ campaignId: req.params.id, advertiserId: req.user.id });
    await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Published campaign to marketplace", targetType: "Campaign", targetId: campaign.id, campaignId: campaign.id, details: campaign.title });
    res.json({ campaign: serializeCampaign(campaign) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to publish campaign" });
  }
});

router.post("/:id/cancel", requireAuth, requireRole("ADVERTISER"), asyncHandler(async (req, res) => {
  const c = await loadCampaignOr404(req.params.id, res);
  if (!c) return;
  if (c.advertiser_id !== req.user.id) return res.status(403).json({ error: "Not your campaign" });
  if ((await acceptedAssignmentCount(c.id)) > 0) {
    return res.status(400).json({ error: "Cancel or resolve every active creator assignment before cancelling the whole campaign" });
  }
  const hasEscrow = ["FUNDED", "PUBLISHED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "DISPUTED"].includes(c.status);
  try {
    if (hasEscrow) await paymentService.refundCampaignFunding({ campaignId: c.id, advertiserId: req.user.id });
    const campaign = await statusService.transitionCampaign(c.id, "CANCELLED", { actorId: req.user.id, note: "Cancelled by advertiser" });
    await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Cancelled campaign", targetType: "Campaign", targetId: c.id, campaignId: c.id, details: c.title });
    res.json({ campaign: serializeCampaign(campaign) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to cancel campaign" });
  }
}));

router.post("/:id/complete", requireAuth, requireRole("ADVERTISER"), asyncHandler(async (req, res) => {
  const c = await loadCampaignOr404(req.params.id, res);
  if (!c) return;
  if (c.advertiser_id !== req.user.id) return res.status(403).json({ error: "Not your campaign" });
  try {
    const campaign = await statusService.transitionCampaign(c.id, "COMPLETED", { actorId: req.user.id, note: "Marked completed by advertiser" });
    await paymentService.markFundingReleased(c.id);
    await notificationService.notify(req.user.id, { icon: "success", title: "Campaign completed", body: `"${campaign.title}" is now complete.` });
    await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Marked campaign completed", targetType: "Campaign", targetId: c.id, campaignId: c.id });
    res.json({ campaign: serializeCampaign(campaign) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to complete campaign" });
  }
}));

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------
const applySchema = z.object({
  message: z.string().min(1),
  proposedRate: z.number().positive(),
  estimatedCompletionDays: z.number().int().positive().optional().nullable(),
  relevantExperience: z.string().optional().nullable(),
  socialAccountId: z.string().optional().nullable(),
  supportingInfo: z.string().optional().nullable(),
});

router.post("/:id/applications", requireAuth, requireRole("CREATOR"), validate(applySchema), asyncHandler(async (req, res) => {
  const c = await loadCampaignOr404(req.params.id, res);
  if (!c) return;
  if (c.advertiser_id === req.user.id) return res.status(400).json({ error: "You cannot apply to your own campaign" });
  if (!["PUBLISHED", "IN_PROGRESS"].includes(c.status)) return res.status(400).json({ error: "This campaign is not open for applications" });
  if (new Date(c.end_date) <= new Date()) return res.status(400).json({ error: "The application deadline for this campaign has passed" });
  if ((await acceptedAssignmentCount(c.id)) >= c.max_creators) return res.status(400).json({ error: "All creator slots are filled" });

  const already = await get("SELECT 1 FROM campaign_applications WHERE campaign_id = ? AND creator_id = ?", [c.id, req.user.id]);
  if (already) return res.status(409).json({ error: "You already applied to this campaign" });

  // Server-side eligibility check (§9) — evaluated entirely from the
  // creator's own VERIFIED, OAuth-connected social account data, never from
  // anything in this request body. A creator with no verified account for
  // this campaign's platform, or one that doesn't meet the advertiser's
  // stated minimums, cannot apply — this is enforced here, not just shown as
  // a UI hint.
  const eligibility = await socialAccountService.evaluateEligibility({ creatorId: req.user.id, campaign: c });
  if (!eligibility.eligible) return res.status(403).json({ error: "You don't meet this campaign's creator requirements", reasons: eligibility.reasons });

  if (req.body.socialAccountId) {
    const acct = await get("SELECT user_id FROM social_accounts WHERE id = ?", [req.body.socialAccountId]);
    if (!acct || acct.user_id !== req.user.id) return res.status(403).json({ error: "That social account doesn't belong to you" });
  }

  const id = newId("app");
  const ts = nowIso();
  await run(
    `INSERT INTO campaign_applications (id, campaign_id, creator_id, message, proposed_rate_cents, estimated_completion_days,
       relevant_experience, social_account_id, supporting_info, status, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
    [
      id, c.id, req.user.id, req.body.message, dollarsToCents(req.body.proposedRate), req.body.estimatedCompletionDays ?? null,
      req.body.relevantExperience ?? null, req.body.socialAccountId ?? null, req.body.supportingInfo ?? null, ts,
    ]
  );

  await notificationService.notify(c.advertiser_id, { icon: "application", title: "New application", body: `A creator applied to "${c.title}".` });
  await auditService.log({ actorId: req.user.id, actorRole: "CREATOR", action: "Applied to campaign", targetType: "Campaign", targetId: c.id, campaignId: c.id, details: c.title });
  res.status(201).json({ application: serializeApplication(await get("SELECT * FROM campaign_applications WHERE id = ?", [id])) });
}));

router.get("/:id/applications", requireAuth, asyncHandler(async (req, res) => {
  const c = await loadCampaignOr404(req.params.id, res);
  if (!c) return;
  if (c.advertiser_id !== req.user.id && req.user.role !== "ADMIN") return res.status(403).json({ error: "Not authorized" });
  const rows = await all("SELECT * FROM campaign_applications WHERE campaign_id = ? ORDER BY applied_at DESC", [c.id]);
  const withDetail = await Promise.all(rows.map(async (a) => {
    const profile = await get("SELECT display_name, username FROM profiles WHERE user_id = ?", [a.creator_id]);
    const assignment = await get("SELECT * FROM campaign_assignments WHERE application_id = ?", [a.id]);
    let deliverable = null;
    if (assignment) {
      const d = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
      if (d) deliverable = serializeDeliverable(d, await all("SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version_number DESC", [d.id]));
    }
    return { ...serializeApplication(a), creatorName: profile?.display_name || "Creator", creatorUsername: profile?.username, assignment: serializeAssignment(assignment), deliverable };
  }));
  res.json({ applications: withDetail });
}));

router.get("/mine/applications", requireAuth, requireRole("CREATOR"), asyncHandler(async (req, res) => {
  const rows = await all("SELECT * FROM campaign_applications WHERE creator_id = ? ORDER BY applied_at DESC", [req.user.id]);
  const withDetail = await Promise.all(rows.map(async (a) => {
    const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [a.campaign_id]);
    const assignment = await get("SELECT * FROM campaign_assignments WHERE application_id = ?", [a.id]);
    let deliverable = null;
    if (assignment) {
      const d = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
      if (d) deliverable = serializeDeliverable(d, await all("SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version_number DESC", [d.id]));
    }
    return { ...serializeApplication(a), campaign: serializeCampaign(campaign), assignment: serializeAssignment(assignment), deliverable };
  }));
  res.json({ applications: withDetail });
}));

router.post("/applications/:appId/decide", requireAuth, requireRole("ADVERTISER"), validate(z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]) })), async (req, res) => {
  try {
    const result = await transaction(async () => {
      const app = await get("SELECT * FROM campaign_applications WHERE id = ? FOR UPDATE", [req.params.appId]);
      if (!app) throw Object.assign(new Error("Application not found"), { status: 404 });
      const c = await get("SELECT * FROM campaigns WHERE id = ?", [app.campaign_id]);
      if (c.advertiser_id !== req.user.id) throw Object.assign(new Error("Not your campaign"), { status: 403 });
      if (app.status !== "PENDING") throw Object.assign(new Error("Application already decided"), { status: 400 });

      if (req.body.decision === "ACCEPTED") {
        if ((await acceptedAssignmentCount(c.id)) >= c.max_creators) throw Object.assign(new Error("All creator slots are already filled"), { status: 400 });
        // reserveForAssignment is itself transactional/row-locked and will join
        // this outer transaction; it throws (and this whole decide rolls back)
        // if escrow is insufficient.
        await paymentService.reserveForAssignment(c.id, app.proposed_rate_cents);

        const ts = nowIso();
        await run("UPDATE campaign_applications SET status='ACCEPTED', decided_at=? WHERE id=?", [ts, app.id]);
        const assignmentId = newId("asn");
        await run(
          `INSERT INTO campaign_assignments (id, campaign_id, application_id, creator_id, advertiser_id, agreed_rate_cents, status, started_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
          [assignmentId, c.id, app.id, app.creator_id, c.advertiser_id, app.proposed_rate_cents, ts, ts]
        );

        if (c.status === "PUBLISHED") await statusService.transitionCampaign(c.id, "IN_PROGRESS", { actorId: req.user.id, note: "First creator accepted" });
        await notificationService.notify(app.creator_id, { icon: "success", title: "Application accepted!", body: `You were accepted for "${c.title}". Submit your work once it's live.` });
      } else {
        await run("UPDATE campaign_applications SET status='REJECTED', decided_at=? WHERE id=?", [nowIso(), app.id]);
        await notificationService.notify(app.creator_id, { icon: "info", title: "Application update", body: `Your application for "${c.title}" was not selected.` });
      }
      await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: `Application ${req.body.decision.toLowerCase()}`, targetType: "Application", targetId: app.id, campaignId: c.id, details: c.title });
      return get("SELECT * FROM campaign_applications WHERE id = ?", [app.id]);
    });
    res.json({ application: serializeApplication(result) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to decide application" });
  }
});

router.post("/applications/:appId/request-info", requireAuth, requireRole("ADVERTISER"), validate(z.object({ note: z.string().min(1) })), asyncHandler(async (req, res) => {
  const app = await get("SELECT * FROM campaign_applications WHERE id = ?", [req.params.appId]);
  if (!app) return res.status(404).json({ error: "Application not found" });
  const c = await get("SELECT * FROM campaigns WHERE id = ?", [app.campaign_id]);
  if (c.advertiser_id !== req.user.id) return res.status(403).json({ error: "Not your campaign" });
  await run("UPDATE campaign_applications SET info_requested_at=?, info_requested_note=? WHERE id=?", [nowIso(), req.body.note, app.id]);
  await notificationService.notify(app.creator_id, { icon: "info", title: "More information requested", body: `${req.body.note.slice(0, 100)}` });
  res.json({ ok: true });
}));

router.post("/applications/:appId/withdraw", requireAuth, requireRole("CREATOR"), asyncHandler(async (req, res) => {
  const app = await get("SELECT * FROM campaign_applications WHERE id = ?", [req.params.appId]);
  if (!app) return res.status(404).json({ error: "Application not found" });
  if (app.creator_id !== req.user.id) return res.status(403).json({ error: "Not your application" });
  if (app.status !== "PENDING") return res.status(400).json({ error: "Only a pending application can be withdrawn" });
  await run("UPDATE campaign_applications SET status='WITHDRAWN', decided_at=? WHERE id=?", [nowIso(), app.id]);
  res.json({ ok: true });
}));

// "Cancel acceptance where permitted" — only before any deliverable has been submitted.
router.post("/assignments/:assignmentId/cancel", requireAuth, requireRole("ADVERTISER"), asyncHandler(async (req, res) => {
  const assignment = await get("SELECT * FROM campaign_assignments WHERE id = ?", [req.params.assignmentId]);
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  if (assignment.advertiser_id !== req.user.id) return res.status(403).json({ error: "Not your campaign" });
  if (assignment.status !== "ACTIVE") return res.status(400).json({ error: "This assignment is not active" });
  const deliverable = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
  if (deliverable) return res.status(400).json({ error: "Cannot cancel acceptance after work has been submitted — open a dispute instead" });

  const ts = nowIso();
  const c = await transaction(async () => {
    await run("UPDATE campaign_assignments SET status='CANCELLED', ended_at=? WHERE id=?", [ts, assignment.id]);
    await paymentService.cancelAssignmentReservation(assignment.campaign_id, assignment.agreed_rate_cents);
    const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [assignment.campaign_id]);
    if (campaign.status === "IN_PROGRESS" && (await acceptedAssignmentCount(campaign.id)) === 0) {
      await statusService.transitionCampaign(campaign.id, "PUBLISHED", { actorId: req.user.id, note: "Reopened after acceptance cancelled" });
    }
    return campaign;
  });
  await notificationService.notify(assignment.creator_id, { icon: "alert", title: "Acceptance cancelled", body: `Your acceptance for "${c.title}" was cancelled by the advertiser.` });
  await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Cancelled assignment acceptance", targetType: "Assignment", targetId: assignment.id, campaignId: c.id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Deliverables (proof of completion) — versioned
// ---------------------------------------------------------------------------
async function loadAssignment(id, res) {
  const a = await get("SELECT * FROM campaign_assignments WHERE id = ?", [id]);
  if (!a) { res.status(404).json({ error: "Assignment not found" }); return null; }
  return a;
}

const deliverableSchema = z.object({
  contentUrl: z.string().optional().nullable(),
  promotionUrl: z.string().optional().nullable(),
  screenshotUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  completionDate: z.string().optional().nullable(),
});

router.post("/assignments/:assignmentId/deliverables", requireAuth, requireRole("CREATOR"), validate(deliverableSchema), asyncHandler(async (req, res) => {
  const assignment = await loadAssignment(req.params.assignmentId, res);
  if (!assignment) return;
  if (assignment.creator_id !== req.user.id) return res.status(403).json({ error: "Not your assignment" });
  if (assignment.status !== "ACTIVE") return res.status(400).json({ error: "This assignment is not active" });

  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [assignment.campaign_id]);
  const ts = nowIso();
  let deliverable = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
  let versionNumber = 1;

  if (!deliverable) {
    const id = newId("dlv");
    await run(
      `INSERT INTO campaign_deliverables (id, assignment_id, status, current_version, review_note, created_at, updated_at)
       VALUES (?, ?, 'SUBMITTED', 1, NULL, ?, ?)`,
      [id, assignment.id, ts, ts]
    );
    deliverable = await get("SELECT * FROM campaign_deliverables WHERE id = ?", [id]);
  } else {
    versionNumber = deliverable.current_version + 1;
    await run("UPDATE campaign_deliverables SET status='SUBMITTED', current_version=?, review_note=NULL, updated_at=? WHERE id=?", [versionNumber, ts, deliverable.id]);
  }

  await run(
    `INSERT INTO deliverable_versions (id, deliverable_id, version_number, content_url, promotion_url, screenshot_url, notes, completion_date, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("dvv"), deliverable.id, versionNumber, req.body.contentUrl || null, req.body.promotionUrl || null, req.body.screenshotUrl || null, req.body.notes || null, req.body.completionDate || null, ts]
  );

  if (campaign.status === "IN_PROGRESS") await statusService.transitionCampaign(campaign.id, "SUBMITTED", { actorId: req.user.id, note: "Deliverable submitted" });

  await notificationService.notify(campaign.advertiser_id, { icon: "proof", title: "Deliverable submitted", body: `New submission for "${campaign.title}" (v${versionNumber}).` });
  await auditService.log({ actorId: req.user.id, actorRole: "CREATOR", action: `Submitted deliverable v${versionNumber}`, targetType: "Assignment", targetId: assignment.id, campaignId: campaign.id });

  const versions = await all("SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version_number DESC", [deliverable.id]);
  res.json({ deliverable: serializeDeliverable(await get("SELECT * FROM campaign_deliverables WHERE id = ?", [deliverable.id]), versions) });
}));

router.get("/assignments/:assignmentId/deliverables", requireAuth, asyncHandler(async (req, res) => {
  const assignment = await loadAssignment(req.params.assignmentId, res);
  if (!assignment) return;
  if (assignment.creator_id !== req.user.id && assignment.advertiser_id !== req.user.id && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Not authorized" });
  }
  const deliverable = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
  if (!deliverable) return res.json({ deliverable: null });
  const versions = await all("SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version_number DESC", [deliverable.id]);
  res.json({ deliverable: serializeDeliverable(deliverable, versions) });
}));

const reviewSchema = z.object({ decision: z.enum(["start_review", "approve", "revision", "reject", "dispute"]), note: z.string().optional().nullable() });

router.post("/assignments/:assignmentId/deliverables/review", requireAuth, requireRole("ADVERTISER"), validate(reviewSchema), async (req, res) => {
  try {
    const assignment = await get("SELECT * FROM campaign_assignments WHERE id = ?", [req.params.assignmentId]);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    if (assignment.advertiser_id !== req.user.id) return res.status(403).json({ error: "Not your campaign" });
    const deliverable = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
    if (!deliverable) return res.status(400).json({ error: "No deliverable has been submitted yet" });
    const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [assignment.campaign_id]);
    const ts = nowIso();

    if (req.body.decision === "start_review") {
      if (["SUBMITTED"].includes(campaign.status)) await statusService.transitionCampaign(campaign.id, "UNDER_REVIEW", { actorId: req.user.id, note: "Advertiser started review" });
      return res.json({ ok: true });
    }

    // Every other decision below mutates payment/status/deliverable state
    // together — wrapped so a failure partway through (e.g. an unexpected
    // status-transition error) can't leave the deliverable, assignment, and
    // campaign status inconsistent with each other.
    await transaction(async () => {
      if (req.body.decision === "approve") {
        const { netCents } = await paymentService.releaseAssignmentPayment({ assignment, campaign });
        await run("UPDATE campaign_deliverables SET status='APPROVED', updated_at=? WHERE id=?", [ts, deliverable.id]);
        await run("UPDATE campaign_assignments SET status='COMPLETED', ended_at=? WHERE id=?", [ts, assignment.id]);

        const remainingActive = await acceptedAssignmentCount(campaign.id);
        if (remainingActive === 0) await statusService.transitionCampaign(campaign.id, "COMPLETED", { actorId: req.user.id, note: "All assignments completed" });
        else if (["SUBMITTED", "UNDER_REVIEW"].includes(campaign.status)) await statusService.transitionCampaign(campaign.id, "IN_PROGRESS", { actorId: req.user.id, note: "Other creators still active" });

        await notificationService.notify(assignment.creator_id, { icon: "payment", title: "Payment released", body: `You received $${netCents.toFixed(2)} for "${campaign.title}".` });
        await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Approved deliverable & released payment", targetType: "Assignment", targetId: assignment.id, campaignId: campaign.id });
      } else if (req.body.decision === "revision") {
        await run("UPDATE campaign_deliverables SET status='REVISION_REQUESTED', review_note=?, updated_at=? WHERE id=?", [req.body.note || null, ts, deliverable.id]);
        if (["SUBMITTED", "UNDER_REVIEW"].includes(campaign.status)) await statusService.transitionCampaign(campaign.id, "IN_PROGRESS", { actorId: req.user.id, note: "Revision requested" });
        await notificationService.notify(assignment.creator_id, { icon: "alert", title: "Revision requested", body: `Changes were requested on "${campaign.title}".` });
        await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Requested revision", targetType: "Assignment", targetId: assignment.id, campaignId: campaign.id });
      } else if (req.body.decision === "reject") {
        await run("UPDATE campaign_deliverables SET status='REJECTED', review_note=?, updated_at=? WHERE id=?", [req.body.note || null, ts, deliverable.id]);
        await run("UPDATE campaign_assignments SET status='CANCELLED', ended_at=? WHERE id=?", [ts, assignment.id]);
        await paymentService.cancelAssignmentReservation(campaign.id, assignment.agreed_rate_cents);
        if ((await acceptedAssignmentCount(campaign.id)) === 0 && ["SUBMITTED", "UNDER_REVIEW"].includes(campaign.status)) {
          await statusService.transitionCampaign(campaign.id, "PUBLISHED", { actorId: req.user.id, note: "Reopened after rejection" });
        }
        await notificationService.notify(assignment.creator_id, { icon: "alert", title: "Deliverable rejected", body: `Your submission for "${campaign.title}" was rejected.` });
        await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Rejected deliverable", targetType: "Assignment", targetId: assignment.id, campaignId: campaign.id });
      } else if (req.body.decision === "dispute") {
        await run("UPDATE campaign_deliverables SET status='DISPUTED', updated_at=? WHERE id=?", [ts, deliverable.id]);
        await statusService.transitionCampaign(campaign.id, "DISPUTED", { actorId: req.user.id, note: req.body.note || "Advertiser opened a dispute" });
        const disputeId = newId("dsp");
        await run(
          `INSERT INTO disputes (id, campaign_id, application_id, raised_by_user_id, raised_by_role, reason, status, created_at)
           VALUES (?, ?, ?, ?, 'ADVERTISER', ?, 'OPEN', ?)`,
          [disputeId, campaign.id, assignment.application_id, req.user.id, req.body.note || "Submitted work does not meet campaign requirements.", ts]
        );
        await notificationService.notify(assignment.creator_id, { icon: "dispute", title: "Dispute opened", body: `A dispute was opened on "${campaign.title}".` });
        await auditService.log({ actorId: req.user.id, actorRole: "ADVERTISER", action: "Opened dispute", targetType: "Assignment", targetId: assignment.id, campaignId: campaign.id });
      }
    });

    const versions = await all("SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version_number DESC", [deliverable.id]);
    res.json({ deliverable: serializeDeliverable(await get("SELECT * FROM campaign_deliverables WHERE id = ?", [deliverable.id]), versions) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Failed to review deliverable" });
  }
});

router.post("/assignments/:assignmentId/dispute", requireAuth, requireRole("CREATOR"), validate(z.object({ reason: z.string().min(1) })), asyncHandler(async (req, res) => {
  const assignment = await loadAssignment(req.params.assignmentId, res);
  if (!assignment) return;
  if (assignment.creator_id !== req.user.id) return res.status(403).json({ error: "Not your assignment" });
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [assignment.campaign_id]);
  const ts = nowIso();

  const disputeId = newId("dsp");
  await run(
    `INSERT INTO disputes (id, campaign_id, application_id, raised_by_user_id, raised_by_role, reason, status, created_at)
     VALUES (?, ?, ?, ?, 'CREATOR', ?, 'OPEN', ?)`,
    [disputeId, campaign.id, assignment.application_id, req.user.id, req.body.reason, ts]
  );

  const deliverable = await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]);
  if (deliverable) await run("UPDATE campaign_deliverables SET status='DISPUTED', updated_at=? WHERE id=?", [ts, deliverable.id]);
  try { await statusService.transitionCampaign(campaign.id, "DISPUTED", { actorId: req.user.id, note: req.body.reason }); } catch (_) { /* already disputed/terminal */ }

  await notificationService.notify(campaign.advertiser_id, { icon: "dispute", title: "Dispute opened", body: `A creator opened a dispute on "${campaign.title}".` });
  await auditService.log({ actorId: req.user.id, actorRole: "CREATOR", action: "Opened dispute", targetType: "Assignment", targetId: assignment.id, campaignId: campaign.id });
  res.status(201).json({ disputeId });
}));

// ---------------------------------------------------------------------------
// Reviews & messages — keyed by application (relationship-level, not per-version)
// ---------------------------------------------------------------------------
const ratingSchema = z.object({ rating: z.number().int().min(1).max(5), text: z.string().optional().nullable() });

router.post("/applications/:appId/reviews", requireAuth, validate(ratingSchema), asyncHandler(async (req, res) => {
  const app = await get("SELECT * FROM campaign_applications WHERE id = ?", [req.params.appId]);
  if (!app) return res.status(404).json({ error: "Application not found" });
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [app.campaign_id]);
  const isAdvertiser = req.user.id === campaign.advertiser_id;
  const isCreator = req.user.id === app.creator_id;
  if (!isAdvertiser && !isCreator) return res.status(403).json({ error: "You weren't part of this collaboration" });

  const assignment = await get("SELECT * FROM campaign_assignments WHERE application_id = ?", [app.id]);
  const deliverable = assignment ? await get("SELECT * FROM campaign_deliverables WHERE assignment_id = ?", [assignment.id]) : null;
  if (!deliverable || deliverable.status !== "APPROVED") return res.status(400).json({ error: "Reviews can only be left after the deliverable is approved" });

  const toUserId = isAdvertiser ? app.creator_id : campaign.advertiser_id;
  const id = newId("rev");
  try {
    await run(
      `INSERT INTO reviews (id, campaign_id, application_id, from_user_id, to_user_id, rating, text, verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, campaign.id, app.id, req.user.id, toUserId, req.body.rating, req.body.text || null, nowIso()]
    );
  } catch (err) {
    // Postgres unique-violation error code (was a string match on "UNIQUE" under SQLite).
    if (err.code === "23505") return res.status(409).json({ error: "You've already reviewed this collaboration" });
    throw err;
  }
  const agg = await get("SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE to_user_id = ?", [toUserId]);
  await run("UPDATE profiles SET rating_avg = ?, rating_count = ? WHERE user_id = ?", [Math.round(Number(agg.avg) * 10) / 10, Number(agg.count), toUserId]);
  await notificationService.notify(toUserId, { icon: "star", title: "New review received", body: `You received a ${req.body.rating}-star review.` });
  res.status(201).json({ reviewId: id });
}));

router.get("/applications/:appId/reviews", requireAuth, asyncHandler(async (req, res) => {
  res.json({ reviews: await all("SELECT * FROM reviews WHERE application_id = ?", [req.params.appId]) });
}));

router.get("/applications/:appId/messages", requireAuth, asyncHandler(async (req, res) => {
  const app = await get("SELECT * FROM campaign_applications WHERE id = ?", [req.params.appId]);
  if (!app) return res.status(404).json({ error: "Application not found" });
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [app.campaign_id]);
  if (req.user.id !== app.creator_id && req.user.id !== campaign.advertiser_id && req.user.role !== "ADMIN") return res.status(403).json({ error: "Not authorized" });
  res.json({ messages: await all("SELECT * FROM messages WHERE application_id = ? ORDER BY created_at ASC", [app.id]) });
}));

router.post("/applications/:appId/messages", requireAuth, validate(z.object({ text: z.string().min(1).max(2000) })), asyncHandler(async (req, res) => {
  const app = await get("SELECT * FROM campaign_applications WHERE id = ?", [req.params.appId]);
  if (!app) return res.status(404).json({ error: "Application not found" });
  const campaign = await get("SELECT * FROM campaigns WHERE id = ?", [app.campaign_id]);
  if (req.user.id !== app.creator_id && req.user.id !== campaign.advertiser_id) return res.status(403).json({ error: "Not authorized" });

  const id = newId("msg");
  const ts = nowIso();
  await run("INSERT INTO messages (id, application_id, from_user_id, text, created_at) VALUES (?, ?, ?, ?, ?)", [id, app.id, req.user.id, req.body.text, ts]);
  const otherPartyId = req.user.id === app.creator_id ? campaign.advertiser_id : app.creator_id;
  await notificationService.notify(otherPartyId, { icon: "message", title: "New message", body: req.body.text.slice(0, 80) });
  res.status(201).json({ id, applicationId: app.id, fromUserId: req.user.id, text: req.body.text, createdAt: ts });
}));

module.exports = router;
