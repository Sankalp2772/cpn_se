/* ═══════════════════════════════════════════
   Career Path Navigator — app.js
   Dynamic SPA with auth gating + dark mode
   ═══════════════════════════════════════════ */

const API = "";

// ─── State ──────────────────────────────────
const state = {
  token: localStorage.getItem("cpn_token"),
  user: JSON.parse(localStorage.getItem("cpn_user") || "null"),
  stages: [],
  current: null,
  currentDetail: null,
  path: [],
  savedRoadmaps: [],
  expandedNodes: {}
};

// ─── Helpers ─────────────────────────────────
const $ = (id) => document.getElementById(id);
const hide = (el) => el?.classList.add("hidden");
const show = (el) => el?.classList.remove("hidden");

// ─── API Wrapper ─────────────────────────────
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}

// ─── Toast ────────────────────────────────────
function toast(message, type = "default") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove("show"), 2800);
}

// ─── Theme ────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("cpn_theme", theme);
  const isDark = theme === "dark";
  const icon = isDark ? "Light" : "Theme";
  const label = isDark ? "Light Mode" : "Dark Mode";
  if ($("themeToggle")) $("themeToggle").textContent = icon;
  if ($("themeToggleSidebar")) $("themeToggleSidebar").textContent = label;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
}

// ─── Page Router ─────────────────────────────
function showAuthPage(pageId) {
  // Hide all auth sub-pages
  ["landingPage", "loginPage", "registerPage"].forEach(id => hide($(id)));
  show($(pageId));
  show($("authPages"));
  hide($("dashboardPages"));
}

function showDashboard(screen = "explore") {
  hide($("authPages"));
  show($("dashboardPages"));
  showScreen(screen);
}

// ─── Dashboard Screen Routing ─────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.screen === id));

  const copy = {
    explore: ["Explore Paths", "Move step by step through career options from the database."],
    mindmap: ["Mindmap", "See your selected route as a tree-based visual structure."],
    roadmap: ["Roadmap PDF", "Generate and download your selected path as PDF."],
    compare: ["Compare", "Compare two saved roadmaps using database-backed data."]
  };

  if (copy[id]) {
    $("screenTitle").textContent = copy[id][0];
    $("screenSubtitle").textContent = copy[id][1];
  }

  if (id === "compare") loadRoadmaps();
  if (id === "mindmap") renderMindmap();
}

// ─── User State ───────────────────────────────
function setUser(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem("cpn_user", JSON.stringify(user));
  localStorage.setItem("cpn_token", token);
  renderUserInfo();
}

function renderUserInfo() {
  if (!state.user) return;
  $("userName").textContent = state.user.name || "User";
  $("userMeta").textContent = `${state.user.academicStatus || "Student"} · ${state.user.goal || "Exploring"}`;
}

// ─── Career Data Loading ──────────────────────
async function loadStages() {
  state.stages = await api("/api/career/stages");
  const statusEl = $("registerStatus");
  if (statusEl) {
    statusEl.innerHTML = state.stages.map(s => `<option value="${s.id}">${s.title}</option>`).join("");
  }
  if (!state.current && state.stages.length) {
    state.current = state.user?.academicStatus || state.stages[0]?.id;
    state.path = [state.current];
  }
}

async function loadCurrent() {
  if (!state.current) return;
  const detail = await api(`/api/career/options/${state.current}`);
  state.currentDetail = detail;
  renderExplore(detail);
  renderRoadmap();
}

