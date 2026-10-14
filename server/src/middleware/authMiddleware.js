const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "lakshya-dev-secret");

    if (mongoose.connection.readyState !== 1) {
      const isConnected = await connectDB();
      if (!isConnected || mongoose.connection.readyState !== 1) {
        return res.status(503).json({ message: "Database unavailable right now. Please try again shortly." });
      }
    }

    const user = await User.findById(payload.userId).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

module.exports = authMiddleware;
