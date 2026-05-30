const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const pool = require("./src/db");
const { createToken, authRequired } = require("./src/auth");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const PORT = process.env.PORT || 5000;
const frontendPath = path.join(__dirname, "../frontend");
app.use(cors());
app.use(express.json({
  limit: "1mb",
  verify(req, res, buf) {
    req.rawBody = buf.toString();
  }
}));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Invalid JSON payload for', req.method, req.url, 'from', req.ip);
    console.error('Content-Type:', req.headers['content-type']);
    console.error('Raw body length:', req.rawBody ? req.rawBody.length : 0);
    console.error('Raw body:', req.rawBody);
    return res.status(400).json({ message: 'Invalid JSON payload' });
  }
  next(err);
});

app.use(express.static(frontendPath));

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function optionRow(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    short: row.short_description,
    summary: row.summary,
    duration: row.duration,
    cost: row.cost,
    difficulty: row.difficulty,
    scope: row.scope,
    eligibility: parseJson(row.eligibility, []),
    skills: parseJson(row.skills, []),
    opportunities: parseJson(row.opportunities, [])
  };
}

async function getOption(id) {
  const [rows] = await pool.query("SELECT * FROM career_options WHERE id = ?", [id]);
  return rows[0] ? optionRow(rows[0]) : null;
}

async function getChildren(parentId) {
  const [rows] = await pool.query(
    "SELECT * FROM career_options WHERE parent_id <=> ? ORDER BY display_order, title",
    [parentId || null]
  );
  return rows.map(optionRow);
}

async function getAllOptions() {
  const [rows] = await pool.query("SELECT * FROM career_options ORDER BY display_order, title");
  return rows.map(optionRow);
}

