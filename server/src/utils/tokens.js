const crypto = require("crypto");

/** A raw random token to hand to the user (in a link/response), plus its hash to store. */
function generateToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

module.exports = { generateToken, hashToken };
