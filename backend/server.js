const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const connectDB = require("./src/db");
const mongoose = require("mongoose");
const User = require("./src/models/User");
const CareerOption = require("./src/models/CareerOption");
const Roadmap = require("./src/models/Roadmap");

const { createToken, authRequired } = require("./src/auth");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const PORT = process.env.PORT || 5000;
const frontendPath = path.join(__dirname, "../frontend");

// Connect to MongoDB
connectDB();

app.use(cors());
app.use(express.json({
  limit: "1mb",
  verify(req, res, buf) {
    req.rawBody = buf.toString();
  }
}));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON payload' });
  }
  next(err);
});

app.use(express.static(frontendPath));

function optionRow(row) {
  if (!row) return null;
  return {
    id: row._id,
    parentId: row.parent_id,
    title: row.title,
    short: row.short_description,
    summary: row.summary,
    duration: row.duration,
    cost: row.cost,
    difficulty: row.difficulty,
    scope: row.scope,
    eligibility: row.eligibility || [],
    skills: row.skills || [],
    opportunities: row.opportunities || []
  };
}

async function getOption(id) {
  const row = await CareerOption.findById(id).lean();
  return optionRow(row);
}

async function getChildren(parentId) {
  const rows = await CareerOption.find({ parent_id: parentId || null })
    .sort({ display_order: 1, title: 1 })
    .lean();
  return rows.map(optionRow);
}

async function getAllOptions() {
  const rows = await CareerOption.find().sort({ display_order: 1, title: 1 }).lean();
  return rows.map(optionRow);
}

const recommendationAliases = [
  { id: "data-science", aliases: ["data science", "datascience", "data scientist", "data analyst", "analytics", "machine learning", "ml"] },
  { id: "cybersecurity", aliases: ["cybersecurity", "cyber security", "ethical hacking", "hacking", "security analyst", "network security"] },
  { id: "full-stack", aliases: ["full stack", "fullstack", "web development", "web developer", "mern", "frontend", "backend"] },
  { id: "cloud-devops", aliases: ["cloud", "devops", "aws", "azure", "deployment", "sre", "site reliability"] },
  { id: "mobile-development", aliases: ["mobile app", "app development", "android", "ios", "flutter", "react native"] },
  { id: "ai-ml-engineering", aliases: ["artificial intelligence", "ai ml", "ai engineer", "ai/ml", "deep learning", "nlp", "computer vision"] },
  { id: "cse", aliases: ["computer science", "cse", "software engineering", "software developer", "coding", "programming"] }
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

app.get("/api/health", async (_req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      res.json({ status: "ok", database: "connected" });
    } else {
      res.status(500).json({ status: "error", message: "Database not connected" });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, academicStatus, city, goal } = req.body;
    if (!name || !email || !password || !academicStatus) {
      return res.status(400).json({ message: "Name, email, password and academic status are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "Email already registered. Please login." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await User.create({
      name, email, password_hash: hashedPassword, academic_status: academicStatus, city: city || "", goal: goal || ""
    });

    const user = { id: result._id, name, email, academicStatus, city, goal };
    res.status(201).json({ user, token: createToken(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const userRow = await User.findOne({ email }).lean();

    const passwordMatches = userRow && (
      (userRow.password_hash && await bcrypt.compare(password, userRow.password_hash)) ||
      (!userRow.password_hash && userRow.password && password === userRow.password)
    );

    if (!userRow || !passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = {
      id: userRow._id,
      name: userRow.name,
      email: userRow.email,
      academicStatus: userRow.academic_status || userRow.academic_stage,
      city: userRow.city || "",
      goal: userRow.goal || ""
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
    return { ...node, children: (byParent.get(id) || []).map((child) => build(child.id)).filter(Boolean) };
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
    const result = await Roadmap.create({
      user_id: req.user.id,
      title: roadmapTitle,
      path_ids: pathIds,
      final_option_id: finalOptionId
    });

    res.status(201).json({ id: result._id, title: roadmapTitle, pathIds, finalOption });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/roadmaps", authRequired, async (req, res) => {
  try {
    const rows = await Roadmap.find({ user_id: req.user.id })
      .populate('final_option_id', 'title')
      .sort({ created_at: -1 })
      .lean();
      
    res.json(rows.map((row) => ({
      id: row._id,
      title: row.title,
      pathIds: row.path_ids,
      finalOptionId: row.final_option_id?._id,
      finalTitle: row.final_option_id?.title || "",
      createdAt: row.created_at
    })));
  } catch(error) {
    res.status(500).json({ message: error.message });
  }
});

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

app.post("/api/chatbot", async (req, res) => {
  try {
    const { question: questionRaw, currentOptionId } = req.body;
    const question = String(questionRaw || "").trim();
    
    let user = null;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      try {
        user = require("jsonwebtoken").verify(token, process.env.JWT_SECRET || "career_path_navigator_secret_key");
        const userRow = await User.findById(user.id).lean();
        if (userRow) user = { ...user, goal: userRow.goal, academicStatus: userRow.academic_status };
      } catch (e) { }
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
    const match = aliasMatch ? byId.get(aliasMatch.id) : null;

    let dbContext = "";
    if (topMatches.length > 0) {
      dbContext = "DATABASE MATCHES FOUND (Use this data to answer):\n\n" + topMatches.map(m => {
        const pathItems = buildPath(m, byId);
        return `Career: ${m.title}\nSummary: ${m.summary}\nPath: ${formatPath(pathItems)}\nSkills: ${m.skills.join(", ")}\nOpportunities: ${m.opportunities.join(", ")}\nScope: ${m.scope}`;
      }).join("\n\n---\n\n");
    } else {
      dbContext = "AVAILABLE CAREER OPTIONS IN DATABASE:\n" + options.map(o => o.title).join(", ");
    }

    if (match && user) {
      try {
        const pathIds = buildPath(match, byId).map(i => i.id);
        const roadmapTitle = pathIds.join(" -> ");
        
        const existing = await Roadmap.findOne({ user_id: user.id, final_option_id: match.id }).lean();
        
        if (!existing) {
          await Roadmap.create({
            user_id: user.id,
            title: roadmapTitle,
            path_ids: pathIds,
            final_option_id: match.id
          });
        }
      } catch (err) {
        console.warn("Auto-save roadmap failed:", err.message);
      }
    }

    const systemPrompt = `You are the "Career Path Navigator AI", an expert career counselor and educational guide powered by Google's Gemini model.

${user ? \`USER PROFILE:
- Name: \${user.name}
- Goal: \${user.goal}
- Academic Status: \${user.academicStatus}\` : "USER PROFILE: Guest (Unknown status)"}

AVAILABLE DATABASE CONTEXT:
${dbContext || "No direct database match found."}

YOUR INSTRUCTIONS:
1. Answer directly using extensive general knowledge.
2. Incorporate specific details from DATABASE MATCHES.
3. Be encouraging, professional, and highly actionable.
4. Use markdown.
5. If general, give a step-by-step roadmap.
6. Reply politely to greetings.
7. Keep it concise (150-300 words).

User Question: ${question}`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(systemPrompt);
    const aiAnswer = result.response.text();

    res.json({
      answer: aiAnswer,
      action: match ? "roadmap" : null,
      recommendation: match ? {
        finalOptionId: match.id,
        pathIds: buildPath(match, byId).map(i => i.id)
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

app.listen(PORT, () => {
  console.log(`Career Path Navigator running at http://localhost:${PORT}`);
});
