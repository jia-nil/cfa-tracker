import { useState, useEffect, useRef, useMemo } from "react";

const SB_URL  = import.meta.env.VITE_SUPABASE_URL;
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const OR_KEY  = "YOUR_OPENROUTER_KEY";


// ─────────────────────────────────────────────────────────────────────────────
// Supabase Auth helpers
// ─────────────────────────────────────────────────────────────────────────────
const SB_AUTH = {
  async signUp(email, password) {
    const r = await fetch(SB_URL + "/auth/v1/signup", {
      method: "POST",
      headers: { "apikey": SB_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || "Sign up failed");
    return d;
  },
  async signInEmail(email, password) {
    const r = await fetch(SB_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "apikey": SB_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || "Login failed");
    return d;
  },
  async signOut(accessToken) {
    await fetch(SB_URL + "/auth/v1/logout", {
      method: "POST",
      headers: { "apikey": SB_ANON, "Authorization": "Bearer " + accessToken },
    });
  },
  async getUser(accessToken) {
    const r = await fetch(SB_URL + "/auth/v1/user", {
      headers: { "apikey": SB_ANON, "Authorization": "Bearer " + accessToken },
    });
    if (!r.ok) return null;
    return await r.json();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// CFA exam windows — real 2026/2027 dates
// ─────────────────────────────────────────────────────────────────────────────
const EXAM_WINDOWS = {
  L1: [
    { id: "2026-08", label: "August 2026", start: "2026-08-18", end: "2026-08-24" },
    { id: "2026-11", label: "November 2026", start: "2026-11-11", end: "2026-11-17" },
    { id: "2027-02", label: "February 2027", start: "2027-02-01", end: "2027-02-07" },
  ],
  L2: [
    { id: "2026-08", label: "August 2026", start: "2026-08-25", end: "2026-08-29" },
    { id: "2026-11", label: "November 2026", start: "2026-11-18", end: "2026-11-22" },
  ],
  L3: [
    { id: "2026-08", label: "August 2026", start: "2026-08-13", end: "2026-08-17" },
    { id: "2027-02", label: "February 2027", start: "2027-02-01", end: "2027-02-05" },
  ],
};
const RECOMMENDED_HOURS = { L1: 300, L2: 328, L3: 344 };

// ─────────────────────────────────────────────────────────────────────────────
// CFA curriculum — topic areas per level, with real exam weights
// ─────────────────────────────────────────────────────────────────────────────
const TOPICS = {
  Ethics: {
    L1: ["Code of Ethics", "Standards of Professional Conduct", "GIPS"],
    L2: ["Code of Ethics", "Standards of Professional Conduct", "GIPS", "Asset Manager Code"],
    L3: ["Code of Ethics", "Standards of Professional Conduct", "GIPS", "Asset Manager Code"],
  },
  Quantitative: {
    L1: ["Time Value of Money", "Statistical Concepts", "Probability", "Sampling", "Hypothesis Testing", "Correlation & Regression"],
    L2: ["Correlation & Regression", "Time Series Analysis", "Machine Learning", "Big Data Techniques"],
    L3: ["Quantitative Methods for Portfolio Management"],
  },
  Economics: {
    L1: ["Microeconomics", "Macroeconomics", "Global Trade", "Currency Exchange", "Business Cycles"],
    L2: ["Economics & Investment Markets", "Currency Exchange Rates"],
    L3: ["Capital Market Expectations"],
  },
  "Fin. Reporting": {
    L1: ["Intro to Financial Statements", "Income Statement", "Balance Sheet", "Cash Flow Statement", "Inventories", "PP&E", "Deferred Taxes", "Long-Term Debt", "Leases", "Intercorporate Investments", "Multinational Operations", "Financial Ratio Analysis"],
    L2: ["Intercorporate Investments", "Pension & Employee Benefits", "Multinational Operations", "Evaluating Quality of Reports"],
    L3: [],
  },
  "Corp. Issuers": {
    L1: ["Capital Budgeting", "Cost of Capital", "Capital Structure", "Working Capital", "Corporate Governance", "ESG Considerations"],
    L2: ["Capital Structure", "Dividends & Share Repurchases", "Corporate Governance & ESG"],
    L3: [],
  },
  Equity: {
    L1: ["Market Organisation", "Security Market Indices", "Equity Valuation Basics", "Industry Analysis", "DCF Valuation", "Price Multiples"],
    L2: ["Equity Valuation: DDM", "Free Cash Flow Valuation", "Price Multiples", "Residual Income", "Private Company Valuation"],
    L3: ["Equity Portfolio Management", "Active Equity Investing"],
  },
  "Fixed Income": {
    L1: ["Bond Features", "Bond Valuation", "Yield Measures", "Duration & Convexity", "Credit Analysis", "Asset-Backed Securities"],
    L2: ["Term Structure & Interest Rates", "Credit Analysis", "Credit Default Swaps", "MBS / ABS"],
    L3: ["Fixed Income Portfolio Management", "Liability-Driven Investing", "Yield Curve Strategies"],
  },
  Derivatives: {
    L1: ["Futures & Forwards", "Options Basics", "Swaps", "Risk Management with Derivatives"],
    L2: ["Derivatives Valuation & Strategies"],
    L3: ["Derivatives & Currency Management"],
  },
  "Alt. Investments": {
    L1: ["Alt Investment Features", "Hedge Funds", "Private Equity", "Real Estate", "Commodities"],
    L2: ["Real Estate", "Private Equity", "Commodities", "Infrastructure"],
    L3: ["Alternative Investments Portfolio Management"],
  },
  "Portfolio Mgmt": {
    L1: ["Portfolio Management Intro", "Investment Policy Statements", "Risk & Return Basics"],
    L2: ["Portfolio Construction", "Risk Management", "Algorithmic Trading"],
    L3: ["Portfolio Management Process", "IPS Construction", "Behavioural Finance", "Risk Management", "Performance Evaluation", "GIPS Application"],
  },
};

// Exam weight tiers per level — H/M/L
const WEIGHTS = {
  Ethics:            { L1: "H", L2: "H", L3: "H" },
  Quantitative:       { L1: "H", L2: "M", L3: "L" },
  Economics:          { L1: "M", L2: "M", L3: "M" },
  "Fin. Reporting":   { L1: "H", L2: "H", L3: "L" },
  "Corp. Issuers":    { L1: "M", L2: "M", L3: "L" },
  Equity:             { L1: "H", L2: "H", L3: "H" },
  "Fixed Income":     { L1: "H", L2: "H", L3: "H" },
  Derivatives:        { L1: "M", L2: "M", L3: "H" },
  "Alt. Investments": { L1: "M", L2: "M", L3: "M" },
  "Portfolio Mgmt":   { L1: "M", L2: "M", L3: "H" },
};

const TOPIC_COLORS = {
  Ethics: "#6c63ff", Quantitative: "#00d4aa", Economics: "#ffd166",
  "Fin. Reporting": "#ff6b9d", "Corp. Issuers": "#4ecdc4", Equity: "#45b7d1",
  "Fixed Income": "#96ceb4", Derivatives: "#ff9f43", "Alt. Investments": "#a29bfe",
  "Portfolio Mgmt": "#fd79a8",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const THEME = {
  bg: "#0a0a0f", sb: "#0d0d15", card: "#12121e", hover: "#1a1a28",
  b: "rgba(255,255,255,0.07)", bs: "rgba(255,255,255,0.14)",
  t: "#f0f0ff", t2: "#c0c0e0", t3: "#7878a8", t4: "#454566",
  a1: "#6c63ff", a2: "#00d4aa", a3: "#ff6b9d",
  gold: "#ffd166", danger: "#ff4d6d",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function today() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function fmt(mins) {
  if (!mins || mins <= 0) return "0m";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}
function dayName(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
}
function weekdayIndex(dateStr) {
  // Monday = 0 ... Sunday = 6
  const jsDay = new Date(dateStr + "T00:00:00").getDay(); // Sun=0..Sat=6
  return (jsDay + 6) % 7;
}

// All topics for a level, flattened, in curriculum order, with subject + weight
function allTopicsForLevel(level) {
  const out = [];
  Object.keys(TOPICS).forEach(sub => {
    const list = TOPICS[sub][level] || [];
    list.forEach(topic => out.push({ subject: sub, topic, weight: WEIGHTS[sub][level] || "M" }));
  });
  // Sort so High weight topics are interleaved earlier (study heavy topics with more repetition across the plan)
  const order = { H: 0, M: 1, L: 2 };
  return out.sort((a, b) => order[a.weight] - order[b.weight]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Roadmap generator
// Distributes all topics across available study days between today and exam,
// weighting time allocation by topic importance (H gets more sessions than L)
// ─────────────────────────────────────────────────────────────────────────────
function generateRoadmap({ level, examDate, studyDays, dailyHours }) {
  const topics = allTopicsForLevel(level);
  if (topics.length === 0 || !examDate) return { weeks: [], totalDays: 0 };

  const totalDaysToExam = Math.max(1, daysBetween(today(), examDate));
  // Reserve the final 10% of time (min 5 days, max 14) purely for revision
  const revisionDays = Math.min(14, Math.max(5, Math.round(totalDaysToExam * 0.12)));
  const studyPhaseDays = Math.max(1, totalDaysToExam - revisionDays);

  // Build list of actual study dates (only on selected weekdays) within study phase
  const studyDates = [];
  for (let i = 0; i < studyPhaseDays; i++) {
    const d = addDays(today(), i);
    if (studyDays.includes(weekdayIndex(d))) studyDates.push(d);
  }

  if (studyDates.length === 0) {
    return { weeks: [], totalDays: totalDaysToExam, revisionDays, noStudyDays: true };
  }

  // Weight-based session allocation: H topics get 3 passes, M gets 2, L gets 1
  const passesFor = { H: 3, M: 2, L: 1 };
  const sessionPool = [];
  topics.forEach(t => {
    const passes = passesFor[t.weight];
    for (let p = 0; p < passes; p++) {
      sessionPool.push({ ...t, pass: p + 1, totalPasses: passes });
    }
  });

  // Distribute sessionPool evenly across studyDates (round robin, but front-load
  // first-pass sessions before second/third passes so the plan teaches breadth first)
  sessionPool.sort((a, b) => a.pass - b.pass);

  const perDaySessions = Math.max(1, Math.round(sessionPool.length / studyDates.length));
  const assignments = studyDates.map(d => ({ date: d, items: [] }));

  let poolIdx = 0;
  let dayIdx = 0;
  while (poolIdx < sessionPool.length) {
    const slot = assignments[dayIdx % assignments.length];
    if (slot.items.length < perDaySessions || dayIdx >= assignments.length) {
      slot.items.push(sessionPool[poolIdx]);
      poolIdx++;
    }
    dayIdx++;
    if (dayIdx > assignments.length * 6) break; // safety
  }
  // If anything is left over (pool larger than capacity), append to last days
  while (poolIdx < sessionPool.length) {
    assignments[assignments.length - 1].items.push(sessionPool[poolIdx]);
    poolIdx++;
  }

  // Group into weeks (Mon-Sun blocks starting from today's week)
  const weeksMap = {};
  assignments.forEach(a => {
    const wIdx = Math.floor(daysBetween(today(), a.date) / 7);
    if (!weeksMap[wIdx]) weeksMap[wIdx] = [];
    weeksMap[wIdx].push(a);
  });
  const weeks = Object.keys(weeksMap).sort((a, b) => a - b).map(k => ({
    weekNum: parseInt(k) + 1,
    days: weeksMap[k],
  }));

  // Revision block — last N days, list all H-weight topics + spaced repetition note
  const revisionStart = addDays(examDate, -revisionDays);
  const revisionTopics = topics.filter(t => t.weight === "H" || t.weight === "M");

  return {
    weeks,
    totalDays: totalDaysToExam,
    studyDates,
    revisionDays,
    revisionStart,
    revisionTopics,
    totalSessions: sessionPool.length,
    perDaySessions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Screen
// ─────────────────────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(""); setLoading(true);
    try {
      if (mode === "signup") {
        await SB_AUTH.signUp(email, password);
        const session = await SB_AUTH.signInEmail(email, password);
        onAuth(session);
      } else {
        const session = await SB_AUTH.signInEmail(email, password);
        onAuth(session);
      }
    } catch (e) {
      setError(e.message || "Something went wrong");
    }
    setLoading(false);
  }

  const d = THEME;
  return (
    <div style={{ position: "fixed", inset: 0, background: d.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');"}</style>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ fontSize: 30, fontWeight: 900, color: d.t, marginBottom: 6, letterSpacing: "-0.05em", fontFamily: "'DM Serif Display',serif" }}>
          nevile<span style={{ color: d.a1 }}>te</span>
        </div>
        <div style={{ fontSize: 13, color: d.t3, marginBottom: 28 }}>your CFA exam roadmap. built for you.</div>

        <input placeholder="email" value={email} onChange={e => setEmail(e.target.value)}
          style={{ width: "100%", padding: "12px 14px", marginBottom: 10, borderRadius: 10, background: d.card, border: "1px solid " + d.b, color: d.t, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
        <input placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={{ width: "100%", padding: "12px 14px", marginBottom: 14, borderRadius: 10, background: d.card, border: "1px solid " + d.b, color: d.t, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />

        {error && <div style={{ color: d.danger, fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <button onClick={submit} disabled={loading || !email || !password}
          style={{ width: "100%", padding: "13px", borderRadius: 10, background: d.a1, color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit", opacity: loading || !email || !password ? 0.5 : 1, marginBottom: 14 }}>
          {loading ? "..." : mode === "signup" ? "create account" : "sign in"}
        </button>

        <div style={{ textAlign: "center", fontSize: 12, color: d.t3 }}>
          {mode === "signup" ? "already have an account? " : "new here? "}
          <span onClick={() => setMode(mode === "signup" ? "signin" : "signup")} style={{ color: d.a1, cursor: "pointer", fontWeight: 600 }}>
            {mode === "signup" ? "sign in" : "create one"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exam Setup — level, window, study days, hours
// ─────────────────────────────────────────────────────────────────────────────
function ExamSetupScreen({ onComplete }) {
  const d = THEME;
  const [step, setStep] = useState(1);
  const [level, setLevel] = useState(null);
  const [examWindow, setExamWindow] = useState(null);
  const [studyDays, setStudyDays] = useState([0, 1, 2, 3, 4]); // Mon-Fri default
  const [dailyHours, setDailyHours] = useState(2);

  const cardStyle = { display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", border: "1.5px solid " + d.b, borderRadius: 12, cursor: "pointer", marginBottom: 8, background: d.card, transition: "border-color .15s" };
  const windows = level ? EXAM_WINDOWS[level] : [];
  const recommended = level ? RECOMMENDED_HOURS[level] : 300;

  function toggleDay(i) {
    setStudyDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort());
  }

  function Step({ title, sub, children }) {
    return (
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: d.t, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: d.t3, marginBottom: 22, lineHeight: 1.6 }}>{sub}</div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: d.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px", boxSizing: "border-box", overflowY: "auto", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 420, margin: "auto" }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 28 }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{ height: 3, flex: 1, borderRadius: 2, background: s <= step ? d.a1 : d.b, transition: "background .2s" }} />
          ))}
        </div>

        {step === 1 && (
          <Step title="which level are you taking?" sub="your roadmap is built around this level's real curriculum and weighting.">
            {[
              { id: "L1", label: "CFA Level 1", icon: "Ⅰ" },
              { id: "L2", label: "CFA Level 2", icon: "Ⅱ" },
              { id: "L3", label: "CFA Level 3", icon: "Ⅲ" },
            ].map(c => (
              <div key={c.id} style={cardStyle}
                onMouseOver={e => e.currentTarget.style.borderColor = d.bs}
                onMouseOut={e => e.currentTarget.style.borderColor = d.b}
                onClick={() => { setLevel(c.id); setExamWindow(null); setStep(2); }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: d.hover, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: d.a1, flexShrink: 0 }}>{c.icon}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: d.t }}>{c.label}</div>
              </div>
            ))}
          </Step>
        )}

        {step === 2 && (
          <Step title="when's your exam?" sub={"real CFA Institute windows for " + (level ? "CFA Level " + level.slice(1) : "")}>
            {windows.map(w => {
              const daysLeft = daysBetween(today(), w.start);
              return (
                <div key={w.id} style={cardStyle}
                  onMouseOver={e => e.currentTarget.style.borderColor = d.bs}
                  onMouseOut={e => e.currentTarget.style.borderColor = d.b}
                  onClick={() => { setExamWindow(w.id); setStep(3); }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: d.hover, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: d.a1, flexShrink: 0, lineHeight: 1.2 }}>
                    <span>{w.label.split(" ")[0].slice(0, 3).toUpperCase()}</span>
                    <span style={{ fontSize: 11 }}>{w.label.split(" ")[1]}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: d.t }}>{w.label}</div>
                    <div style={{ fontSize: 11, color: d.t3, marginTop: 1 }}>{daysLeft > 0 ? daysLeft + " days from today" : "window has passed"}</div>
                  </div>
                </div>
              );
            })}
            <button onClick={() => setStep(1)} style={{ background: "none", border: "none", color: d.t3, fontSize: 12, cursor: "pointer", marginTop: 8, fontFamily: "inherit" }}>← back</button>
          </Step>
        )}

        {step === 3 && (
          <Step title="which days can you study?" sub="be realistic — your roadmap will only schedule sessions on these days.">
            <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
              {DAYS.map((dn, i) => (
                <div key={dn} onClick={() => toggleDay(i)}
                  style={{
                    width: 46, height: 46, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", userSelect: "none",
                    background: studyDays.includes(i) ? d.a1 : d.card,
                    color: studyDays.includes(i) ? "#fff" : d.t3,
                    border: "1.5px solid " + (studyDays.includes(i) ? d.a1 : d.b),
                    transition: "all .15s",
                  }}>
                  {dn}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: d.t, marginBottom: 10 }}>hours per study day</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              {[1, 1.5, 2, 3, 4].map(h => (
                <div key={h} onClick={() => setDailyHours(h)}
                  style={{
                    flex: 1, padding: "10px 4px", borderRadius: 8, textAlign: "center", cursor: "pointer",
                    background: dailyHours === h ? d.a1 + "18" : d.card,
                    border: "1.5px solid " + (dailyHours === h ? d.a1 : d.b),
                    color: dailyHours === h ? d.a1 : d.t3, fontSize: 12.5, fontWeight: 700,
                  }}>
                  {h}h
                </div>
              ))}
            </div>

            {studyDays.length > 0 && (
              <div style={{ fontSize: 11.5, color: d.t3, marginBottom: 18, lineHeight: 1.6, fontStyle: "italic" }}>
                that's about {studyDays.length * dailyHours}h/week. CFA Institute candidates report averaging {recommended}+ hours total for {level ? "Level " + level.slice(1) : "this level"}.
              </div>
            )}

            <button
              disabled={studyDays.length === 0}
              onClick={() => onComplete({ level, examWindow, studyDays, dailyHours })}
              style={{ width: "100%", padding: "13px", borderRadius: 10, background: d.a1, color: "#fff", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit", opacity: studyDays.length === 0 ? 0.4 : 1 }}>
              build my roadmap →
            </button>
            <button onClick={() => setStep(2)} style={{ background: "none", border: "none", color: d.t3, fontSize: 12, cursor: "pointer", marginTop: 10, fontFamily: "inherit", display: "block", margin: "10px auto 0" }}>← back</button>
          </Step>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const d = THEME;

  const [authSession, setAuthSession] = useState(() => {
    try { const s = localStorage.getItem("nev_auth"); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  });
  const [authLoading, setAuthLoading] = useState(true);
  const user = authSession?.user;

  // Setup state
  const [setup, setSetup] = useState(() => {
    try { const s = localStorage.getItem("nev_setup"); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  });

  // Sessions (logged study time)
  const [sessions, setSessions] = useState(() => {
    try { const s = localStorage.getItem("nev_sessions"); return s ? JSON.parse(s) : []; } catch (e) { return []; }
  });
  useEffect(() => { try { localStorage.setItem("nev_sessions", JSON.stringify(sessions)); } catch (e) {} }, [sessions]);

  // Completed roadmap items (date|subject|topic|pass -> true)
  const [completed, setCompleted] = useState(() => {
    try { const s = localStorage.getItem("nev_completed"); return s ? JSON.parse(s) : {}; } catch (e) { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("nev_completed", JSON.stringify(completed)); } catch (e) {} }, [completed]);

  const [tab, setTab] = useState("today");
  const [dark, setDark] = useState(true);

  // Timer
  const [timerOn, setTimerOn] = useState(false);
  const [timerSec, setTimerSec] = useState(0);
  const [timerItem, setTimerItem] = useState(null); // {subject, topic}
  const timerRef = useRef(null);
  const timerStartRef = useRef(null);
  const timerBaseRef = useRef(0);

  useEffect(() => {
    if (timerOn) {
      timerStartRef.current = Date.now();
      timerBaseRef.current = timerSec;
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - timerStartRef.current) / 1000);
        setTimerSec(timerBaseRef.current + elapsed);
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [timerOn]);

  // Auth check on load
  useEffect(() => {
    (async () => {
      if (authSession?.access_token) {
        const u = await SB_AUTH.getUser(authSession.access_token);
        if (!u) { setAuthSession(null); try { localStorage.removeItem("nev_auth"); } catch (e) {} }
      }
      setAuthLoading(false);
    })();
  }, []);

  function handleAuthSuccess(session) {
    const stored = { access_token: session.access_token, refresh_token: session.refresh_token, user: session.user };
    setAuthSession(stored);
    try { localStorage.setItem("nev_auth", JSON.stringify(stored)); } catch (e) {}
  }
  function handleSignOut() {
    if (authSession?.access_token) SB_AUTH.signOut(authSession.access_token).catch(() => {});
    setAuthSession(null);
    try { localStorage.removeItem("nev_auth"); } catch (e) {}
  }
  function handleSetupComplete(s) {
    setSetup(s);
    try { localStorage.setItem("nev_setup", JSON.stringify(s)); } catch (e) {}
  }

  // Inject CSS
  useEffect(() => {
    let el = document.getElementById("nev-css");
    if (!el) { el = document.createElement("style"); el.id = "nev-css"; document.head.appendChild(el); }
    el.textContent = buildCSS(d);
  }, []);

  // Roadmap (memoized, recalculated when setup changes)
  const windowData = setup ? (EXAM_WINDOWS[setup.level] || []).find(w => w.id === setup.examWindow) : null;
  const examDate = windowData?.start;
  const roadmap = useMemo(() => {
    if (!setup || !examDate) return null;
    return generateRoadmap({ level: setup.level, examDate, studyDays: setup.studyDays, dailyHours: setup.dailyHours });
  }, [setup, examDate]);

  const daysLeft = examDate ? Math.max(0, daysBetween(today(), examDate)) : null;
  const totalMinutesLogged = sessions.reduce((a, s) => a + (s.duration || 0), 0);
  const totalHoursLogged = Math.round((totalMinutesLogged / 60) * 10) / 10;
  const targetHours = setup ? RECOMMENDED_HOURS[setup.level] : 300;
  const hoursRemaining = Math.max(0, targetHours - totalHoursLogged);

  function itemKey(date, item) { return date + "|" + item.subject + "|" + item.topic + "|" + item.pass; }

  function toggleComplete(date, item) {
    const key = itemKey(date, item);
    setCompleted(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key]; else next[key] = true;
      return next;
    });
  }

  function startTimer(item) {
    setTimerItem(item);
    setTimerSec(0);
    setTimerOn(true);
  }
  function stopTimer(markDone) {
    setTimerOn(false);
    const mins = Math.max(1, Math.round(timerSec / 60));
    if (timerItem) {
      setSessions(prev => [...prev, { id: Date.now(), subject: timerItem.subject, topic: timerItem.topic, duration: mins, date: today() }]);
      if (markDone && timerItem._date) toggleComplete(timerItem._date, timerItem);
    }
    setTimerItem(null);
    setTimerSec(0);
  }

  // ── Render gates ──────────────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ position: "fixed", inset: 0, background: d.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <div style={{ fontSize: 36 }}>📊</div>
      <div style={{ fontSize: 13, color: d.t3 }}>loading...</div>
    </div>
  );
  if (!authSession) return <AuthScreen onAuth={handleAuthSuccess} />;
  if (!setup) return <ExamSetupScreen onComplete={handleSetupComplete} />;

  const classLabel = "CFA Level " + setup.level.slice(1);

  // Today's roadmap items
  const todayItems = (roadmap?.weeks || []).flatMap(w => w.days).find(dd => dd.date === today())?.items || [];
  const isRevisionPhase = roadmap?.revisionStart && today() >= roadmap.revisionStart;

  return (
    <div style={{ minHeight: "100vh", background: d.bg, color: d.t, fontFamily: "'DM Sans',sans-serif" }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');"}</style>

      {/* Top bar */}
      <div className="topbar">
        <div className="brand">nevile<span style={{ color: d.a1 }}>te</span></div>
        <nav className="nav">
          {[
            { id: "today", label: "Today" },
            { id: "roadmap", label: "Roadmap" },
            { id: "progress", label: "Progress" },
          ].map(t => (
            <div key={t.id} className={"navitem" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</div>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="pill">{classLabel}</div>
          <button onClick={handleSignOut} className="iconbtn" title="sign out">⏻</button>
        </div>
      </div>

      {/* Timer overlay */}
      {timerOn && (
        <div className="timerbar">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Serif Display',serif", color: d.a2 }}>
              {String(Math.floor(timerSec / 3600)).padStart(2, "0")}:{String(Math.floor((timerSec % 3600) / 60)).padStart(2, "0")}:{String(timerSec % 60).padStart(2, "0")}
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: d.t }}>{timerItem?.topic}</div>
              <div style={{ fontSize: 10.5, color: d.t3 }}>{timerItem?.subject}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => stopTimer(true)} className="btn btnPrimary">stop & mark done</button>
            <button onClick={() => stopTimer(false)} className="btn btnGhost">just stop</button>
          </div>
        </div>
      )}

      <div className="inner">
        {/* ── TODAY ── */}
        {tab === "today" && (
          <div>
            <div className="hero">
              <div>
                <div className="eyebrow">{daysLeft !== null ? daysLeft + " days to " + windowData.label : "set your exam date"}</div>
                <div className="herotitle">{isRevisionPhase ? "Revision mode" : "What to study today"}</div>
                <div className="herosub">
                  {totalHoursLogged}h logged · {Math.round(hoursRemaining)}h to go · target {targetHours}h
                </div>
              </div>
              <div className="hero-ring">
                <svg width="92" height="92" viewBox="0 0 92 92">
                  <circle cx="46" cy="46" r="40" fill="none" stroke={d.b} strokeWidth="7" />
                  <circle cx="46" cy="46" r="40" fill="none" stroke={d.a1} strokeWidth="7"
                    strokeDasharray={2 * Math.PI * 40}
                    strokeDashoffset={2 * Math.PI * 40 * (1 - Math.min(1, totalHoursLogged / targetHours))}
                    strokeLinecap="round" transform="rotate(-90 46 46)" />
                </svg>
                <div className="hero-ring-label">{Math.min(100, Math.round((totalHoursLogged / targetHours) * 100))}%</div>
              </div>
            </div>

            {!setup.studyDays.includes(weekdayIndex(today())) && (
              <div className="notice">
                today isn't one of your study days — but if you've got time, every session counts. {todayItems.length === 0 && "no scheduled topics today."}
              </div>
            )}

            {todayItems.length === 0 && setup.studyDays.includes(weekdayIndex(today())) && (
              <div className="card empty">
                <div style={{ fontSize: 26, marginBottom: 8 }}>✓</div>
                <div className="et">nothing scheduled today</div>
                <div className="es">{isRevisionPhase ? "you're in the revision window — review weak topics freely." : "check the roadmap tab for what's coming up."}</div>
              </div>
            )}

            {todayItems.map((item, i) => {
              const key = itemKey(today(), item);
              const done = completed[key];
              const color = TOPIC_COLORS[item.subject];
              return (
                <div key={i} className="taskcard" style={{ opacity: done ? 0.5 : 1 }}>
                  <div onClick={() => toggleComplete(today(), item)} className="check" style={{ background: done ? d.a2 : "transparent", borderColor: done ? d.a2 : d.b }}>
                    {done && "✓"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: d.t, textDecoration: done ? "line-through" : "none" }}>{item.topic}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: color + "18", color, fontWeight: 700 }}>{item.subject}</span>
                      <span style={{ fontSize: 10, color: d.t3 }}>{item.weight === "H" ? "high weight" : item.weight === "M" ? "medium weight" : "lower weight"}</span>
                      {item.totalPasses > 1 && <span style={{ fontSize: 10, color: d.t4 }}>pass {item.pass}/{item.totalPasses}</span>}
                    </div>
                  </div>
                  {!done && (
                    <button onClick={() => startTimer({ ...item, _date: today() })} className="btn btnSmall" disabled={timerOn}>
                      ▶ start
                    </button>
                  )}
                </div>
              );
            })}

            {isRevisionPhase && roadmap?.revisionTopics?.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div className="sectionhead">High-priority revision topics</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
                  {roadmap.revisionTopics.map((t, i) => (
                    <div key={i} className="revchip" style={{ borderLeftColor: TOPIC_COLORS[t.subject] }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: d.t }}>{t.topic}</div>
                      <div style={{ fontSize: 10.5, color: d.t3, marginTop: 2 }}>{t.subject}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ROADMAP ── */}
        {tab === "roadmap" && (
          <div>
            <div className="sectionhead" style={{ marginBottom: 4 }}>Your full roadmap</div>
            <div style={{ fontSize: 12.5, color: d.t3, marginBottom: 24 }}>
              {roadmap?.totalDays} days total · {roadmap?.weeks?.length || 0} study weeks · last {roadmap?.revisionDays} days reserved for revision
            </div>

            {roadmap?.noStudyDays && (
              <div className="card empty">
                <div className="et">no study days selected</div>
                <div className="es">go back to setup and pick at least one day you can study.</div>
              </div>
            )}

            {(roadmap?.weeks || []).map(week => {
              const weekStart = week.days[0]?.date;
              const weekTopics = [...new Set(week.days.flatMap(dd => dd.items.map(it => it.subject)))];
              return (
                <div key={week.weekNum} className="weekblock">
                  <div className="weekhead">
                    <div className="weeknum">Week {week.weekNum}</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {weekTopics.map(s => (
                        <span key={s} style={{ fontSize: 9.5, padding: "2px 7px", borderRadius: 4, background: TOPIC_COLORS[s] + "18", color: TOPIC_COLORS[s], fontWeight: 700 }}>{s}</span>
                      ))}
                    </div>
                  </div>
                  <div className="weekdays">
                    {week.days.map(dd => {
                      const allDone = dd.items.length > 0 && dd.items.every(it => completed[itemKey(dd.date, it)]);
                      return (
                        <div key={dd.date} className="daycol">
                          <div className="daylabel">{dayName(dd.date)} <span style={{ color: d.t4 }}>{dd.date.slice(5)}</span></div>
                          {dd.items.map((item, i) => {
                            const done = completed[itemKey(dd.date, item)];
                            return (
                              <div key={i} className="miniItem" style={{ borderLeftColor: TOPIC_COLORS[item.subject], opacity: done ? 0.45 : 1 }}
                                onClick={() => toggleComplete(dd.date, item)}>
                                <span style={{ textDecoration: done ? "line-through" : "none" }}>{item.topic}</span>
                              </div>
                            );
                          })}
                          {dd.items.length === 0 && <div className="miniEmpty">—</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {roadmap?.revisionDays > 0 && (
              <div className="weekblock" style={{ borderColor: d.gold + "40" }}>
                <div className="weekhead">
                  <div className="weeknum" style={{ color: d.gold }}>Final Revision · {roadmap.revisionDays} days</div>
                </div>
                <div style={{ padding: "12px 16px", fontSize: 12.5, color: d.t2, lineHeight: 1.7 }}>
                  starting {roadmap.revisionStart}, every day is open for review. focus on high and medium weight topics — Ethics, Fixed Income, Equity, and FRA carry the most marks.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PROGRESS ── */}
        {tab === "progress" && (
          <div>
            <div className="sectionhead" style={{ marginBottom: 20 }}>Progress</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 24 }}>
              {[
                { l: "Hours Logged", v: totalHoursLogged + "h", c: d.a1 },
                { l: "Target", v: targetHours + "h", c: d.t2 },
                { l: "Days Left", v: daysLeft ?? "—", c: d.gold },
                { l: "Sessions", v: sessions.length, c: d.a2 },
              ].map(s => (
                <div key={s.l} className="card" style={{ textAlign: "center", padding: "16px 12px" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.c, fontFamily: "'DM Serif Display',serif" }}>{s.v}</div>
                  <div style={{ fontSize: 9.5, color: d.t3, marginTop: 4, textTransform: "uppercase", letterSpacing: ".05em" }}>{s.l}</div>
                </div>
              ))}
            </div>

            <div className="sectionhead" style={{ marginBottom: 12 }}>By topic</div>
            {Object.keys(TOPICS).map(sub => {
              const subTopics = TOPICS[sub][setup.level] || [];
              if (subTopics.length === 0) return null;
              const doneCount = subTopics.filter(t =>
                Object.keys(completed).some(k => k.includes("|" + sub + "|" + t + "|"))
              ).length;
              const pct = Math.round((doneCount / subTopics.length) * 100);
              const color = TOPIC_COLORS[sub];
              return (
                <div key={sub} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: d.t }}>{sub}</span>
                    <span style={{ fontSize: 11.5, color: d.t3 }}>{doneCount}/{subTopics.length}</span>
                  </div>
                  <div style={{ height: 6, background: d.b, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: pct + "%", background: color, borderRadius: 3, transition: "width .5s" }} />
                  </div>
                </div>
              );
            })}

            <div style={{ marginTop: 28 }}>
              <button onClick={() => { if (confirm("Reset your exam setup? This won't delete logged hours.")) { setSetup(null); try { localStorage.removeItem("nev_setup"); } catch (e) {} } }}
                className="btn btnGhost">
                edit exam setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
function buildCSS(d) {
  return `
    *{box-sizing:border-box;}
    html,body{margin:0;padding:0;background:${d.bg};overflow-x:hidden;}
    ::-webkit-scrollbar{width:8px;height:8px;}
    ::-webkit-scrollbar-thumb{background:${d.b};border-radius:4px;}

    .topbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:24px;padding:14px 28px;background:${d.sb}ee;backdrop-filter:blur(12px);border-bottom:1px solid ${d.b};}
    .brand{font-family:'DM Serif Display',serif;font-size:18px;font-weight:700;color:${d.t};letter-spacing:-0.04em;}
    .nav{display:flex;gap:4px;flex:1;}
    .navitem{padding:7px 14px;border-radius:8px;font-size:13px;font-weight:500;color:${d.t3};cursor:pointer;transition:all .15s;}
    .navitem:hover{color:${d.t};background:${d.hover};}
    .navitem.active{color:${d.a1};background:${d.a1}14;font-weight:700;}
    .pill{font-size:11px;padding:5px 12px;border-radius:20px;background:${d.a1}14;color:${d.a1};font-weight:700;border:1px solid ${d.a1}30;}
    .iconbtn{width:30px;height:30px;border-radius:8px;background:${d.hover};border:none;color:${d.t3};cursor:pointer;font-size:14px;}
    .iconbtn:hover{color:${d.danger};}

    .inner{max-width:880px;margin:0 auto;padding:32px 24px 80px;}

    .hero{display:flex;justify-content:space-between;align-items:center;padding:24px;background:${d.card};border-radius:16px;border:1px solid ${d.b};margin-bottom:24px;gap:16px;}
    .eyebrow{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${d.a1};margin-bottom:6px;}
    .herotitle{font-family:'DM Serif Display',serif;font-size:24px;color:${d.t};letter-spacing:-0.02em;margin-bottom:4px;}
    .herosub{font-size:12.5px;color:${d.t3};}
    .hero-ring{position:relative;width:92px;height:92px;flex-shrink:0;}
    .hero-ring-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:${d.t};}

    .notice{padding:12px 16px;border-radius:10px;background:${d.gold}10;border:1px solid ${d.gold}30;color:${d.t2};font-size:12.5px;margin-bottom:16px;line-height:1.6;}

    .card{background:${d.card};border:1px solid ${d.b};border-radius:12px;}
    .card.empty{text-align:center;padding:40px 24px;}
    .et{font-size:14px;font-weight:600;color:${d.t};margin-bottom:4px;}
    .es{font-size:12px;color:${d.t3};}

    .taskcard{display:flex;align-items:center;gap:14px;padding:14px 16px;background:${d.card};border:1px solid ${d.b};border-radius:12px;margin-bottom:8px;transition:opacity .2s;}
    .check{width:24px;height:24px;border-radius:7px;border:2px solid ${d.b};display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;color:#fff;font-size:13px;font-weight:700;transition:all .15s;}

    .btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:12.5px;font-weight:700;font-family:inherit;white-space:nowrap;}
    .btnPrimary{background:${d.a2};color:#06140f;}
    .btnGhost{background:${d.hover};color:${d.t2};}
    .btnSmall{background:${d.a1};color:#fff;padding:7px 14px;font-size:12px;}
    .btnSmall:disabled{opacity:.4;cursor:not-allowed;}

    .sectionhead{font-family:'DM Serif Display',serif;font-size:18px;color:${d.t};letter-spacing:-0.01em;}

    .revchip{padding:10px 12px;background:${d.card};border:1px solid ${d.b};border-left:3px solid;border-radius:8px;}

    .weekblock{background:${d.card};border:1px solid ${d.b};border-radius:14px;margin-bottom:16px;overflow:hidden;}
    .weekhead{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:${d.hover};border-bottom:1px solid ${d.b};flex-wrap:wrap;gap:8px;}
    .weeknum{font-size:13px;font-weight:700;color:${d.t};}
    .weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:${d.b};}
    .daycol{background:${d.card};padding:10px 8px;min-height:80px;}
    .daylabel{font-size:10px;font-weight:700;color:${d.t3};margin-bottom:6px;}
    .miniItem{font-size:10.5px;color:${d.t2};padding:4px 6px;margin-bottom:3px;background:${d.hover};border-radius:5px;border-left:2px solid;cursor:pointer;line-height:1.3;}
    .miniEmpty{font-size:10px;color:${d.t4};text-align:center;padding:10px 0;}

    .timerbar{position:sticky;top:53px;z-index:35;display:flex;justify-content:space-between;align-items:center;padding:14px 28px;background:${d.a2}10;border-bottom:1px solid ${d.a2}30;backdrop-filter:blur(8px);}

    @media(max-width:780px){
      .weekdays{grid-template-columns:1fr;}
      .daycol{border-bottom:1px solid ${d.b};}
    }
    @media(max-width:680px){
      .topbar{padding:12px 16px;gap:14px;}
      .nav{gap:0;}
      .navitem{padding:6px 10px;font-size:12px;}
      .pill{display:none;}
      .inner{padding:20px 14px 80px;}
      .hero{flex-direction:column;align-items:flex-start;}
      .timerbar{flex-direction:column;gap:10px;align-items:flex-start;padding:12px 16px;}
    }
  `;
}
