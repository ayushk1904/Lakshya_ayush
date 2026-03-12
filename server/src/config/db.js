const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log("MONGODB_URI not set. Using mock-backed API responses.");
    return;
  }

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed. Falling back to mock responses.");
  }
}

module.exports = connectDB;
