const mongoose = require('mongoose');

const roadmapSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  path_ids: { type: [String], required: true },
  final_option_id: { type: String, ref: 'CareerOption', required: true }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Roadmap', roadmapSchema);