// ─── Explore ──────────────────────────────────
function renderExplore(detail) {
  $("crumbs").innerHTML = state.path.map((id, i) => {
    const label = id === detail.id ? detail.title : id.replaceAll("-", " ");
    return `<button class="crumb" data-crumb="${i}">${label}</button>`;
  }).join("");

  document.querySelectorAll("[data-crumb]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.crumb);
      state.path = state.path.slice(0, i + 1);
      state.current = state.path[state.path.length - 1];
      await loadCurrent();
    });
  });

  $("optionList").innerHTML = detail.children?.length
    ? detail.children.map(item => `
        <button class="option-btn" data-option="${item.id}">
          <strong>${item.title}</strong>
          <span>${item.short || ""}</span>
        </button>`).join("")
    : `<p class="muted" style="padding:12px 0">This is a final route. Save it as a roadmap or ask the chatbot about next steps.</p>`;

  document.querySelectorAll("[data-option]").forEach(btn => {
    btn.addEventListener("click", async () => {
      state.current = btn.dataset.option;
      state.path.push(state.current);
      await loadCurrent();
    });
  });

  $("detailPanel").innerHTML = `
    <h2 class="detail-title">${detail.title}</h2>
    <p class="muted">${detail.summary || ""}</p>
    <div class="chips">
      <span class="chip teal">${detail.duration || "N/A"}</span>
      <span class="chip orange">${detail.cost || "N/A"}</span>
      <span class="chip blue">${detail.difficulty || "N/A"}</span>
      <span class="chip">${detail.scope || "N/A"}</span>
    </div>
    <div class="detail-columns">
      ${listCard("Eligibility", detail.eligibility || [])}
      ${listCard("Skills to Build", detail.skills || [])}
      ${listCard("Opportunities", detail.opportunities || [])}
    </div>`;
}

function listCard(title, items) {
  return `<div class="mini-card"><h4>${title}</h4><ul>${items.map(i => `<li>${i}</li>`).join("")}</ul></div>`;
}

// ─── Mindmap ──────────────────────────────────
async function renderMindmap() {
  const container = $("mindmapEl");
  if (!state.stages.length) {
    container.innerHTML = `<p class="muted">No career stages found.</p>`;
    return;
  }

  state.expandedNodes = state.expandedNodes || {};
  for (let id of state.path) state.expandedNodes[id] = true;

  async function buildTree(nodeId, depth = 0) {
    if (depth > 10) return "";
    const node = nodeId
      ? await api(`/api/career/options/${nodeId}`)
      : { id: "root", title: "Career Stages", children: state.stages };
    if (!node) return "";
    const isActive = state.path.includes(node.id) || node.id === "root";
    const children = node.children || [];
    let html = `<div class="tree-node ${isActive ? "active" : ""}">
      <div class="tree-node-title ${node.id === "root" ? "root" : ""}" data-id="${node.id}">
        <span class="tree-toggle">${children.length ? (state.expandedNodes?.[node.id] ? "▼" : "▶") : "○"}</span>
        <strong>${node.title}</strong>
        ${node.short ? `<span class="tree-short">${node.short}</span>` : ""}
      </div>`;
    if (children.length && state.expandedNodes?.[node.id]) {
      html += `<div class="tree-children">`;
      for (let child of children) html += await buildTree(child.id, depth + 1);
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  container.innerHTML = `<div class="tree-container">${await buildTree(null)}</div>`;

  document.querySelectorAll(".tree-node-title").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      if (id === "root") return;
      if (state.expandedNodes[id]) delete state.expandedNodes[id];
      else state.expandedNodes[id] = true;
      const nodeData = await api(`/api/career/options/${id}`).catch(() => null);
      if (nodeData) {
        state.current = id;
        if (!state.path.includes(id)) state.path.push(id);
        await loadCurrent();
      }
      await renderMindmap();
    });
  });
}

// ─── Roadmap ──────────────────────────────────
function roadmapSteps() {
  if (!state.currentDetail) return [];
  const final = state.currentDetail;
  return [
    ["Understand Current Stage", `Start from ${state.path[0] || "your current level"} and identify interests, budget, time and expectations.`],
    ["Explore Selected Route", `Selected route: ${state.path.join(" → ")}. Verify eligibility and outcomes.`],
    ["Build Core Skills", `Focus on: ${(final.skills || []).join(", ") || "domain-specific skills"}.`],
    ["Prepare for Entry", "Track entrance exams, admission forms, portfolios, certificates or interviews for your chosen route."],
    ["Target Opportunities", `Aim for: ${(final.opportunities || []).join(", ") || "industry opportunities"}.`]
  ];
}

