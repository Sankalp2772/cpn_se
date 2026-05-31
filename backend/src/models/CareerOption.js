const mongoose = require('mongoose');

const careerOptionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  parent_id: { type: String, ref: 'CareerOption', default: null },
  title: { type: String, required: true },
  short_description: { type: String },
  summary: { type: String },
  duration: { type: String },
  cost: { type: String },
  difficulty: { type: String },
  scope: { type: String },
  eligibility: { type: [String], default: [] },
  skills: { type: [String], default: [] },
  opportunities: { type: [String], default: [] },
  display_order: { type: Number, default: 0 }
});

module.exports = mongoose.model('CareerOption', careerOptionSchema);
