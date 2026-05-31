const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const User = require('./src/models/User');
const connectDB = require('./src/db');

async function createAdmin() {
  await connectDB();
  
  const email = "admin@example.com";
  const name = "admin";
  const password = "admin@123";
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    let user = await User.findOne({ email });
    if (user) {
      user.name = name;
      user.password_hash = hashedPassword;
      user.role = 'admin';
      await user.save();
      console.log("Updated existing admin user.");
    } else {
      user = await User.create({
        name,
        email,
        password_hash: hashedPassword,
        academic_status: "Graduated", // or some default
        role: "admin"
      });
      console.log("Created new admin user.");
    }
  } catch (error) {
    console.error("Error creating admin:", error);
  } finally {
    process.exit(0);
  }
}

createAdmin();
