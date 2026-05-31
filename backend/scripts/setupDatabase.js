const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, '../.env') });
const CareerOption = require("../src/models/CareerOption");

function splitSqlValues(row) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    const next = row[index + 1];

    if (char === "'" && next === "'") {
      current += "'";
      index += 1;
      continue;
    }

    if (char === "'") {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => (value.toUpperCase() === "NULL" ? null : value));
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function seedDatabase() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error("MONGO_URI not found in .env");

    console.log("Connecting to MongoDB...");
    await mongoose.connect(uri);
    console.log("Connected.");

    const seedPath = path.join(__dirname, "../../database/seed.sql");
    const seed = fs.readFileSync(seedPath, "utf8");
    const match = seed.match(/INSERT INTO career_options[\s\S]*?VALUES\s*([\s\S]*);/i);
    if (!match) throw new Error("Could not find INSERT INTO career_options in seed.sql");

    const rows = match[1].match(/\((?:[^']|'[^']*')*?\)/g) || [];
    const careerOptions = rows.map((row) => {
      const values = splitSqlValues(row.slice(1, -1));
      return {
        _id: values[0],
        parent_id: values[1],
        title: values[2],
        short_description: values[3],
        summary: values[4],
        duration: values[5],
        cost: values[6],
        difficulty: values[7],
        scope: values[8],
        eligibility: parseJson(values[9], []),
        skills: parseJson(values[10], []),
        opportunities: parseJson(values[11], []),
        display_order: Number(values[12] || 0)
      };
    });

    console.log(`Found ${careerOptions.length} career options to insert.`);
    
    // Clear existing to avoid duplicate key errors on rerun
    await CareerOption.deleteMany({});
    
    await CareerOption.insertMany(careerOptions);
    console.log("Successfully seeded MongoDB database!");
  } catch (error) {
    console.error("Error seeding database:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

seedDatabase();
