const bcrypt = require("bcryptjs");
const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { signToken } = require("../utils/auth");
const { mockUser } = require("../utils/mockData");

const router = express.Router();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

router.post("/register", async (req, res) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  if (mongoose.connection.readyState !== 1) {
    mockUser.name = name;
    mockUser.email = email;
    mockUser.password = await bcrypt.hash(password, 10);
    const token = signToken(mockUser);
    return res.status(201).json({ token, user: { _id: mockUser._id, name, email } });
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ message: "User already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: passwordHash });
  const token = signToken(user);
  return res.status(201).json({ token, user: { _id: user._id, name: user.name, email: user.email } });
});

router.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  if (mongoose.connection.readyState !== 1) {
    const mockPassword = typeof mockUser.password === "string" ? mockUser.password : "";
    const isMatch = mockPassword ? await bcrypt.compare(password, mockPassword) : false;
    if (email !== mockUser.email || !isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = signToken(mockUser);
    return res.json({ token, user: { _id: mockUser._id, name: mockUser.name, email: mockUser.email } });
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
