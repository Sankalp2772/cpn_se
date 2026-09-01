const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const connectDB = require("./src/db");
const { getIsConnected } = require("./src/db");
const careerOptionsData = require("./src/careerData");
const User = require("./src/models/User");
const CareerOption = require("./src/models/CareerOption");
const Roadmap = require("./src/models/Roadmap");
const { createToken, authRequired, isAdmin } = require("./src/auth");

const app = express();
const PORT = process.env.PORT || 3000;
const frontendPath = path.join(__dirname, "../frontend");

// In-Memory Data Store (Active when MongoDB is not connected or as local cache)
const inMemoryStore = {
  users: [],
  careerOptions: [...careerOptionsData],
  roadmaps: []
};

// Seed default users in in-memory store
(async () => {
  const defaultAdminHash = await bcrypt.hash("admin@123", 10);
  const defaultUserHash = await bcrypt.hash("test1234", 10);
  
  inMemoryStore.users.push({
    _id: "admin-user-id",
    name: "Admin User",
    email: "admin@example.com",
    password_hash: defaultAdminHash,
    academic_status: "after-graduation",
    city: "Bangalore",
    goal: "System Administrator",
    role: "admin",
    created_at: new Date()
  });

  inMemoryStore.users.push({
    _id: "test-user-id",
    name: "Test User",
    email: "copilot_test_user@example.com",
    password_hash: defaultUserHash,
    academic_status: "after-10th",
    city: "Hubballi",
    goal: "Interested in technology",
    role: "user",
    created_at: new Date()
  });

  // Pre-seed sample roadmap
  inMemoryStore.roadmaps.push({
    _id: "sample-roadmap-1",
    user_id: "test-user-id",
    title: "After 10th Grade -> Science Stream (PCM / PCB) -> Computer Science & Engineering (CSE) -> AI & Machine Learning Engineering",
    path_ids: ["after-10th", "science-stream", "engineering-and-technology", "cse", "ai-ml-engineering"],
    final_option_id: "ai-ml-engineering",
    created_at: new Date()
  });
})();

// Initialize Database connection and auto-seed if connected
(async () => {
  const dbConnected = await connectDB();
  if (dbConnected) {
    try {
      const count = await CareerOption.countDocuments();
      if (count === 0) {
        console.log(`[DB] Seeding ${careerOptionsData.length} career options into MongoDB...`);
        await CareerOption.insertMany(careerOptionsData);
        console.log("[DB] MongoDB seed complete.");
      }

      // Check admin user
      const adminExists = await User.findOne({ email: "admin@example.com" });
      if (!adminExists) {
        const hashedPassword = await bcrypt.hash("admin@123", 10);
        await User.create({
          name: "Admin User",
          email: "admin@example.com",
          password_hash: hashedPassword,
          academic_status: "after-graduation",
          role: "admin"
        });
        console.log("[DB] Default admin user seeded.");
      }
    } catch (err) {
      console.warn("[DB] Error during initial MongoDB sync:", err.message);
    }
  }
})();

// Gemini SDK initialization
let genAI = null;
try {
  const { GoogleGenAI } = require("@google/genai");
  if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    if (process.env.GEMINI_API_KEY) {
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
  } catch (err) {
    console.warn("Gemini SDK not loaded:", err.message);
  }
}

app.use(cors());
app.use(express.json({
  limit: "1mb",
  verify(req, res, buf) {
    req.rawBody = buf.toString();
  }
}));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ message: "Invalid JSON payload" });
  }
  next(err);
});

app.use(express.static(frontendPath));

function optionRow(row) {
  if (!row) return null;
  return {
    id: row._id || row.id,
    parentId: row.parent_id || row.parentId || null,
    title: row.title || "",
    short: row.short_description || row.short || "",
    summary: row.summary || "",
    duration: row.duration || "N/A",
    cost: row.cost || "N/A",
    difficulty: row.difficulty || "N/A",
    scope: row.scope || "N/A",
    eligibility: row.eligibility || [],
    skills: row.skills || [],
    opportunities: row.opportunities || []
  };
}

