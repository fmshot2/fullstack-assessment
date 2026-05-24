const { ADMIN_TOKEN } = require("../config/env");

function requireAdminToken(req, res, next) {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

module.exports = { requireAdminToken };