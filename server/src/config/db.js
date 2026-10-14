const mongoose = require("mongoose");

let connectionPromise = null;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn("MONGODB_URI not set. MongoDB-backed features will be unavailable.");
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (mongoose.connection.readyState === 2 && connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10000
    })
    .then(() => {
      console.log("MongoDB connected");
      return true;
    })
    .catch((error) => {
      console.error("MongoDB connection failed.", error.message);
      return false;
    })
    .finally(() => {
      connectionPromise = null;
    });

  return connectionPromise;
}

module.exports = connectDB;
