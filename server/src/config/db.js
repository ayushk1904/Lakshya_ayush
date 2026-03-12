const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn("MONGODB_URI not set. MongoDB-backed features will be unavailable.");
    return false;
  }

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
    return true;
  } catch (error) {
    console.error("MongoDB connection failed.", error.message);
    return false;
  }
}

module.exports = connectDB;
