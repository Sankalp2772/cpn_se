const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "career_path_navigator",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const local = {
  ready: false,
  warned: false,
  users: [],
  roadmaps: [],
  careerOptions: []
};

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

function loadLocalData() {
  if (local.ready) return;

  const seedPath = path.join(__dirname, "../../database/seed.sql");
  const seed = fs.readFileSync(seedPath, "utf8");
  const match = seed.match(/INSERT INTO career_options[\s\S]*?VALUES\s*([\s\S]*);/i);
  if (!match) throw new Error("Could not load local career seed data");

  const rows = match[1].match(/\((?:[^']|'[^']*')*?\)/g) || [];
  local.careerOptions = rows.map((row) => {
    const values = splitSqlValues(row.slice(1, -1));
    return {
      id: values[0],
      parent_id: values[1],
      title: values[2],
      short_description: values[3],
      summary: values[4],
      duration: values[5],
      cost: values[6],
      difficulty: values[7],
      scope: values[8],
      eligibility: values[9],
      skills: values[10],
      opportunities: values[11],
      display_order: Number(values[12] || 0)
    };
  });

  local.ready = true;
}

function sortOptions(rows) {
  return [...rows].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.title.localeCompare(b.title);
  });
}

async function localQuery(sql, params = []) {
  loadLocalData();
  const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();

  if (normalized === "select 1") return [[{ "1": 1 }]];

  if (normalized.startsWith("select * from career_options where id = ?")) {
    return [[local.careerOptions.find((option) => option.id === params[0])].filter(Boolean)];
  }

  if (normalized.startsWith("select * from career_options where parent_id <=> ?")) {
    const parentId = params[0] || null;
    return [sortOptions(local.careerOptions.filter((option) => option.parent_id === parentId))];
  }

  if (normalized.startsWith("select * from career_options order by")) {
    return [sortOptions(local.careerOptions)];
  }

  if (normalized.startsWith("insert into users")) {
    const [name, email, passwordHash, academicStatus, city, goal] = params;
    if (local.users.some((user) => user.email === email)) {
      const error = new Error("Duplicate email");
      error.code = "ER_DUP_ENTRY";
      throw error;
    }

    const id = local.users.length + 1;
    local.users.push({
      id,
      name,
      email,
      password_hash: passwordHash,
      academic_status: academicStatus,
      city,
      goal,
      created_at: new Date()
    });
    return [{ insertId: id }];
  }

  if (normalized.startsWith("select * from users where email = ?")) {
    return [[local.users.find((user) => user.email === params[0])].filter(Boolean)];
  }

  if (normalized.startsWith("insert into roadmaps")) {
    const [userId, title, pathIds, finalOptionId] = params;
    const id = local.roadmaps.length + 1;
    local.roadmaps.push({
      id,
      user_id: userId,
      title,
      path_ids: pathIds,
      final_option_id: finalOptionId,
      created_at: new Date()
    });
    return [{ insertId: id }];
  }

  if (normalized.startsWith("select r.*, c.title as final_title from roadmaps")) {
    const userId = params[0];
    const rows = local.roadmaps
      .filter((roadmap) => roadmap.user_id === userId)
      .map((roadmap) => ({
        ...roadmap,
        final_title: local.careerOptions.find((option) => option.id === roadmap.final_option_id)?.title || ""
      }))
      .sort((a, b) => b.created_at - a.created_at);
    return [rows];
  }

  throw new Error(`Local database does not support query: ${sql}`);
}

module.exports = {
  async query(sql, params) {
    try {
      return await mysqlPool.query(sql, params);
    } catch (error) {
      if (!local.warned) {
        console.warn(`MySQL unavailable (${error.message}). Using local demo data instead.`);
        local.warned = true;
      }
      return localQuery(sql, params);
    }
  }
};
