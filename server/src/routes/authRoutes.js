const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { signToken } = require("../utils/auth");
const { sendOtpEmail } = require("../utils/mailer");

const router = express.Router();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim();
}

function isGmailAddress(email) {
  return /^[a-z0-9._%+-]+@gmail\.com$/i.test(email);
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
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

async function ensureDatabaseReady(res) {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  const isConnected = await connectDB();
  if (isConnected && mongoose.connection.readyState === 1) {
    return true;
  }

  res.status(503).json({ message: "Database unavailable right now. Please try again shortly." });
  return false;
}

router.post("/register", async (req, res) => {
  const name = normalizeName(req.body.name);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const email = normalizeEmail(req.body.email);

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  if (!isGmailAddress(email)) {
    return res.status(400).json({ message: "Please use a valid Gmail address", field: "email" });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters long", field: "password" });
  }

  if (!(await ensureDatabaseReady(res))) {
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

  if (!isGmailAddress(email)) {
    return res.status(400).json({ message: "Please use your registered Gmail address" });
  }

  if (!(await ensureDatabaseReady(res))) {
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

router.post("/forgot-password/request-otp", async (req, res) => {
  const email = normalizeEmail(req.body.email);

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  if (!isGmailAddress(email)) {
    return res.status(400).json({ message: "Please enter a valid Gmail address" });
  }

  if (!(await ensureDatabaseReady(res))) {
    return;
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ message: "No Lakshya account found for this Gmail address" });
  }

  const now = Date.now();
  if (user.resetOtpSentAt && now - new Date(user.resetOtpSentAt).getTime() < 60 * 1000) {
    return res.status(429).json({ message: "Please wait 1 minute before requesting another OTP" });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  user.resetOtpHash = hashOtp(otp);
  user.resetOtpExpiresAt = new Date(now + 10 * 60 * 1000);
  user.resetOtpSentAt = new Date(now);

  try {
    await user.save();
    await sendOtpEmail({
      to: user.email,
      name: user.name,
      otp
    });
  } catch (error) {
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    user.resetOtpSentAt = null;
    await user.save();
    return res.status(500).json({ message: error.message || "Unable to send OTP email right now" });
  }

  return res.json({ message: "OTP sent to your Gmail account" });
});

router.post("/forgot-password/reset", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || "").trim();
  const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword : "";

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: "Email, OTP, and new password are required" });
  }

  if (!isGmailAddress(email)) {
    return res.status(400).json({ message: "Please enter a valid Gmail address" });
  }

  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: "OTP must be a 6 digit code" });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters long" });
  }

  if (!(await ensureDatabaseReady(res))) {
    return;
  }

  const user = await User.findOne({ email });
  if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt) {
    return res.status(400).json({ message: "OTP verification is not active for this account" });
  }

  if (new Date(user.resetOtpExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ message: "OTP has expired. Request a new code." });
  }

  if (hashOtp(otp) !== user.resetOtpHash) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetOtpHash = null;
  user.resetOtpExpiresAt = null;
  user.resetOtpSentAt = null;
  await user.save();

  const token = signToken(user);
  return res.json({
    message: "Password reset successful",
    token,
    user: { _id: user._id, name: user.name, email: user.email }
  });
});

router.get("/me", authMiddleware, async (req, res) => {
  const user = req.user.toObject ? req.user.toObject() : req.user;
  delete user.password;
  delete user.resetOtpHash;
  delete user.resetOtpExpiresAt;
  delete user.resetOtpSentAt;
  res.json({ user });
});

router.put("/profile", authMiddleware, async (req, res) => {
  const name = normalizeName(req.body.name);
  const email = normalizeEmail(req.body.email);

  if (!name || !email) {
    return res.status(400).json({ message: "Name and email are required" });
  }

  if (!isGmailAddress(email)) {
    return res.status(400).json({ message: "Please use a valid Gmail address", field: "email" });
  }

  if (!(await ensureDatabaseReady(res))) {
    return;
  }

  const duplicateUser = await User.findOne({
    _id: { $ne: req.user._id },
    $or: [{ name }, { email }]
  }).lean();

  if (duplicateUser) {
    if (duplicateUser.name === name) {
      return res.status(400).json({ message: "Username is already taken", field: "name" });
    }

    return res.status(400).json({ message: "Email is already taken", field: "email" });
  }

  try {
    req.user.name = name;
    req.user.email = email;
    await req.user.save();

    const token = signToken(req.user);
    return res.json({
      message: "Profile updated successfully",
      token,
      user: { _id: req.user._id, name: req.user.name, email: req.user.email }
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(400).json({ message: duplicateMessageForField(field), field });
    }

    throw error;
  }
});

module.exports = router;