const recommendationAliases = [
  {
    id: "data-science",
    aliases: ["data science", "datascience", "data scientist", "data analyst", "analytics", "machine learning", "ml"]
  },
  {
    id: "cybersecurity",
    aliases: ["cybersecurity", "cyber security", "ethical hacking", "hacking", "security analyst", "network security"]
  },
  {
    id: "full-stack",
    aliases: ["full stack", "fullstack", "web development", "web developer", "mern", "frontend", "backend"]
  },
  {
    id: "cloud-devops",
    aliases: ["cloud", "devops", "aws", "azure", "deployment", "sre", "site reliability"]
  },
  {
    id: "mobile-development",
    aliases: ["mobile app", "app development", "android", "ios", "flutter", "react native"]
  },
  {
    id: "ai-ml-engineering",
    aliases: ["artificial intelligence", "ai ml", "ai engineer", "ai/ml", "deep learning", "nlp", "computer vision"]
  },
  {
    id: "cse",
    aliases: ["computer science", "cse", "software engineering", "software developer", "coding", "programming"]
  }
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
    option.id,
    option.title,
    option.short,
    option.summary,
    option.scope,
    option.duration,
    option.cost,
    option.difficulty,
    ...option.eligibility,
    ...option.skills,
    ...option.opportunities
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

function formatRecommendation(target, pathItems) {
  const root = pathItems[0]?.title || "After 10th";
  const final = pathItems[pathItems.length - 1];
  return [
    `Recommended path for ${target.title}:`,
    formatPath(pathItems),
    "",
    `Start: ${root}`,
    `Final target: ${final.title}`,
    `Duration: ${target.duration}`,
    `Cost level: ${target.cost}`,
    `Difficulty: ${target.difficulty}`,
    "",
    "Why this path fits:",
    target.summary,
    "",
    "Step-by-step roadmap:",
    ...pathItems.map((item, index) => `${index + 1}. ${item.title}: ${item.short || item.summary}`),
    "",
    "Core skills to build:",
    target.skills.map((skill) => `- ${skill}`).join("\n"),
    "",
    "Eligibility checklist:",
    target.eligibility.map((item) => `- ${item}`).join("\n"),
    "",
    "Career opportunities:",
    target.opportunities.map((item) => `- ${item}`).join("\n"),
    "",
    "Practical project plan:",
    `- Month 1-2: Learn the basics for ${target.skills.slice(0, 2).join(" and ")}.`,
    `- Month 3-4: Build 2 small projects related to ${target.title}.`,
    "- Month 5-6: Add database/API or real-world data, publish on GitHub, and prepare a resume portfolio.",
    "- During college: Do internships, certifications, hackathons and final-year projects in this area."
  ].join("\n");
}

function formatGeneralAnswer(question, matches) {
  const top = matches.slice(0, 3);
  return [
    "I searched the career database and these options match your query:",
    "",
    ...top.map((option, index) => `${index + 1}. ${option.title}: ${option.short}\n   Scope: ${option.scope}`),
    "",
    "Ask like: 'build path for data science', 'cybersecurity roadmap', or 'full stack development path' and I will generate the full route from starting stage to final career."
  ].join("\n");
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
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

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash, academic_status, city, goal) VALUES (?, ?, ?, ?, ?, ?)",
      [name, email, hashedPassword, academicStatus, city || "", goal || ""]
    );

    const user = { id: result.insertId, name, email, academicStatus, city, goal };
    res.status(201).json({ user, token: createToken(user) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Email already registered. Please login." });
    }
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    const userRow = rows[0];

    const passwordMatches = userRow && (
      (userRow.password_hash && await bcrypt.compare(password, userRow.password_hash)) ||
      (!userRow.password_hash && userRow.password && password === userRow.password)
    );

    if (!userRow || !passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = {
      id: userRow.id,
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
  const [rows] = await pool.query("SELECT * FROM career_options ORDER BY display_order, title");
  const all = rows.map(optionRow);
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
    const [result] = await pool.query(
      "INSERT INTO roadmaps (user_id, title, path_ids, final_option_id) VALUES (?, ?, ?, ?)",
      [req.user.id, roadmapTitle, JSON.stringify(pathIds), finalOptionId]
    );

    res.status(201).json({ id: result.insertId, title: roadmapTitle, pathIds, finalOption });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/roadmaps", authRequired, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT r.*, c.title AS final_title FROM roadmaps r JOIN career_options c ON c.id = r.final_option_id WHERE r.user_id = ? ORDER BY r.created_at DESC",
    [req.user.id]
  );
  res.json(rows.map((row) => ({
    id: row.id,
    title: row.title,
    pathIds: parseJson(row.path_ids, []),
    finalOptionId: row.final_option_id,
    finalTitle: row.final_title,
    createdAt: row.created_at
  })));
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
    
    // Try to get user from token if available
    let user = null;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      try {
        user = require("jsonwebtoken").verify(token, process.env.JWT_SECRET || "career_path_navigator_secret_key");
        // Get full user profile from DB to get goal and status
        const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [user.id]);
        if (rows[0]) user = { ...user, goal: rows[0].goal, academicStatus: rows[0].academic_status };
      } catch (e) { /* ignore invalid token */ }
    }

    if (!question) {
      return res.json({
        answer: "Hi! I'm your Career AI Assistant. How can I help you today? You can ask about roadmaps, specific careers, or comparison between paths."
      });
    }

    // 1. Get database context
    const options = await getAllOptions();
    const byId = new Map(options.map((option) => [option.id, option]));
    
    const scored = options
      .map((option) => ({ option, score: scoreOption(option, question) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.option);

    const topMatches = scored.slice(0, 3);
    const match = scored[0];

    // ==========================================
    // LOCAL BYPASS (Save Gemini Tokens & Agentic UI)
    // ==========================================
    const bypassIds = ["data-science", "cybersecurity", "full-stack"];
    if (match && bypassIds.includes(match.id)) {
      return res.json({
        answer: `I have instantly mapped out a complete career path for **${match.title}**. Redirecting you to the Roadmap page now so you can view the detailed flowchart and download the PDF...`,
        action: "roadmap",
        recommendation: {
          finalOptionId: match.id,
          pathIds: buildPath(match, byId).map(i => i.id)
        }
      });
    }

    // 2. Build Context for Gemini
    let dbContext = "";
    if (topMatches.length > 0) {
      dbContext = "DATABASE MATCHES FOUND (Use this data to answer):\n\n" + topMatches.map(m => {
        const pathItems = buildPath(m, byId);
        return `Career: ${m.title}
Summary: ${m.summary}
Path: ${formatPath(pathItems)}
Skills: ${m.skills.join(", ")}
Opportunities: ${m.opportunities.join(", ")}
Scope: ${m.scope}`;
      }).join("\n\n---\n\n");
    } else {
      dbContext = "AVAILABLE CAREER OPTIONS IN DATABASE:\n" + options.map(o => o.title).join(", ");
    }

    // 2. Call Gemini for a personalized response
    const systemPrompt = `You are the "Career Path Navigator AI", an expert career counselor and educational guide powered by Google's Gemini model.

${user ? `USER PROFILE:
- Name: ${user.name}
- Goal: ${user.goal}
- Academic Status: ${user.academicStatus}` : "USER PROFILE: Guest (Unknown status)"}

AVAILABLE DATABASE CONTEXT:
${dbContext || "No direct database match found."}

YOUR INSTRUCTIONS:
1. You are an AI powered by Gemini. Answer the user's question directly using your extensive general knowledge about careers, education, and the job market.
2. If the user's question relates to the "AVAILABLE DATABASE CONTEXT" provided above, incorporate those specific details (like duration, cost, skills) into your answer to personalize it to our platform.
3. Be encouraging, professional, and highly actionable. Address the user by name if known.
4. Structure your response beautifully using markdown: use **bolding** for key terms, bullet points for lists, and keep paragraphs short.
5. If the user asks a general question, give them a high-quality, step-by-step roadmap using your own AI knowledge.
6. If the user says a greeting (like "hi" or "hello") or says "thank you", reply politely and conversationally as a helpful assistant.
7. Keep the response concise but highly informative (around 150-300 words, unless it's just a greeting).

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