// Data Access Layer Helpers
async function getOption(id) {
  if (getIsConnected()) {
    try {
      const row = await CareerOption.findById(id).lean();
      if (row) return optionRow(row);
    } catch (e) {}
  }
  const found = inMemoryStore.careerOptions.find((o) => (o._id || o.id) === id);
  return optionRow(found);
}

async function getChildren(parentId) {
  if (getIsConnected()) {
    try {
      const rows = await CareerOption.find({ parent_id: parentId || null })
        .sort({ display_order: 1, title: 1 })
        .lean();
      if (rows && rows.length > 0) {
        return rows.map(optionRow);
      }
    } catch (e) {}
  }
  const targetParent = parentId || null;
  const filtered = inMemoryStore.careerOptions.filter(
    (o) => (o.parent_id || o.parentId || null) === targetParent
  );
  filtered.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
  return filtered.map(optionRow);
}

async function getAllOptions() {
  if (getIsConnected()) {
    try {
      const rows = await CareerOption.find().sort({ display_order: 1, title: 1 }).lean();
      if (rows && rows.length > 0) return rows.map(optionRow);
    } catch (e) {}
  }
  return inMemoryStore.careerOptions.map(optionRow);
}

const recommendationAliases = [
  { id: "data-science", aliases: ["data science", "datascience", "data scientist", "data analyst", "analytics", "machine learning", "ml"] },
  { id: "cybersecurity", aliases: ["cybersecurity", "cyber security", "ethical hacking", "hacking", "security analyst", "network security"] },
  { id: "full-stack", aliases: ["full stack", "fullstack", "web development", "web developer", "mern", "frontend", "backend"] },
  { id: "cloud-devops", aliases: ["cloud", "devops", "aws", "azure", "deployment", "sre", "site reliability"] },
  { id: "mobile-development", aliases: ["mobile app", "app development", "android", "ios", "flutter", "react native"] },
  { id: "ai-ml-engineering", aliases: ["artificial intelligence", "ai ml", "ai engineer", "ai/ml", "deep learning", "nlp", "computer vision", "machine learning engineer"] },
  { id: "cse", aliases: ["computer science", "cse", "software engineering", "software developer", "coding", "programming", "b.tech cse"] },
  { id: "chartered-accountancy", aliases: ["ca", "chartered accountant", "chartered accountancy", "accounting", "auditing", "tax"] },
  { id: "mbbs-doctor", aliases: ["mbbs", "doctor", "medical", "medicine", "physician", "surgeon"] },
  { id: "civil-services-upsc", aliases: ["upsc", "ias", "civil services", "ips", "government job", "collector"] },
  { id: "mba-management", aliases: ["mba", "management", "business administration", "consulting", "cat exam"] }
];

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#. ]/g, " ");
}

function findAliasMatch(question) {
  const lower = normalizedText(question);
  return recommendationAliases
    .flatMap((item) => item.aliases.map((alias) => ({ id: item.id, alias })))
    .filter((item) => lower.includes(item.alias))
    .sort((a, b) => b.alias.length - a.alias.length)[0];
}

function optionSearchText(option) {
  return normalizedText([
    option.id, option.title, option.short, option.summary, option.scope,
    option.duration, option.cost, option.difficulty,
    ...option.eligibility, ...option.skills, ...option.opportunities
  ].join(" "));
}

function scoreOption(option, question) {
  const terms = normalizedText(question).split(/\s+/).filter((term) => term.length > 2);
  if (!terms.length) return 0;
  const text = optionSearchText(option);
  const title = normalizedText(option.title);
  return terms.reduce((score, term) => {
    if (title.includes(term)) return score + 5;
    if (text.includes(term)) return score + 2;
    return score;
  }, 0);
}

