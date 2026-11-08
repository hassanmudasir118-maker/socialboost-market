const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const assistantService = require("../services/assistantService");

const router = express.Router();

router.get("/todo", requireAuth, requireRole("ADMIN"), asyncHandler(async (req, res) => {
  res.json({ items: await assistantService.buildTodo(), telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) });
}));

module.exports = router;
