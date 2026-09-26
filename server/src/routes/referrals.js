const express = require("express");
const { get } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/mine", requireAuth, asyncHandler(async (req, res) => {
  const profile = await get("SELECT referral_code FROM profiles WHERE user_id = ?", [req.user.id]);
  const countRow = await get("SELECT COUNT(*) as n FROM referrals WHERE referrer_user_id = ?", [req.user.id]);
  res.json({ code: profile?.referral_code || null, referredCount: Number(countRow.n) });
}));

module.exports = router;