function renderRoadmap() {
  if (!state.currentDetail) {
    $("roadmapSteps").innerHTML = `<p class="muted">Explore a career path first to generate your roadmap.</p>`;
    return;
  }
  $("roadmapSteps").innerHTML = roadmapSteps().map((step, i) => `
    <div class="step">
      <div class="step-no">${i + 1}</div>
      <div class="step-card"><h4>${step[0]}</h4><p class="muted">${step[1]}</p></div>
    </div>`).join("");
}

// ─── Save / Load Roadmaps ────────────────────
async function saveRoadmap() {
  if (!state.token) return toast("Login first to save roadmap.", "error");
  if (!state.current) return toast("Explore a career path first.");
  const title = state.path.join(" → ");
  const saved = await api("/api/roadmaps", {
    method: "POST",
    body: JSON.stringify({ title, pathIds: state.path, finalOptionId: state.current })
  });
  toast(`Saved: ${saved.finalOption?.title || title}`);
  await loadRoadmaps();
}

async function loadRoadmaps() {
  if (!state.token) {
    $("savedRoadmaps").innerHTML = `<span class="saved-pill">Login to view saved roadmaps.</span>`;
    return;
  }
  state.savedRoadmaps = await api("/api/roadmaps").catch(() => []);
  $("savedRoadmaps").innerHTML = state.savedRoadmaps.length
    ? state.savedRoadmaps.map(r => `<span class="saved-pill">${r.title}</span>`).join("")
    : `<span class="saved-pill">No saved roadmaps yet.</span>`;

  const opts = state.savedRoadmaps.map(r => `<option value="${r.finalOptionId}">${r.title}</option>`).join("");
  $("compareA").innerHTML = opts;
  $("compareB").innerHTML = opts;
  if (state.savedRoadmaps.length > 1) $("compareB").selectedIndex = 1;
}

// ─── Compare ─────────────────────────────────
async function compareRoadmaps() {
  const optionA = $("compareA").value;
  const optionB = $("compareB").value;
  if (!optionA || !optionB) return toast("Save two roadmaps first.");
  const result = await api("/api/compare", {
    method: "POST",
    body: JSON.stringify({ optionA, optionB })
  });
  $("compareResult").innerHTML = `
    <table class="compare-table">
      <thead><tr><th>Factor</th><th>${result.a.title}</th><th>${result.b.title}</th></tr></thead>
      <tbody>${result.factors.map(f => `<tr><td><strong>${f.label}</strong></td><td>${f.a}</td><td>${f.b}</td></tr>`).join("")}</tbody>
    </table>`;
}

