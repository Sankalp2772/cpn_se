const mongoose = require("mongoose");
require("dotenv").config();

let isConnected = false;

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.log("[DB] No MONGO_URI provided. Running with high-performance in-memory database store.");
    return false;
  }

  try {
    mongoose.set("bufferCommands", false);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000
    });
    isConnected = true;
    console.log("[DB] MongoDB connected successfully.");
    return true;
  } catch (error) {
    console.warn(`[DB] MongoDB connection failed (${error.message}). Falling back to in-memory store.`);
    isConnected = false;
    return false;
  }
}

function getIsConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = connectDB;
module.exports.getIsConnected = getIsConnected;
