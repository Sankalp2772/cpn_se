const mongoose = require("mongoose");
require("dotenv").config();

async function connectDB() {
  try {
    const uri = process.env.MONGO_URI || "mongodb://localhost:27017/career_path_navigator";
    await mongoose.connect(uri);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

module.exports = connectDB;