function buildPath(option, byId) {
  const pathItems = [];
  let current = option;
  while (current) {
    pathItems.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return pathItems;
}

function formatPath(pathItems) {
  return pathItems.map((item) => item.title).join(" -> ");
}

// ─── API ROUTES ───

app.get("/api/health", async (_req, res) => {
  const dbConnected = getIsConnected();
  res.json({
    status: "ok",
    database: dbConnected ? "connected" : "in-memory",
    careerOptionsCount: inMemoryStore.careerOptions.length
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, academicStatus, city, goal } = req.body;
    if (!name || !email || !password || !academicStatus) {
      return res.status(400).json({ message: "Name, email, password and academic status are required" });
    }

    const emailNormalized = email.toLowerCase().trim();

    if (getIsConnected()) {
      try {
        const existingUser = await User.findOne({ email: emailNormalized });
        if (existingUser) {
          return res.status(409).json({ message: "Email already registered. Please login." });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await User.create({
          name,
          email: emailNormalized,
          password_hash: hashedPassword,
          academic_status: academicStatus,
          city: city || "",
          goal: goal || "",
          role: "user"
        });
        const user = { id: String(result._id), name, email: emailNormalized, academicStatus, city, goal, role: "user" };
        return res.status(201).json({ user, token: createToken(user) });
      } catch (e) {
        console.warn("DB Register error, falling back to memory:", e.message);
      }
    }

    // In-memory register
    const existingInMemory = inMemoryStore.users.find((u) => u.email.toLowerCase() === emailNormalized);
    if (existingInMemory) {
      return res.status(409).json({ message: "Email already registered. Please login." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      _id: "user-" + Date.now(),
      name,
      email: emailNormalized,
      password_hash: hashedPassword,
      academic_status: academicStatus,
      city: city || "",
      goal: goal || "",
      role: "user",
      created_at: new Date()
    };
    inMemoryStore.users.push(newUser);

    const user = {
      id: newUser._id,
      name,
      email: emailNormalized,
      academicStatus,
      city: city || "",
      goal: goal || "",
      role: "user"
    };
    res.status(201).json({ user, token: createToken(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    const emailNormalized = email.toLowerCase().trim();

    let userRow = null;

    if (getIsConnected()) {
      try {
        userRow = await User.findOne({ email: emailNormalized }).lean();
      } catch (e) {}
    }

    if (!userRow) {
      userRow = inMemoryStore.users.find((u) => u.email.toLowerCase() === emailNormalized);
    }

    const passwordMatches = userRow && (
      (userRow.password_hash && await bcrypt.compare(password, userRow.password_hash)) ||
      (!userRow.password_hash && userRow.password && password === userRow.password)
    );

    if (!userRow || !passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = {
      id: String(userRow._id),
      name: userRow.name,
      email: userRow.email,
      academicStatus: userRow.academic_status || userRow.academic_stage,
      city: userRow.city || "",
      goal: userRow.goal || "",
      role: userRow.role || "user"
    };

    res.json({ user, token: createToken(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/career/stages", async (_req, res) => {
  const stages = await getChildren(null);
  res.json(stages);
});

app.get("/api/career/options", async (req, res) => {
  const options = await getChildren(req.query.parentId || null);
  res.json(options);
});

app.get("/api/career/options/:id", async (req, res) => {
  const option = await getOption(req.params.id);
  if (!option) return res.status(404).json({ message: "Career option not found" });
  const children = await getChildren(req.params.id);
  res.json({ ...option, children });
});

app.get("/api/career/tree/:rootId", async (req, res) => {
  const all = await getAllOptions();
  const byParent = new Map();
  all.forEach((item) => {
    const key = item.parentId || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  });

  function build(id) {
    const node = all.find((item) => item.id === id);
    if (!node) return null;
    return {
      ...node,
      children: (byParent.get(id) || []).map((child) => build(child.id)).filter(Boolean)
    };
  }

  const tree = build(req.params.rootId);
  if (!tree) return res.status(404).json({ message: "Root option not found" });
  res.json(tree);
});

app.post("/api/roadmaps", authRequired, async (req, res) => {
  try {
    const { title, pathIds, finalOptionId } = req.body;
    if (!Array.isArray(pathIds) || !finalOptionId) {
      return res.status(400).json({ message: "pathIds and finalOptionId are required" });
    }

    const finalOption = await getOption(finalOptionId);
    if (!finalOption) return res.status(404).json({ message: "Final option not found" });

    const roadmapTitle = title || pathIds.join(" -> ");
    const userId = req.user.id;

    if (getIsConnected()) {
      try {
        const result = await Roadmap.create({
          user_id: userId,
          title: roadmapTitle,
          path_ids: pathIds,
          final_option_id: finalOptionId
        });
        return res.status(201).json({ id: result._id, title: roadmapTitle, pathIds, finalOption });
      } catch (e) {
        console.warn("DB Roadmap save error, saving to memory:", e.message);
      }
    }

    const newRoadmap = {
      _id: "roadmap-" + Date.now(),
      user_id: userId,
      title: roadmapTitle,
      path_ids: pathIds,
      final_option_id: finalOptionId,
      created_at: new Date()
    };
    inMemoryStore.roadmaps.push(newRoadmap);

    res.status(201).json({ id: newRoadmap._id, title: roadmapTitle, pathIds, finalOption });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/roadmaps", authRequired, async (req, res) => {
  try {
    const userId = String(req.user.id);
    let items = [];

    if (getIsConnected()) {
      try {
        const rows = await Roadmap.find({ user_id: userId })
          .populate("final_option_id", "title")
          .sort({ created_at: -1 })
          .lean();
        if (rows && rows.length > 0) {
          return res.json(rows.map((row) => ({
            id: row._id,
            title: row.title,
            pathIds: row.path_ids,
            finalOptionId: row.final_option_id?._id || row.final_option_id,
            finalTitle: row.final_option_id?.title || "",
            createdAt: row.created_at
          })));
        }
      } catch (e) {}
    }

    items = inMemoryStore.roadmaps.filter((r) => String(r.user_id) === userId);
    const options = await getAllOptions();
    const byId = new Map(options.map((o) => [o.id, o]));

    res.json(items.map((row) => ({
      id: row._id,
      title: row.title,
      pathIds: row.path_ids,
      finalOptionId: row.final_option_id,
      finalTitle: byId.get(row.final_option_id)?.title || row.final_option_id,
      createdAt: row.created_at
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── ADMIN ROUTES ───

app.get("/api/admin/users", authRequired, isAdmin, async (req, res) => {
  try {
    if (getIsConnected()) {
      try {
        const users = await User.find({}, "-password -password_hash").sort({ created_at: -1 }).lean();
        if (users && users.length > 0) return res.json(users);
      } catch (e) {}
    }

    const safeUsers = inMemoryStore.users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      academic_status: u.academic_status,
      city: u.city || "",
      goal: u.goal || "",
      role: u.role || "user",
      created_at: u.created_at
    }));
    res.json(safeUsers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/admin/users", authRequired, isAdmin, async (req, res) => {
  try {
    const { name, email, password, academicStatus, city, goal, role } = req.body;
    if (!name || !email || !password || !academicStatus) {
      return res.status(400).json({ message: "Name, email, password and academic status are required" });
    }
    const emailNormalized = email.toLowerCase().trim();

    if (getIsConnected()) {
      try {
        const existingUser = await User.findOne({ email: emailNormalized });
        if (existingUser) return res.status(409).json({ message: "Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await User.create({
          name,
          email: emailNormalized,
          password_hash: hashedPassword,
          academic_status: academicStatus,
          city: city || "",
          goal: goal || "",
          role: role || "user"
        });
        return res.status(201).json({
          _id: result._id,
          name: result.name,
          email: result.email,
          role: result.role,
          academic_status: result.academic_status,
          city: result.city,
          goal: result.goal
        });
      } catch (e) {}
    }

    const existingInMemory = inMemoryStore.users.find((u) => u.email.toLowerCase() === emailNormalized);
    if (existingInMemory) return res.status(409).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      _id: "user-" + Date.now(),
      name,
      email: emailNormalized,
      password_hash: hashedPassword,
      academic_status: academicStatus,
      city: city || "",
      goal: goal || "",
      role: role || "user",
      created_at: new Date()
    };
    inMemoryStore.users.unshift(newUser);

    res.status(201).json({
      _id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      academic_status: newUser.academic_status,
      city: newUser.city,
      goal: newUser.goal
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/api/admin/users/:id", authRequired, isAdmin, async (req, res) => {
  try {
    const { name, email, password, academicStatus, city, goal, role } = req.body;
    const userId = req.params.id;

    if (getIsConnected()) {
      try {
        const updateData = { name, email, academic_status: academicStatus, city, goal, role };
        if (password) {
          updateData.password_hash = await bcrypt.hash(password, 10);
        }
        const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true })
          .select("-password -password_hash")
          .lean();
        if (updatedUser) return res.json(updatedUser);
      } catch (e) {}
    }

    const user = inMemoryStore.users.find((u) => u._id === userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase().trim();
    if (academicStatus) user.academic_status = academicStatus;
    if (city !== undefined) user.city = city;
    if (goal !== undefined) user.goal = goal;
    if (role) user.role = role;
    if (password) user.password_hash = await bcrypt.hash(password, 10);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      academic_status: user.academic_status,
      city: user.city,
      goal: user.goal,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/admin/users/:id", authRequired, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    if (getIsConnected()) {
      try {
        const deletedUser = await User.findByIdAndDelete(userId);
        if (deletedUser) return res.json({ message: "User deleted successfully" });
      } catch (e) {}
    }

    const idx = inMemoryStore.users.findIndex((u) => u._id === userId);
    if (idx === -1) return res.status(404).json({ message: "User not found" });
    inMemoryStore.users.splice(idx, 1);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── COMPARE ROUTE ───

app.post("/api/compare", async (req, res) => {
  const { optionA, optionB } = req.body;
  const a = await getOption(optionA);
  const b = await getOption(optionB);
  if (!a || !b) return res.status(404).json({ message: "Both career options are required" });
  res.json({
    a,
    b,
    factors: [
      { label: "Duration", a: a.duration, b: b.duration },
      { label: "Cost", a: a.cost, b: b.cost },
      { label: "Difficulty", a: a.difficulty, b: b.difficulty },
      { label: "Scope", a: a.scope, b: b.scope },
      { label: "Skills", a: a.skills.join(", "), b: b.skills.join(", ") },
      { label: "Opportunities", a: a.opportunities.join(", "), b: b.opportunities.join(", ") }
    ]
  });
});

// ─── CHATBOT ROUTE ───

app.post("/api/chatbot", async (req, res) => {
  try {
    const { question: questionRaw, currentOptionId } = req.body;
    const question = String(questionRaw || "").trim();

    let user = null;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      try {
        user = jwt.verify(token, process.env.JWT_SECRET || "career_path_navigator_secret_key");
        const userRow = inMemoryStore.users.find((u) => u._id === user.id) || 
          (getIsConnected() ? await User.findById(user.id).lean() : null);
        if (userRow) {
          user = { ...user, goal: userRow.goal, academicStatus: userRow.academic_status || userRow.academicStatus };
        }
      } catch (e) {}
    }

    if (!question) {
      return res.json({
        answer: "Hi! I'm your Career AI Assistant. How can I help you today? You can ask about roadmaps, specific careers, or comparison between paths."
      });
    }

    const options = await getAllOptions();
    const byId = new Map(options.map((option) => [option.id, option]));

    const scored = options
      .map((option) => ({ option, score: scoreOption(option, question) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.option);

    const topMatches = scored.slice(0, 3);
    const aliasMatch = findAliasMatch(question);
    const match = aliasMatch ? byId.get(aliasMatch.id) : (topMatches[0] || null);

    let dbContext = "";
    if (topMatches.length > 0) {
      dbContext = "DATABASE MATCHES FOUND (Use this data to answer):\n\n" + topMatches.map((m) => {
        const pathItems = buildPath(m, byId);
        return `Career: ${m.title}\nSummary: ${m.summary}\nPath: ${formatPath(pathItems)}\nSkills: ${m.skills.join(", ")}\nOpportunities: ${m.opportunities.join(", ")}\nScope: ${m.scope}`;
      }).join("\n\n---\n\n");
    } else {
      dbContext = "AVAILABLE CAREER OPTIONS IN DATABASE:\n" + options.map((o) => o.title).join(", ");
    }

    // Auto-save roadmap recommendation if user is authenticated
    if (match && user) {
      try {
        const pathIds = buildPath(match, byId).map((i) => i.id);
        const roadmapTitle = pathIds.join(" -> ");
        const existing = inMemoryStore.roadmaps.find((r) => String(r.user_id) === String(user.id) && r.final_option_id === match.id);
        if (!existing) {
          inMemoryStore.roadmaps.push({
            _id: "auto-roadmap-" + Date.now(),
            user_id: user.id,
            title: roadmapTitle,
            path_ids: pathIds,
            final_option_id: match.id,
            created_at: new Date()
          });
        }
      } catch (err) {
        console.warn("Auto-save roadmap in memory skipped:", err.message);
      }
    }

    const systemPrompt = `You are the "Career Path Navigator AI", an expert career counselor and educational guide.

${user ? `USER PROFILE:
- Name: ${user.name}
- Goal: ${user.goal}
- Academic Status: ${user.academicStatus}` : "USER PROFILE: Guest (Exploring options)"}

AVAILABLE DATABASE CONTEXT:
${dbContext || "No direct database match found."}

YOUR INSTRUCTIONS:
1. Answer directly using clear, actionable career guidance.
2. Incorporate specific details from DATABASE MATCHES.
3. Be encouraging, professional, and structured.
4. Use markdown formatting with bullet points and bold highlights.
5. If general, give a step-by-step roadmap.
6. Reply politely to greetings.
7. Keep it concise and practical (150-300 words).

User Question: ${question}`;

    let aiAnswer = "";

    // Attempt Gemini call
    if (genAI && process.env.GEMINI_API_KEY) {
      try {
        if (typeof genAI.models?.generateContent === "function") {
          const result = await genAI.models.generateContent({
            model: "gemini-2.5-flash",
            contents: systemPrompt
          });
          aiAnswer = result.text || result.candidates?.[0]?.content?.parts?.[0]?.text;
        } else if (typeof genAI.getGenerativeModel === "function") {
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          const result = await model.generateContent(systemPrompt);
          aiAnswer = result.response.text();
        }
      } catch (geminiErr) {
        console.warn("Gemini generation failed, using intelligent fallback response:", geminiErr.message);
      }
    }

    // Fallback response if no Gemini key or rate limited
    if (!aiAnswer) {
      if (match) {
        const pathItems = buildPath(match, byId);
        aiAnswer = `### Recommended Career: **${match.title}**

${match.summary}

- **Recommended Pathway:** ${formatPath(pathItems)}
- **Estimated Duration:** ${match.duration}
- **Cost / Investment:** ${match.cost}
- **Difficulty Level:** ${match.difficulty}
- **Career Scope:** ${match.scope}

#### Core Skills to Build:
${match.skills.map((s) => `- **${s}**`).join("\n")}

#### Target Opportunities:
${match.opportunities.map((o) => `- ${o}`).join("\n")}

*Tip: You can download your customized step-by-step PDF roadmap from the Roadmap tab!*`;
      } else {
        aiAnswer = `### Career Path Guidance

Welcome! To help you plan your career effectively:

1. **Identify Your Starting Stage:** Choose whether you are after 10th grade, 12th grade, diploma, or graduation.
2. **Explore Pathways:** In the Explore tab, drill down from foundation streams into specialized professional degrees and technical domains.
3. **Compare Options:** Use our side-by-side comparison tool to evaluate duration, investment, difficulty, and job opportunities.
4. **Generate Your Roadmap:** Get a 5-step personalized action plan and export it as a clean PDF roadmap.

Feel free to ask about specific careers like **Computer Science, AI & Machine Learning, Data Science, Medical, Chartered Accountancy, or Civil Services!**`;
      }
    }

    res.json({
      answer: aiAnswer,
      action: match ? "roadmap" : null,
      recommendation: match ? {
        finalOptionId: match.id,
        pathIds: buildPath(match, byId).map((i) => i.id)
      } : null
    });
  } catch (error) {
    console.error("Chatbot Error:", error);
    res.status(500).json({ answer: `Sorry, I'm having trouble right now. Please try again in a moment. (${error.message})` });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Career Path Navigator server running at http://0.0.0.0:${PORT}`);
});
