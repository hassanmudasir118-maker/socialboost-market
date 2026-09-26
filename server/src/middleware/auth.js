const jwt = require("jsonwebtoken");
const { get } = require("../db");

/**
 * Verifies the JWT, then re-reads the user's role/suspension straight from the
 * database on every request. The token only ever carries a user id — never a
 * role or balance — precisely so a tampered or stale client claim can't grant
 * privileges. This is the "never trust the client" boundary for the whole API.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const user = await get("SELECT id, email, role, suspended FROM users WHERE id = ?", [payload.sub]);
    if (!user) return res.status(401).json({ error: "User no longer exists" });
    if (user.suspended) return res.status(403).json({ error: "Account suspended" });

    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