// ─── Download PDF ─────────────────────────────
function downloadPdf() {
  if (!state.currentDetail) return toast("Explore a path first.");
  const detail = state.currentDetail;
  
  const flowChartHtml = state.path.map((step, idx) => `
    <div style="display:inline-block; padding:8px 12px; background:#eef2ff; border:2px solid #6366f1; border-radius:8px; margin:4px; font-weight:bold; color:#312e81;">
      ${step.replace(/-/g, ' ').toUpperCase()}
    </div>
    ${idx < state.path.length - 1 ? '<span style="font-size:20px; color:#6366f1; vertical-align:middle; margin: 0 4px;">➔</span>' : ''}
  `).join("");

  $("printSheet").innerHTML = `
    <div style="font-family: sans-serif; color: #111;">
      <h1 style="border-bottom: 2px solid #6366f1; padding-bottom: 8px; color: #312e81;">Career Path Roadmap</h1>
      <p><strong>Student:</strong> ${state.user?.name || "Guest"} &nbsp;&nbsp;&nbsp; <strong>Goal:</strong> ${state.user?.goal || "Exploring"}</p>
      
      <h3 style="color: #4338ca; margin-top: 24px;">Visual Flowchart</h3>
      <div style="padding: 16px; background: #f8fafc; border-radius: 8px; margin-bottom: 24px; text-align: center; border: 1px dashed #cbd5e1;">
        ${flowChartHtml}
      </div>

      <h3 style="color: #4338ca;">Final Career: ${detail.title}</h3>
      <p><strong>Summary:</strong> ${detail.summary || "N/A"}</p>
      <p><strong>Scope:</strong> ${detail.scope || "N/A"}</p>
      
      <div style="display: flex; gap: 16px; margin-top: 16px; margin-bottom: 24px;">
        <div style="flex:1; padding: 12px; border: 1px solid #ccc; border-radius: 8px;"><strong>Duration:</strong> <br>${detail.duration || "N/A"}</div>
        <div style="flex:1; padding: 12px; border: 1px solid #ccc; border-radius: 8px;"><strong>Cost:</strong> <br>${detail.cost || "N/A"}</div>
        <div style="flex:1; padding: 12px; border: 1px solid #ccc; border-radius: 8px;"><strong>Difficulty:</strong> <br>${detail.difficulty || "N/A"}</div>
      </div>

      <h3 style="color: #4338ca;">Step-by-Step Action Plan</h3>
      <table style="width:100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="background: #eef2ff; text-align: left;">
            <th style="padding: 12px; border: 1px solid #cbd5e1;">Step</th>
            <th style="padding: 12px; border: 1px solid #cbd5e1;">Action Plan</th>
          </tr>
        </thead>
        <tbody>
          ${roadmapSteps().map((s, i) => `
            <tr>
              <td style="padding: 12px; border: 1px solid #cbd5e1; font-weight: bold;">${i + 1}. ${s[0]}</td>
              <td style="padding: 12px; border: 1px solid #cbd5e1;">${s[1]}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <h3 style="color: #4338ca;">Requirements & Details</h3>
      <div style="display: flex; gap: 16px; font-size: 14px;">
        <div style="flex: 1;">
          <strong>Eligibility:</strong>
          <ul style="padding-left:16px;">${(detail.eligibility || []).map(e => `<li style="margin-bottom:4px;">${e}</li>`).join("")}</ul>
        </div>
        <div style="flex: 1;">
          <strong>Core Skills:</strong>
          <ul style="padding-left:16px;">${(detail.skills || []).map(s => `<li style="margin-bottom:4px;">${s}</li>`).join("")}</ul>
        </div>
        <div style="flex: 1;">
          <strong>Opportunities:</strong>
          <ul style="padding-left:16px;">${(detail.opportunities || []).map(o => `<li style="margin-bottom:4px;">${o}</li>`).join("")}</ul>
        </div>
      </div>
    </div>`;
  window.print();
}

// ─── Chatbot ─────────────────────────────────
function addMessage(text, type) {
  const msg = document.createElement("div");
  msg.className = `msg ${type}`;

  if (type === "loading") {
    msg.innerHTML = `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>`;
    msg.id = "loadingMsg";
  } else {
    const escape = str => str.replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
    const safe = escape(text);
    msg.innerHTML = safe
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^## (.*)/gm, "<h4>$1</h4>")
      .replace(/^- (.*)/gm, "• $1")
      .replace(/\n/g, "<br>");
  }
  $("chatMessages").appendChild(msg);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  return msg;
}

async function sendChat(question) {
  addMessage(question, "user");
  const loadingEl = addMessage("", "bot loading");
  try {
    const data = await api("/api/chatbot", {
      method: "POST",
      body: JSON.stringify({ question, currentOptionId: state.current })
    });
    loadingEl.remove();
    addMessage(data.answer || "No response.", "bot");

    // Agentic UI Control
    if (data.action && data.recommendation) {
      state.current = data.recommendation.finalOptionId;
      state.path = data.recommendation.pathIds;
      await loadCurrent();
      
      setTimeout(() => {
        toast(`Redirecting to ${data.action} for ${data.recommendation.finalOptionId}...`, "default");
        showScreen(data.action);
      }, 500);
    }

  } catch (error) {
    loadingEl.remove();
    addMessage("Sorry, I couldn't connect to the AI right now. Please try again.", "bot");
  }
}

// ─── AUTH FORMS ───────────────────────────────
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("loginSubmitBtn");
  btn.textContent = "Logging in...";
  btn.disabled = true;
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("loginEmail").value, password: $("loginPassword").value })
    });
    setUser(data.user, data.token);
    state.current = data.user.academicStatus || state.stages[0]?.id;
    state.path = [state.current];
    await loadCurrent();
    await loadRoadmaps();
    showDashboard("explore");
    toast(`Welcome back, ${data.user.name}!`);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.textContent = "Login to Dashboard";
    btn.disabled = false;
  }
});

$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("registerSubmitBtn");
  btn.textContent = "Creating account...";
  btn.disabled = true;
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("registerName").value,
        email: $("registerEmail").value,
        password: $("registerPassword").value,
        city: $("registerCity").value,
        goal: $("registerGoal").value,
        academicStatus: $("registerStatus").value
      })
    });
    setUser(data.user, data.token);
    state.current = data.user.academicStatus;
    state.path = [state.current];
    await loadCurrent();
    await loadRoadmaps();
    showDashboard("explore");
    toast(`Welcome, ${data.user.name}! Let's explore your career.`);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.textContent = "Create Account →";
    btn.disabled = false;
  }
});

