const express = require("express");
const { requireAuth } = require("../middleware/auth");
const notificationService = require("../services/notificationService");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", requireAuth, asyncHandler(async (req, res) => {
  res.json({ notifications: await notificationService.listForUser(req.user.id) });
}));

router.post("/read", requireAuth, asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
