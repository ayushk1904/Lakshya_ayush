const bcrypt = require("bcryptjs");
const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { signToken } = require("../utils/auth");

const router = express.Router();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim();
}

async function findPasswordConflict(password) {
  const users = await User.find({}, { password: 1 }).lean();

  for (const user of users) {
    if (typeof user.password !== "string" || !user.password) {
      continue;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
      return true;
    }
  }

  return false;
}

function duplicateMessageForField(field) {
  if (field === "name") {
    return "Username is already taken";
  }

  if (field === "email") {
    return "Email is already taken";
  }

  return "A unique value is already taken";
}

function ensureDatabaseReady(res) {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  return false;
}

router.post("/register", async (req, res) => {
  const name = normalizeName(req.body.name);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const email = normalizeEmail(req.body.email);

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  if (!ensureDatabaseReady(res)) {
    return;
  }

  const existingUser = await User.findOne({
    $or: [{ name }, { email }]
  }).lean();

  if (existingUser) {
    if (existingUser.name === name) {
      return res.status(400).json({ message: "Username is already taken", field: "name" });
    }

    return res.status(400).json({ message: "Email is already taken", field: "email" });
  }

  const passwordTaken = await findPasswordConflict(password);
  if (passwordTaken) {
    return res.status(400).json({ message: "Password is already taken", field: "password" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: passwordHash });
    const token = signToken(user);
    return res.status(201).json({ token, user: { _id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    if (error && error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(400).json({ message: duplicateMessageForField(field), field });
    }

    throw error;
  }
});

router.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  if (!ensureDatabaseReady(res)) {
    return;
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const storedPassword = typeof user.password === "string" ? user.password : "";
  if (!storedPassword) {
    return res.status(401).json({ message: "This account cannot be used to login. Please register again." });
  }

  const isMatch = await bcrypt.compare(password, storedPassword);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = signToken(user);
  return res.json({ token, user: { _id: user._id, name: user.name, email: user.email } });
});

router.get("/me", authMiddleware, async (req, res) => {
  const user = req.user.toObject ? req.user.toObject() : req.user;
  delete user.password;
  res.json({ user });
});

module.exports = router;