// ─── EVENT LISTENERS ──────────────────────────
// Landing CTAs
$("heroGetStarted").addEventListener("click", () => showAuthPage("registerPage"));
$("heroLearnMore").addEventListener("click", () => {
  document.querySelector(".features-section")?.scrollIntoView({ behavior: "smooth" });
});
$("navLoginBtn").addEventListener("click", () => showAuthPage("loginPage"));
$("navRegisterBtn").addEventListener("click", () => showAuthPage("registerPage"));
$("switchToRegister").addEventListener("click", () => showAuthPage("registerPage"));
$("switchToLogin").addEventListener("click", () => showAuthPage("loginPage"));

// Dashboard nav
document.querySelectorAll(".nav-btn").forEach(btn =>
  btn.addEventListener("click", () => showScreen(btn.dataset.screen))
);

// Logout
$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("cpn_token");
  localStorage.removeItem("cpn_user");
  state.token = null;
  state.user = null;
  state.current = null;
  state.path = [];
  state.currentDetail = null;
  showAuthPage("landingPage");
  toast("Logged out.");
});

// Dashboard actions
$("resetPathBtn").addEventListener("click", async () => {
  state.current = state.user?.academicStatus || state.stages[0]?.id;
  state.path = [state.current];
  await loadCurrent();
  toast("Path reset.");
});
$("saveRoadmapBtn").addEventListener("click", saveRoadmap);
$("compareBtn").addEventListener("click", compareRoadmaps);
$("downloadPdfBtn").addEventListener("click", downloadPdf);

// Chat
$("chatOpen").addEventListener("click", () => $("chat").classList.add("open"));
$("chatClose").addEventListener("click", () => $("chat").classList.remove("open"));
$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("chatInput");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  await sendChat(question);
});

// Theme toggles
$("themeToggle").addEventListener("click", toggleTheme);
$("themeToggleSidebar").addEventListener("click", toggleTheme);

// ─── INIT ─────────────────────────────────────
async function init() {
  // Apply saved theme
  const savedTheme = localStorage.getItem("cpn_theme") || "light";
  applyTheme(savedTheme);

  // Load stages for register form
  await loadStages().catch(() => {});

  if (state.token && state.user) {
    // Already logged in — go straight to dashboard
    renderUserInfo();
    try {
      state.current = state.user.academicStatus || state.stages[0]?.id;
      state.path = [state.current];
      await loadCurrent();
      await loadRoadmaps();
      showDashboard("explore");

      // Init chat
      addMessage("Hi! I'm your Career AI Assistant. Ask me anything about career paths, roadmaps, or comparisons!", "bot");
    } catch (err) {
      // Token expired or DB error — reset to landing
      localStorage.removeItem("cpn_token");
      localStorage.removeItem("cpn_user");
      state.token = null;
      state.user = null;
      showAuthPage("landingPage");
      toast("Session expired. Please login again.", "error");
    }
  } else {
    // Not logged in — show landing page
    showAuthPage("landingPage");
  }
}

init();
