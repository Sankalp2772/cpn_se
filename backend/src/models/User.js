const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password_hash: { type: String },
  academic_status: { type: String, required: true },
  city: { type: String, default: "" },
  goal: { type: String, default: "" },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('User', userSchema);
