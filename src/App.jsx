import { useState, useEffect, useRef, useCallback } from "react";


const SB_URL  = "https://tlmazdrnndylafhfxsrc.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsbWF6ZHJubmR5bGFmaGZ4c3JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1ODEwNjAsImV4cCI6MjA4ODE1NzA2MH0.gGPknDEdaGfzDb2JJ2amEY9b33jlbTY3brvbbhvvIWg";
const OR_KEY  = "YOUR_OPENROUTER_KEY"; 
const SB_AUTH = {
  async signUp(email, password) {
    const r = await fetch(`${SB_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "apikey": SB_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || "Sign up failed");
    return d;
  },

  async signInEmail(email, password) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SB_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || d.msg || "Login failed");
    return d;
  },

  async signOut(accessToken) {
    await fetch(`${SB_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { "apikey": SB_ANON, "Authorization": `Bearer ${accessToken}` },
    });
  },

  async getUser(accessToken) {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { "apikey": SB_ANON, "Authorization": `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    return await r.json();
  },

  async loadData(table, userId, accessToken) {
    const r = await fetch(
      `${SB_URL}/rest/v1/${table}?user_id=eq.${userId}&select=*`,
      { headers: { "apikey": SB_ANON, "Authorization": `Bearer ${accessToken}` } }
    );
    if (!r.ok) return [];
    return await r.json();
  },
};
function parseMath(raw) {
 
  const out = [];
  let i = 0;
  const BSRE = /^\\([a-zA-Z]+|\^)/;

  function readBraced(from) {
   
    if (raw[from] !== '{') return ['', from];
    let depth = 1, j = from + 1, buf = '';
    while (j < raw.length && depth > 0) {
      if (raw[j] === '{') depth++;
      else if (raw[j] === '}') depth--;
      if (depth > 0) buf += raw[j];
      j++;
    }
    return [buf, j];
  }

  while (i < raw.length) {
    const ch = raw[i];

    
    if (ch === '\\') {
      const m = raw.slice(i).match(BSRE);
      if (!m) { pushTxt('\\'); i++; continue; }
      const cmd = m[1];
      i += 1 + cmd.length;

      if (cmd === 'frac') {
        const [num, i2] = readBraced(i);
        const [den, i3] = readBraced(i2);
        out.push({ t: 'frac', num, den });
        i = i3; continue;
      }
      if (cmd === 'sqrt') {
        const [inner, i2] = readBraced(i);
        out.push({ t: 'sqrt', inner });
        i = i2; continue;
      }
      // trig inverses: \tan^{-1}
      if ((cmd === 'tan' || cmd === 'sin' || cmd === 'cos') && raw.slice(i, i+4) === '^{-1') {
        out.push({ t: 'txt', v: cmd + '\u207b\u00b9' }); // ⁻¹
        i += 5; continue; // skip ^{-1}
      }
      const SYMS = {
        alpha:'α',beta:'β',gamma:'γ',delta:'δ',Delta:'Δ',theta:'θ',phi:'φ',
        pi:'π',omega:'ω',Omega:'Ω',mu:'μ',lambda:'λ',sigma:'σ',epsilon:'ε',
        rho:'ρ',eta:'η',xi:'ξ',zeta:'ζ',Lambda:'Λ',Gamma:'Γ',Phi:'Φ',Psi:'Ψ',
        tau:'τ',nu:'ν',kappa:'κ',
        tan:'tan',sin:'sin',cos:'cos',log:'log',ln:'ln',
        arctan:'tan⁻¹',arcsin:'sin⁻¹',arccos:'cos⁻¹',
        rightarrow:'→',leftarrow:'←',to:'→',Rightarrow:'⇒',leftrightarrow:'↔',rightleftharpoons:'⇌',
        times:'×',cdot:'·',div:'÷',leq:'≤',geq:'≥',neq:'≠',
        approx:'≈',infty:'∞',pm:'±',mp:'∓',circ:'°',degree:'°',
        int:'∫',sum:'Σ',prod:'Π',partial:'∂',nabla:'∇',
        forall:'∀',exists:'∃',
      };
      pushTxt(SYMS[cmd] ?? '');
      continue;
    }

    // superscript  ^{...} or ^digit
    if (ch === '^') {
      if (raw[i+1] === '{') {
        const [val, i2] = readBraced(i+1);
        out.push({ t: 'sup', v: val });
        i = i2; continue;
      }
      if (/\d/.test(raw[i+1])) { out.push({ t: 'sup', v: raw[i+1] }); i+=2; continue; }
    }

    // subscript  _{...} or _digit
    if (ch === '_') {
      if (raw[i+1] === '{') {
        const [val, i2] = readBraced(i+1);
        out.push({ t: 'sub', v: val });
        i = i2; continue;
      }
      if (/\d/.test(raw[i+1])) { out.push({ t: 'sub', v: raw[i+1] }); i+=2; continue; }
    }

    pushTxt(ch); i++;
  }

  function pushTxt(c) {
    const last = out[out.length - 1];
    if (last && last.t === 'txt') last.v += c;
    else out.push({ t: 'txt', v: c });
  }

  return out;
}

function MathText({ t, style }) {
  if (!t) return null;
  const tokens = parseMath(t);
  return (
    <span style={style}>
      {tokens.map((tok, i) => {
        if (tok.t === 'txt') return <span key={i}>{tok.v}</span>;

        if (tok.t === 'sup') return (
          <sup key={i} style={{fontSize:'0.72em',lineHeight:0,verticalAlign:'super',position:'relative',top:'-0.3em'}}>
            <MathText t={tok.v}/>
          </sup>
        );

        if (tok.t === 'sub') return (
          <sub key={i} style={{fontSize:'0.72em',lineHeight:0,verticalAlign:'sub',position:'relative',bottom:'-0.2em'}}>
            <MathText t={tok.v}/>
          </sub>
        );

        if (tok.t === 'sqrt') return (
          <span key={i} style={{display:'inline-flex',alignItems:'stretch',verticalAlign:'middle',margin:'0 1px'}}>
            <span style={{fontSize:'1.2em',lineHeight:1,paddingRight:1,alignSelf:'center'}}>√</span>
            <span style={{borderTop:'1.5px solid currentColor',paddingTop:1,paddingLeft:2,paddingRight:3}}>
              <MathText t={tok.inner}/>
            </span>
          </span>
        );

        if (tok.t === 'frac') return (
          <span key={i} style={{
            display:'inline-flex',flexDirection:'column',alignItems:'center',
            verticalAlign:'middle',margin:'0 3px',lineHeight:1.15,
          }}>
            <span style={{
              borderBottom:'1.5px solid currentColor',
              paddingBottom:2,paddingLeft:4,paddingRight:4,
              whiteSpace:'nowrap',textAlign:'center',fontSize:'0.88em',
            }}>
              <MathText t={tok.num}/>
            </span>
            <span style={{
              paddingTop:2,paddingLeft:4,paddingRight:4,
              whiteSpace:'nowrap',textAlign:'center',fontSize:'0.88em',
            }}>
              <MathText t={tok.den}/>
            </span>
          </span>
        );

        return null;
      })}
    </span>
  );
}

// Plain-text fallback for non-JSX contexts (list views, etc.)
function renderMath(text) {
  if (!text) return text;
  return text
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g,'($1)/($2)')
    .replace(/\\sqrt\{([^}]+)\}/g,'√($1)').replace(/\\sqrt(?![{])/g,'√')
    .replace(/\^\{([^}]+)\}/g,(_,p)=>{const m={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','n':'ⁿ','-':'⁻'};return p.split('').map(c=>m[c]||c).join('');})
    .replace(/\^(\d)/g,(_,d)=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[d])
    .replace(/\_\{([^}]+)\}/g,(_,s)=>{const m={'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'};return s.split('').map(c=>m[c]||c).join('');})
    .replace(/_(\d)/g,(_,d)=>'₀₁₂₃₄₅₆₇₈₉'[d])
    .replace(/\\arctan/g,'tan⁻¹').replace(/\\arcsin/g,'sin⁻¹').replace(/\\arccos/g,'cos⁻¹')
    .replace(/\\tan\^{-1}/g,'tan⁻¹').replace(/\\sin\^{-1}/g,'sin⁻¹').replace(/\\cos\^{-1}/g,'cos⁻¹')
    .replace(/\\alpha/g,'α').replace(/\\beta/g,'β').replace(/\\gamma/g,'γ').replace(/\\delta/g,'δ')
    .replace(/\\Delta/g,'Δ').replace(/\\theta/g,'θ').replace(/\\phi/g,'φ').replace(/\\pi/g,'π')
    .replace(/\\omega/g,'ω').replace(/\\Omega/g,'Ω').replace(/\\mu/g,'μ').replace(/\\lambda/g,'λ')
    .replace(/\\sigma/g,'σ').replace(/\\epsilon/g,'ε').replace(/\\rho/g,'ρ')
    .replace(/\\to(?![a-z])/g,'→').replace(/\\rightarrow/g,'→').replace(/\\rightleftharpoons/g,'⇌').replace(/\\times/g,'×')
    .replace(/\\leq/g,'≤').replace(/\\geq/g,'≥').replace(/\\neq/g,'≠').replace(/\\approx/g,'≈')
    .replace(/\\infty/g,'∞').replace(/\\pm/g,'±').replace(/\\cdot/g,'·')
    .replace(/\\int/g,'∫').replace(/\\sum/g,'Σ').replace(/\\partial/g,'∂')
    .replace(/\\[a-zA-Z]+/g,'');
}



// ─────────────────────────────────────────────────────────────────────────────
// NTA SIMULATION — Practice Tab
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SLOTHR — NTA JEE MAINS SIMULATION
// Plug this into slothr-v2.jsx: replace the Practice tab content with <NTAMode/>
// Students add their own questions via the admin panel (slothr-admin.jsx)
// ─────────────────────────────────────────────────────────────────────────────

// ── Utility functions ────────────────────────────────────────────────────────
const fmt  = m=>{if(m==null||m<0)return"0m";if(m===0)return"0m";return m<60?m+"m":Math.floor(m/60)+"h"+(m%60>0?" "+m%60+"m":"");};
const fmtT = s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;return h>0?`${h}:${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(sc).padStart(2,"0")}`;};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function calcStreak(sessions){const days=[...new Set(sessions.map(s=>s.date))].sort().reverse();if(!days.length)return 0;let streak=0,cur=new Date();cur.setHours(0,0,0,0);for(const d of days){const dd=new Date(d);dd.setHours(0,0,0,0);if(Math.round((cur-dd)/86400000)<=1){streak++;cur=dd;}else break;}return streak;}

// ── Select component ──────────────────────────────────────────────────────────
function Select({value,onChange,options,placeholder,disabled,d,minWidth}){
  return(
    <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}
      style={{background:d?d.inp:"#1a1816",border:`1px solid ${d?d.b:"rgba(255,255,255,0.07)"}`,
        color:d?d.t:"#f5f0e8",borderRadius:5,padding:"7px 10px",fontSize:13,
        fontFamily:"inherit",cursor:"pointer",minWidth:minWidth||120,outline:"none"}}>
      {placeholder&&<option value="">{placeholder}</option>}
      {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
    </select>
  );
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const THEME = {
  dark:{
    bg:"#0e0d0b",sb:"#0a0908",card:"#161410",hover:"#1c1a17",
    b:"rgba(255,255,255,0.07)",bs:"rgba(255,255,255,0.14)",
    t:"#f5f0e8",t2:"#c8c0b0",t3:"#8a8070",t4:"#4a4540",
    a1:"#e8723c",a2:"#4d9e78",a3:"#7a8fc2",
    inp:"#1a1816",ring:"#e8723c",danger:"#d4604a",
  },
  light:{
    bg:"#f7f4ee",sb:"#f0ece3",card:"#ffffff",hover:"#f0ece3",
    b:"rgba(0,0,0,0.08)",bs:"rgba(0,0,0,0.16)",
    t:"#1a1510",t2:"#4a4035",t3:"#8a7a6a",t4:"#c0b8a8",
    a1:"#d4612a",a2:"#3d8a63",a3:"#5b6fa8",
    inp:"#f7f4ee",ring:"#d4612a",danger:"#c44a35",
  },
};





// ── Placeholder papers — replace questions with real ones from your DB ────────
const SUBJECT_COLORS = { Physics:"#e8845c", Chemistry:"#5eaa8a", Mathematics:"#7b8ec8" };
const TOPICS = {
  Physics:{
    "11th":["Kinematics","Laws of Motion","Work & Energy","Rotational Motion","Gravitation","Thermodynamics","Waves","Oscillations","Properties of Matter","Kinetic Theory"],
    "12th":["Electrostatics","Current Electricity","Magnetism","EMI & AC","Optics","Modern Physics","Semiconductors","Dual Nature","Atoms & Nuclei","Communication"],
    dropper:["Kinematics","Laws of Motion","Work & Energy","Rotational Motion","Gravitation","Thermodynamics","Waves","Oscillations","Electrostatics","Current Electricity","Magnetism","EMI & AC","Optics","Modern Physics","Semiconductors"]
  },
  Chemistry:{
    "11th":["Mole Concept","Atomic Structure","Chemical Bonding","States of Matter","Thermodynamics","Equilibrium","Redox","Organic Basics","Hydrocarbons","s-Block Elements"],
    "12th":["Electrochemistry","Chemical Kinetics","Solutions","Surface Chemistry","p-Block Elements","d-Block Elements","Coordination Compounds","Haloalkanes","Alcohols","Amines"],
    dropper:["Mole Concept","Atomic Structure","Chemical Bonding","Thermodynamics","Equilibrium","Electrochemistry","Chemical Kinetics","Coordination Compounds","Organic Chemistry","p-Block Elements"]
  },
  Mathematics:{
    "11th":["Sets & Functions","Trigonometry","Sequences & Series","Straight Lines","Conic Sections","Permutations","Binomial Theorem","Limits","Statistics","Probability"],
    "12th":["Matrices","Determinants","Continuity & Differentiability","Applications of Derivatives","Integrals","Differential Equations","Vectors","3D Geometry","Probability","Linear Programming"],
    dropper:["Calculus","Algebra","Coordinate Geometry","Trigonometry","Vectors & 3D","Probability","Matrices","Complex Numbers","Sequences & Series","Differential Equations"]
  }
};
const JEE_WEIGHTAGE = {
  Physics:{"Kinematics":"M","Laws of Motion":"H","Work & Energy":"H","Rotational Motion":"H","Gravitation":"M","Thermodynamics":"H","Waves":"M","Oscillations":"H","Properties of Matter":"L","Kinetic Theory":"M","Electrostatics":"H","Current Electricity":"H","Magnetism":"H","EMI & AC":"H","Optics":"H","Modern Physics":"H","Semiconductors":"M","Dual Nature":"M","Atoms & Nuclei":"M","Communication":"L"},
  Chemistry:{"Mole Concept":"H","Atomic Structure":"H","Chemical Bonding":"H","States of Matter":"M","Thermodynamics":"H","Equilibrium":"H","Redox":"M","Organic Basics":"H","Hydrocarbons":"H","s-Block Elements":"L","Electrochemistry":"H","Chemical Kinetics":"H","Solutions":"M","Surface Chemistry":"L","p-Block Elements":"H","d-Block Elements":"H","Coordination Compounds":"H","Haloalkanes":"M","Alcohols":"M","Amines":"M","Organic Chemistry":"H"},
  Mathematics:{"Sets & Functions":"L","Trigonometry":"H","Sequences & Series":"M","Straight Lines":"M","Conic Sections":"H","Permutations":"M","Binomial Theorem":"M","Limits":"H","Statistics":"L","Probability":"H","Matrices":"M","Determinants":"M","Continuity & Differentiability":"H","Applications of Derivatives":"H","Integrals":"H","Differential Equations":"H","Vectors":"H","3D Geometry":"H","Linear Programming":"L","Calculus":"H","Algebra":"H","Coordinate Geometry":"H","Vectors & 3D":"H","Complex Numbers":"H"}
};
const CLASSES = [
  {id:"11th", label:"Class 11th", icon:"①"},
  {id:"12th", label:"Class 12th", icon:"②"},
  {id:"dropper", label:"Dropper", icon:"↻"},
];

const STREAK_MILESTONES = [
  {days:1,  icon:"🌱", label:"First Day"},
  {days:5,  icon:"🔥", label:"5 Day Streak"},
  {days:7,  icon:"⚡", label:"One Week"},
  {days:10, icon:"💪", label:"10 Days"},
  {days:15, icon:"🎯", label:"15 Days"},
  {days:21, icon:"🏆", label:"3 Weeks"},
  {days:30, icon:"👑", label:"30 Days"},
  {days:50, icon:"💎", label:"50 Days"},
  {days:100,icon:"🦥", label:"100 Days"},
];

const TABS=[
  {id:"overview",label:"Overview",icon:"⌂"},
  {id:"coach",label:"Analytics",icon:"👁"},
  {id:"goals",label:"today's goals",icon:"◎"},
  {id:"pyq",label:"Practice",icon:"◈"},
  {id:"sessions",label:"Sessions",icon:"◷"},
  {id:"streaks",label:"Streaks",icon:"🔥"},
  {id:"syllabus",label:"Syllabus",icon:"📋"},
];

const PAPERS = [
  // ── 2024 ─────────────────────────────────────────────────────────────────
  {
    id:"adv-2024-p1",
    year:"2024", exam:"JEE Advanced", session:"Paper 1",
    shift:"Morning (9:00 AM – 12:00 PM)", date:"26 May 2024",
    duration:180, status:"available",
  },
  {
    id:"adv-2024-p2",
    year:"2024", exam:"JEE Advanced", session:"Paper 2",
    shift:"Afternoon (2:30 PM – 5:30 PM)", date:"26 May 2024",
    duration:180, status:"available",
  },
  // ── 2023 ─────────────────────────────────────────────────────────────────
  {
    id:"adv-2023-p1",
    year:"2023", exam:"JEE Advanced", session:"Paper 1",
    shift:"Morning (9:00 AM – 12:00 PM)", date:"04 Jun 2023",
    duration:180, status:"available",
  },
  {
    id:"adv-2023-p2",
    year:"2023", exam:"JEE Advanced", session:"Paper 2",
    shift:"Afternoon (2:30 PM – 5:30 PM)", date:"04 Jun 2023",
    duration:180, status:"available",
  },
  // ── 2022 ─────────────────────────────────────────────────────────────────
  {
    id:"adv-2022-p1",
    year:"2022", exam:"JEE Advanced", session:"Paper 1",
    shift:"Morning (9:00 AM – 12:00 PM)", date:"28 Aug 2022",
    duration:180, status:"available",
  },
  {
    id:"adv-2022-p2",
    year:"2022", exam:"JEE Advanced", session:"Paper 2",
    shift:"Afternoon (2:30 PM – 5:30 PM)", date:"28 Aug 2022",
    duration:180, status:"available",
  },
  // ── 2025 ─────────────────────────────────────────────────────────────────
  {
    id:"adv-2025-p1",
    year:"2025", exam:"JEE Advanced", session:"Paper 1",
    shift:"Morning (9:00 AM – 12:00 PM)", date:"18 May 2025",
    duration:180, status:"available",
  },
  {
    id:"adv-2025-p2",
    year:"2025", exam:"JEE Advanced", session:"Paper 2",
    shift:"Afternoon (2:30 PM – 5:30 PM)", date:"18 May 2025",
    duration:180, status:"available",
  },

];



const SECTIONS = ["Physics","Chemistry","Mathematics"];
const SEC_COLOR = {Physics:"#e8845c", Chemistry:"#5eaa8a", Mathematics:"#7b8ec8"};
const SEC_SHORT = {Physics:"PHY", Chemistry:"CHEM", Mathematics:"MATH"};


function getNTA(dark){
  if(!dark) return {
   
    bg:"#f5f5f5",
    header:"#1a7c3e",        
    headerText:"#ffffff",
    subBar:"#f47920",        
    subBarText:"#ffffff",
    subBarActive:"#ffffff",
    subBarActiveBg:"rgba(255,255,255,.18)",
    card:"#ffffff",
    border:"#d0d0d0",
    border2:"#aaaaaa",
    text:"#1a1a1a",
    text2:"#333333",
    text3:"#666666",
    text4:"#999999",
    hover:"#f0f0f0",
    // Palette 
    notVisited:"#9e9e9e",
    notAnswered:"#e53935",
    answered:"#43a047",
    markedReview:"#7b1fa2",
    answeredMarked:"#7b1fa2",
    // Timer
    timerNormal:"#1a7c3e",
    timerWarn:"#e53935",
    // Buttons
    btnPrimary:"#1a7c3e",
    btnSave:"#43a047",
    btnClear:"#e53935",
    btnMark:"#7b1fa2",
    btnNext:"#1a7c3e",
    btnSecondary:"#ffffff",
    btnSecondaryText:"#333333",
    // Result
    scoreGood:"#1a7c3e",
    scoreMid:"#f47920",
    scoreBad:"#e53935",
  };
  // Dark mode — same identity, darker surfaces
  return {
    bg:"#0d0d0c",
    header:"#1a5c2e",
    headerText:"#ffffff",
    subBar:"#c45e0a",
    subBarText:"#ffffff",
    subBarActive:"#ffffff",
    subBarActiveBg:"rgba(255,255,255,.15)",
    card:"#1a1a18",
    border:"#2a2a28",
    border2:"#3a3a38",
    text:"#f0f0ee",
    text2:"#ccccca",
    text3:"#888886",
    text4:"#555553",
    hover:"#222220",
    notVisited:"#555553",
    notAnswered:"#c62828",
    answered:"#2e7d32",
    markedReview:"#6a1b9a",
    answeredMarked:"#6a1b9a",
    timerNormal:"#4caf50",
    timerWarn:"#ef5350",
    btnPrimary:"#1a5c2e",
    btnSave:"#2e7d32",
    btnClear:"#c62828",
    btnMark:"#6a1b9a",
    btnNext:"#1a5c2e",
    btnSecondary:"#2a2a28",
    btnSecondaryText:"#ccccca",
    scoreGood:"#4caf50",
    scoreMid:"#ff9800",
    scoreBad:"#ef5350",
  };
}

function fmtTime(secs) {
  const h = Math.floor(secs/3600);
  const m = Math.floor((secs%3600)/60);
  const s = secs%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

// ── Question Status 

function getStatus(state) {
  if (!state.visited) return "notVisited";
  if (state.markedReview && state.answer !== null) return "answeredMarked";
  if (state.markedReview) return "markedReview";
  if (state.answer !== null) return "answered";
  return "notAnswered";
}

function statusColor(status, nta) {
  return {
    notVisited: nta.notVisited,
    notAnswered: nta.notAnswered,
    answered: nta.answered,
    markedReview: nta.markedReview,
    answeredMarked: nta.answeredMarked,
  }[status] || nta.notVisited;
}


function PaperList({onStart,onExit,nta,completedTests,onReview}){
  const years=[...new Set(PAPERS.map(p=>p.year))].sort().reverse();
  return(
    <div style={{background:nta.bg,fontFamily:"Arial,sans-serif",minHeight:"80vh"}}>
      {/* NTA-style green header */}
      <div style={{background:nta.header,padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18}}>🦥</span>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:"#fff",letterSpacing:"-.01em"}}>sloth<span style={{color:"#f47920"}}>r</span></div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.65)",letterSpacing:".04em",textTransform:"uppercase"}}>Mock Test Papers — JEE Advanced</div>
          </div>
        </div>
        <button onClick={onExit}
          style={{padding:"7px 16px",borderRadius:5,background:"rgba(255,255,255,.15)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",fontFamily:"Arial",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:".02em"}}>
          ← Back to slothr
        </button>
      </div>
      {/* Warning banner */}
      <div style={{background:nta.card,borderBottom:`2px solid #f47920`,padding:"8px 20px",display:"flex",alignItems:"center",gap:8}}>
        <span>⚠️</span>
        <span style={{fontSize:12,color:nta.text2}}>Once you click <strong>Attempt Test</strong>, the 3-hour timer starts immediately. Do not refresh the page.</span>
      </div>
      <div style={{padding:"20px"}}>
        <div style={{fontSize:16,fontWeight:700,color:nta.text,marginBottom:4}}>JEE Advanced — Mock Test Papers</div>
        <div style={{fontSize:12,color:nta.text3,marginBottom:20}}>54 questions · 3 hours · 180 marks per paper</div>
        {years.map(year=>(
          <div key={year} style={{marginBottom:28}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{fontSize:15,fontWeight:700,color:nta.header}}>{year}</div>
              <div style={{flex:1,height:1,background:nta.border}}/>
              <div style={{fontSize:10,color:nta.text3}}>{PAPERS.filter(p=>p.year===year).length} papers</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
              {PAPERS.filter(p=>p.year===year&&p.status==="available").map(paper=>(
                <PaperCard key={paper.id} paper={paper} onStart={onStart} nta={nta} completedTest={completedTests?.[paper.id]} onReview={onReview}/>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaperCard({paper,onStart,nta,completedTest,onReview}){
  const [hov,setHov]=useState(false);
  const avail=paper.status==="available";
  return(
    <div onMouseOver={()=>setHov(true)} onMouseOut={()=>setHov(false)}
      style={{background:nta.card,borderRadius:3,border:`1.5px solid ${hov&&avail?nta.header:nta.border}`,
        padding:"16px 18px",transition:"all .15s",boxShadow:hov&&avail?"0 4px 16px rgba(0,0,0,.12)":"0 1px 4px rgba(0,0,0,.06)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",
          color:nta.header,background:`${nta.header}12`,padding:"3px 8px",borderRadius:3}}>
          {paper.session}
        </div>
        {!avail&&<div style={{fontSize:10,color:nta.text3,background:nta.hover,padding:"3px 7px",borderRadius:3,border:`1px solid ${nta.border}`}}>coming soon</div>}
      </div>
      <div style={{fontSize:13,fontWeight:700,color:nta.text,marginBottom:2}}>{paper.shift}</div>
      <div style={{fontSize:11,color:nta.text3,marginBottom:12}}>{paper.date}</div>
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["54 Qs","Qs"],["3 hrs","Time"],["180","Marks"]].map(([v,l])=>(
          <div key={l} style={{flex:1,textAlign:"center",background:nta.hover,borderRadius:5,padding:"6px 4px",border:`1px solid ${nta.border}`}}>
            <div style={{fontSize:12,fontWeight:700,color:nta.header}}>{v}</div>
            <div style={{fontSize:9,color:nta.text3,textTransform:"uppercase",letterSpacing:".04em"}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:4,marginBottom:12}}>
        {SECTIONS.map(s=>(
          <div key={s} style={{flex:1,textAlign:"center",fontSize:9,fontWeight:700,color:SEC_COLOR[s],
            background:`${SEC_COLOR[s]}15`,padding:"3px 4px",borderRadius:3,border:`1px solid ${SEC_COLOR[s]}25`}}>
            {SEC_SHORT[s]}
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:7}}>
        <button disabled={!avail} onClick={()=>avail&&onStart(paper)}
          style={{flex:1,padding:"10px",borderRadius:5,
            background:avail?nta.btnPrimary:"#888",
            color:"#fff",border:"none",fontFamily:"Arial",
            fontSize:12,fontWeight:700,cursor:avail?"pointer":"not-allowed",letterSpacing:".02em"}}>
          {completedTest?"try again":avail?"▶ Attempt":"soon"}
        </button>
        {completedTest&&(
          <button onClick={()=>onReview(paper,completedTest)}
            style={{padding:"10px 14px",borderRadius:5,flexShrink:0,
              background:"transparent",color:nta.header,
              border:`1.5px solid ${nta.header}`,fontFamily:"Arial",
              fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
            Review ↗
          </button>
        )}
      </div>
      {completedTest&&(
        <div style={{marginTop:8,fontSize:10,color:nta.text3,textAlign:"center",fontStyle:"italic"}}>
          attempted {completedTest.date} · open the report card 🩻
        </div>
      )}
    </div>
  );
}

function InstructionsScreen({paper,user,onBegin,onBack,nta}){
  const [agreed,setAgreed]=useState(false);
  return(
    <div style={{background:nta.bg,fontFamily:"Arial,sans-serif",minHeight:"80vh"}}>
      <NTAHeader paper={paper} user={user} timerSecs={null} nta={nta} onExit={onBack}/>
      <div style={{maxWidth:860,margin:"0 auto",padding:"18px 16px"}}>
        {/* Instructions card */}
        <div style={{background:nta.card,border:`1px solid ${nta.border}`,borderRadius:4,overflow:"hidden",marginBottom:14}}>
          <div style={{background:nta.header,color:"#fff",padding:"9px 16px",fontSize:13,fontWeight:700}}>General Instructions</div>
          <div style={{padding:"14px 18px",lineHeight:1.9,color:nta.text,fontSize:12.5}}>
            {[
              "Total duration of JEE Advanced is 180 minutes (3 hours) per paper.",
              "The countdown timer at the top right shows the remaining time. The paper auto-submits when it reaches 00:00:00.",
              "There are 54 questions — 18 per section (Physics, Chemistry, Mathematics).",
              "Question types vary by section: Single Correct MCQ (+3/−1), Multiple Correct MCQ (+4/−2 partial), Numerical (+3/0). Check the question type label before answering.",
              "Click an option to select it. For numerical, type your integer/decimal answer in the input box.",
              "Click flag & next to flag a question. You can come back to it later.",
              "You can freely switch between sections and questions at any time.",
              "Click save & next to save your response and move forward.",
            ].map((line,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:3}}>
                <span style={{color:nta.header,fontWeight:700,flexShrink:0}}>{i+1}.</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Palette legend */}
        <div style={{background:nta.card,border:`1px solid ${nta.border}`,borderRadius:4,padding:"12px 18px",marginBottom:14}}>
          <div style={{fontWeight:700,marginBottom:10,color:nta.text,fontSize:13}}>Question Palette Legend</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:14}}>
            {[
              {c:"notVisited",  l:"Not Visited",       d:"You have not visited the question yet"},
              {c:"notAnswered", l:"Not Answered",       d:"Visited but no answer saved"},
              {c:"answered",    l:"Answered",           d:"Response saved"},
              {c:"markedReview",l:"Marked for Review",  d:"Flagged, no answer saved"},
              {c:"answeredMarked",l:"Answered + Marked",d:"Answered and flagged for review"},
            ].map(item=>(
              <div key={item.l} style={{display:"flex",alignItems:"center",gap:8,minWidth:220}}>
                <div style={{width:28,height:28,borderRadius:3,background:nta[item.c],flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,fontWeight:700}}>1</div>
                <div>
                  <div style={{fontWeight:600,fontSize:11.5,color:nta.text}}>{item.l}</div>
                  <div style={{fontSize:10.5,color:nta.text3}}>{item.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Agree */}
        <div style={{background:nta.card,border:`1px solid ${nta.border}`,borderRadius:4,padding:"12px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
          <input type="checkbox" id="agree" checked={agreed} onChange={e=>setAgreed(e.target.checked)}
            style={{width:15,height:15,cursor:"pointer",accentColor:nta.header}}/>
          <label htmlFor="agree" style={{cursor:"pointer",fontSize:13,fontWeight:500,color:nta.text}}>
            I have read all instructions carefully and I am ready to begin the test.
          </label>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onBack}
            style={{padding:"9px 22px",borderRadius:4,background:nta.btnSecondary,color:nta.btnSecondaryText,
              border:`1px solid ${nta.border2}`,fontFamily:"Arial",fontSize:12,fontWeight:700,cursor:"pointer"}}>
            ← Back
          </button>
          <button disabled={!agreed} onClick={onBegin}
            style={{padding:"9px 28px",borderRadius:4,background:agreed?nta.btnSave:"#888",
              color:"#fff",border:"none",fontFamily:"Arial",fontSize:12,fontWeight:700,
              cursor:agreed?"pointer":"not-allowed"}}>
            i'm ready
          </button>
        </div>
      </div>
    </div>
  );
}

function NTAHeader({paper,user,timerSecs,nta,onExit}){
  const warn=timerSecs!==null&&timerSecs<=900;
  return(
    <div style={{background:nta.header,color:"#fff",fontFamily:"Arial,sans-serif",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px",borderBottom:"1px solid rgba(255,255,255,.15)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>🦥</span>
          <div>
            <div style={{fontSize:13,fontWeight:700}}>sloth<span style={{color:"#f47920"}}>r</span></div>
            <div style={{fontSize:10,opacity:.7}}>{paper?.exam} — {paper?.session} · {paper?.date}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          {timerSecs!==null&&(
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:9,opacity:.7,letterSpacing:".06em",textTransform:"uppercase",marginBottom:1}}>Time Remaining</div>
              <div style={{fontSize:20,fontWeight:700,fontFamily:"'Courier New',monospace",
                color:warn?"#ff6b6b":"#fff",letterSpacing:".06em",
                animation:warn&&timerSecs%2===0?"ntaPulse .8s ease":undefined}}>
                {fmtTime(timerSecs)}
              </div>
            </div>
          )}
          {onExit&&(
            <button onClick={onExit}
              style={{padding:"6px 12px",borderRadius:4,background:"rgba(255,255,255,.15)",color:"#fff",
                border:"1px solid rgba(255,255,255,.3)",fontFamily:"Arial",fontSize:11,fontWeight:700,cursor:"pointer"}}>
              ✕ Exit
            </button>
          )}
        </div>
      </div>
      {/* Candidate bar */}
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"5px 14px",background:"rgba(0,0,0,.2)",fontSize:11}}>
        <div style={{width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,.2)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>
          {(user?.name||"S")[0].toUpperCase()}
        </div>
        <div>
          <span style={{fontWeight:600}}>{user?.name||"Student"}</span>
          <span style={{opacity:.6,marginLeft:8,fontSize:10}}>{user?.email||""}</span>
        </div>
        <div style={{marginLeft:"auto",fontSize:10,opacity:.75}}>
          {paper?.shift} · 54 Questions · 180 Marks
        </div>
      </div>
      <style>{`@keyframes ntaPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}

function ExamInterface({paper,user,questions,onSubmit,onExit,nta}){
  const TOTAL_SECS=paper.duration*60;
  const [timerSecs,setTimerSecs]=useState(TOTAL_SECS);
  const timerRef=useRef(null);
  const [section,setSection]=useState("Physics");
  const [qIndex,setQIndex]=useState(0);
  const [showPalette,setShowPalette]=useState(()=>typeof window!=="undefined"&&window.innerWidth>600);
  const [showSubmitModal,setShowSubmitModal]=useState(false);
  const [showExitModal,setShowExitModal]=useState(false);
  const [numericalInput,setNumericalInput]=useState("");
  const [qState,setQState]=useState(()=>{
    const s={};
    questions.forEach(q=>{s[q.id]={visited:false,answer:null,markedReview:false};});
    return s;
  });

  useEffect(()=>{
    timerRef.current=setInterval(()=>{
      setTimerSecs(t=>{
        if(t<=1){clearInterval(timerRef.current);onSubmit(qState);return 0;}
        return t-1;
      });
    },1000);
    return()=>clearInterval(timerRef.current);
  },[]);

  const sectionQs=questions.filter(q=>q.section===section);
  const currentQ=sectionQs[qIndex];
  const currentState=currentQ?qState[currentQ.id]:null;

  useEffect(()=>{
    if(!currentQ)return;
    setQState(prev=>({...prev,[currentQ.id]:{...prev[currentQ.id],visited:true}}));
    setNumericalInput(qState[currentQ.id]?.answer||"");
  },[currentQ?.id]);

  function setAnswer(ans){
    if(!currentQ)return;
    setQState(prev=>({...prev,[currentQ.id]:{...prev[currentQ.id],answer:ans,visited:true}}));
  }
  function clearResponse(){
    if(!currentQ)return;
    setQState(prev=>({...prev,[currentQ.id]:{...prev[currentQ.id],answer:null}}));
    setNumericalInput("");
  }
  function markForReview(){
    if(!currentQ)return;
    setQState(prev=>({...prev,[currentQ.id]:{...prev[currentQ.id],markedReview:true,visited:true}}));
    goNext();
  }
  function saveAndNext(){
    if(currentQ?.type==="numerical")setAnswer(numericalInput||null);
    goNext();
  }
  function goNext(){
    if(qIndex<sectionQs.length-1)setQIndex(q=>q+1);
    else{const ns=SECTIONS[(SECTIONS.indexOf(section)+1)%SECTIONS.length];setSection(ns);setQIndex(0);}
  }
  function goPrev(){if(qIndex>0)setQIndex(q=>q-1);}
  function jumpTo(sec,idx){setSection(sec);setQIndex(idx);}

  const stats=Object.values(qState);
  const answered=stats.filter(s=>s.answer!==null).length;
  const notAnswered=stats.filter(s=>s.visited&&s.answer===null&&!s.markedReview).length;
  const marked=stats.filter(s=>s.markedReview&&s.answer===null).length;
  const answeredMarked=stats.filter(s=>s.markedReview&&s.answer!==null).length;
  const notVisited=stats.filter(s=>!s.visited).length;

  return(
    <div style={{background:nta.bg,fontFamily:"Arial,sans-serif",display:"flex",flexDirection:"column",minHeight:"80vh"}}>
      <style>{`
        .nta-btn{padding:7px 16px;border-radius:3px;border:none;font-family:Arial,sans-serif;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.02em;transition:opacity .1s;}
        .nta-btn:hover{opacity:.85;}
        .nta-btn:disabled{opacity:.4;cursor:not-allowed;}
        .nta-num-input{width:110px;padding:7px 10px;border:2px solid ${nta.border2};border-radius:3px;font-size:13px;font-family:Arial;text-align:center;outline:none;background:${nta.card};color:${nta.text};}
        .nta-num-input:focus{border-color:${nta.header};}
        .pal-btn{width:34px;height:34px;border-radius:3px;border:none;color:#fff;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .1s;font-family:Arial;}
        .pal-btn:hover{transform:scale(1.1);}
        .nta-opt{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${nta.border};border-radius:3px;cursor:pointer;margin-bottom:7px;transition:all .1s;background:${nta.card};}
        .nta-opt:hover{border-color:${nta.header};background:${nta.hover};}
        .nta-opt.sel{border-color:${nta.header};background:${nta.hover};}
        .sec-tab-nta{padding:7px 18px;border:none;border-bottom:3px solid transparent;background:transparent;font-family:Arial;font-size:12px;font-weight:700;cursor:pointer;color:rgba(255,255,255,.7);transition:all .15s;}
        .sec-tab-nta.active{border-bottom-color:#fff;color:#fff;background:rgba(255,255,255,.15);}
        .sec-tab-nta:hover{color:#fff;background:rgba(255,255,255,.1);}
      `}</style>

      <NTAHeader paper={paper} user={user} timerSecs={timerSecs} nta={nta} onExit={()=>setShowExitModal(true)}/>

      {/* Section tabs — NTA orange bar */}
      <div style={{background:nta.subBar,display:"flex",alignItems:"center",flexShrink:0}}>
        {SECTIONS.map(sec=>{
          const secAns=questions.filter(q=>q.section===sec&&qState[q.id]?.answer!==null).length;
          const secTotal=questions.filter(q=>q.section===sec).length;
          return(
            <button key={sec} className={`sec-tab-nta${section===sec?" active":""}`}
              onClick={()=>{setSection(sec);setQIndex(0);}}>
              {sec} <span style={{fontSize:10,opacity:.8}}>({secAns}/{secTotal})</span>
            </button>
          );
        })}
        <button onClick={()=>setShowPalette(p=>!p)}
          style={{marginLeft:"auto",padding:"7px 14px",background:"rgba(0,0,0,.2)",border:"none",
            color:"#fff",fontFamily:"Arial",fontSize:11,cursor:"pointer",fontWeight:700}}>
          {showPalette?"hide":"show"}
        </button>
      </div>

      {/* Main 2-col layout */}
      <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>

        {/* ── Question area ── */}
        <div style={{flex:1,overflow:"auto",padding:"14px 18px"}}>
          {currentQ&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontWeight:700,color:nta.header,fontSize:13}}>
                  Question {currentQ.qno}
                  <span style={{marginLeft:8,fontSize:10.5,fontWeight:400,color:nta.text3,
                    padding:"2px 7px",background:nta.hover,borderRadius:3,border:`1px solid ${nta.border}`}}>
                    {currentQ.type==="mcq"?"MCQ · +4 / −1":"Integer · +4 / 0"}
                  </span>
                </div>
                <span style={{fontSize:11,color:SEC_COLOR[section],fontWeight:600}}>{section}</span>
              </div>

              {/* Question box */}
              <div style={{background:nta.card,border:`1px solid ${nta.border}`,borderRadius:3,
                padding:"16px 18px",marginBottom:14,lineHeight:1.85,color:nta.text,fontSize:13.5,fontFamily:"serif"}}>
                <MathText t={currentQ.text}/>
              </div>

              {/* MCQ options */}
              {currentQ.type==="mcq"&&currentQ.options&&(
                <div style={{marginBottom:14}}>
                  {Object.entries(currentQ.options).map(([opt,text])=>(
                    <div key={opt} className={`nta-opt${currentState?.answer===opt?" sel":""}`}
                      onClick={()=>setAnswer(opt)}>
                      <div style={{width:26,height:26,borderRadius:"50%",
                        background:currentState?.answer===opt?nta.header:nta.hover,
                        color:currentState?.answer===opt?"#fff":nta.text2,
                        border:`1.5px solid ${currentState?.answer===opt?nta.header:nta.border2}`,
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontWeight:700,fontSize:12,flexShrink:0}}>
                        {opt}
                      </div>
                      <span style={{fontSize:13,color:nta.text,lineHeight:1.5,fontFamily:"serif"}}><MathText t={text}/></span>
                    </div>
                  ))}
                </div>
              )}

              {/* Numerical input */}
              {currentQ.type==="numerical"&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,color:nta.text2,marginBottom:7}}>Enter your integer answer:</div>
                  <input className="nta-num-input" type="number" placeholder="—"
                    value={numericalInput}
                    onChange={e=>{setNumericalInput(e.target.value);setAnswer(e.target.value||null);}}/>
                </div>
              )}

              {/* Action buttons — exact NTA layout */}
              <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:10,paddingTop:10,borderTop:`1px solid ${nta.border}`}}>
                <button className="nta-btn" onClick={markForReview}
                  style={{background:nta.btnMark,color:"#fff"}}>
                  flag & next
                </button>
                <button className="nta-btn" onClick={clearResponse}
                  style={{background:nta.btnSecondary,color:nta.btnClear,border:`1.5px solid ${nta.btnClear}`}}>
                  Clear Response
                </button>
                <button className="nta-btn" onClick={saveAndNext}
                  style={{background:nta.btnSave,color:"#fff",marginLeft:"auto"}}>
                  save & next
                </button>
              </div>

              {/* Prev / Next / Submit */}
              <div style={{display:"flex",gap:7}}>
                <button className="nta-btn" onClick={goPrev}
                  disabled={qIndex===0&&section===SECTIONS[0]}
                  style={{background:nta.btnSecondary,color:nta.btnSecondaryText,border:`1px solid ${nta.border2}`}}>
                  ◀ Previous
                </button>
                <button className="nta-btn" onClick={goNext}
                  style={{background:nta.btnNext,color:"#fff"}}>
                  next
                </button>
                <button className="nta-btn" onClick={()=>setShowSubmitModal(true)}
                  style={{marginLeft:"auto",background:nta.btnClear,color:"#fff",padding:"7px 20px"}}>
                  Submit Paper
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Question palette ── */}
        {showPalette&&(
          <div style={{width:240,background:nta.card,borderLeft:`1px solid ${nta.border}`,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0}}>
            {/* Legend summary */}
            <div style={{padding:"9px 11px",borderBottom:`1px solid ${nta.border}`,background:nta.hover}}>
              <div style={{fontWeight:700,fontSize:11.5,color:nta.text,marginBottom:7}}>Question Palette</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:10}}>
                {[
                  {c:nta.answered,     l:"Answered",    v:answered},
                  {c:nta.notAnswered,  l:"Not Answered",v:notAnswered},
                  {c:nta.markedReview, l:"For Review",  v:marked},
                  {c:nta.answeredMarked,l:"Ans+Review", v:answeredMarked},
                  {c:nta.notVisited,   l:"Not Visited", v:notVisited},
                ].map(s=>(
                  <div key={s.l} style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:18,height:18,borderRadius:3,background:s.c,flexShrink:0,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff"}}>{s.v}</div>
                    <span style={{color:nta.text3,fontSize:9.5}}>{s.l}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Palette grid per section */}
            <div style={{flex:1,overflow:"auto",padding:"9px 11px"}}>
              {SECTIONS.map(sec=>{
                const secQs=questions.filter(q=>q.section===sec);
                return(
                  <div key={sec} style={{marginBottom:14}}>
                    <div style={{fontSize:10,fontWeight:700,color:SEC_COLOR[sec],marginBottom:7,
                      textTransform:"uppercase",letterSpacing:".05em"}}>{sec}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {secQs.map((q,idx)=>{
                        const st=qState[q.id];
                        const status=getStatus(st);
                        const isActive=section===sec&&qIndex===idx;
                        return(
                          <button key={q.id} className="pal-btn"
                            onClick={()=>jumpTo(sec,idx)}
                            style={{
                              background:statusColor(status,nta),
                              outline:isActive?`2.5px solid ${nta.text}`:"none",
                              outlineOffset:"2px",
                              position:"relative",
                            }}>
                            {q.qno}
                            {status==="answeredMarked"&&(
                              <div style={{position:"absolute",top:2,right:2,width:5,height:5,borderRadius:"50%",background:"#fff"}}/>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Submit modal */}
      {showSubmitModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999}}>
          <div style={{background:nta.card,borderRadius:3,padding:"26px 30px",maxWidth:420,width:"90%",textAlign:"center",boxShadow:"0 8px 40px rgba(0,0,0,.3)"}}>
            <div style={{fontSize:32,marginBottom:10}}>⚠️</div>
            <div style={{fontSize:17,fontWeight:700,color:nta.text,marginBottom:8}}>Submit Paper?</div>
            <div style={{fontSize:12.5,color:nta.text2,marginBottom:18,lineHeight:1.75}}>
              Answered: <strong style={{color:nta.answered}}>{answered}</strong> ·{" "}
              Not answered: <strong style={{color:nta.notAnswered}}>{notAnswered}</strong> ·{" "}
              Not visited: <strong style={{color:nta.notVisited}}>{notVisited}</strong><br/>
              This action cannot be undone.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={()=>setShowSubmitModal(false)} className="nta-btn"
                style={{background:nta.btnSecondary,color:nta.btnSecondaryText,border:`1px solid ${nta.border2}`,padding:"9px 22px"}}>Cancel</button>
              <button onClick={()=>{clearInterval(timerRef.current);onSubmit(qState);}} className="nta-btn"
                style={{background:nta.btnClear,color:"#fff",padding:"9px 26px",fontSize:13}}>Yes, Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Exit mid-exam modal */}
      {showExitModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999}}>
          <div style={{background:nta.card,borderRadius:3,padding:"26px 30px",maxWidth:400,width:"90%",textAlign:"center",boxShadow:"0 8px 40px rgba(0,0,0,.3)"}}>
            <div style={{fontSize:32,marginBottom:10}}>🚪</div>
            <div style={{fontSize:17,fontWeight:700,color:nta.text,marginBottom:8}}>Exit the exam?</div>
            <div style={{fontSize:12.5,color:nta.text2,marginBottom:18,lineHeight:1.75}}>
              Your progress will be lost. This test will not be counted.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={()=>setShowExitModal(false)} className="nta-btn"
                style={{background:nta.btnSave,color:"#fff",padding:"9px 22px"}}>stay</button>
              <button onClick={()=>{clearInterval(timerRef.current);onExit();}} className="nta-btn"
                style={{background:nta.btnSecondary,color:nta.btnSecondaryText,border:`1px solid ${nta.border2}`,padding:"9px 22px"}}>leave</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultScreen({paper,questions,qState,user,onRetry,onBack,nta,dark}){
  const [activeTab,setActiveTab]=useState("overview"); // overview | chapters | key
  const [keySection,setKeySection]=useState("Physics");
  const [keyFilter,setKeyFilter]=useState("all"); // all | wrong | unattempted
  const [expandedQ,setExpandedQ]=useState(null);
  const [fullscreenQ,setFullscreenQ]=useState(null);

  function calcScore(section=null){
    const qs=section?questions.filter(q=>q.section===section):questions;
    let correct=0,wrong=0,unattempted=0,marks=0;
    qs.forEach(q=>{
      const ans=qState[q.id]?.answer;
      if(!ans){unattempted++;}
      else if(ans===q.correct){correct++;marks+=4;}
      else{wrong++;if(q.type==="mcq")marks-=1;}
    });
    return{correct,wrong,unattempted,marks,total:qs.length};
  }

  const overall=calcScore();
  const secScores=SECTIONS.reduce((a,s)=>({...a,[s]:calcScore(s)}),{});
  const pct=Math.max(0,Math.round((overall.marks/180)*100));
  const scoreColor=pct>=60?nta.scoreGood:pct>=40?nta.scoreMid:nta.scoreBad;

  // ── Chapter breakdown — group wrong answers by topic ─────────────────────
  const chapterBreakdown=SECTIONS.reduce((acc,sec)=>{
    const secQs=questions.filter(q=>q.section===sec);
    const byTopic={};
    secQs.forEach(q=>{
      const topic=q.topic||"General";
      if(!byTopic[topic]) byTopic[topic]={topic,section:sec,correct:0,wrong:0,unattempted:0,total:0,questions:[]};
      const ans=qState[q.id]?.answer;
      byTopic[topic].total++;
      byTopic[topic].questions.push(q);
      if(!ans) byTopic[topic].unattempted++;
      else if(ans===q.correct) byTopic[topic].correct++;
      else byTopic[topic].wrong++;
    });
    acc[sec]=Object.values(byTopic).sort((a,b)=>b.wrong-a.wrong);
    return acc;
  },{});

  // Questions for answer key with filter
  const keyQs=questions.filter(q=>{
    if(q.section!==keySection) return false;
    const ans=qState[q.id]?.answer;
    if(keyFilter==="wrong") return ans!=null && ans!==q.correct;
    if(keyFilter==="unattempted") return !ans;
    return true;
  });

  const tabs=[
    {id:"overview",label:"Score Overview"},
    {id:"chapters",label:"Chapter Analysis"},
    {id:"key",label:"Answer Key & Solutions"},
  ];

  return(
    <div style={{background:nta.bg,fontFamily:"Arial,sans-serif",minHeight:"80vh"}}>
      <NTAHeader paper={paper} user={user} timerSecs={null} nta={nta} onExit={onBack}/>

      {/* ── Score banner — always visible ── */}
      <div style={{background:nta.header,padding:"16px 24px",display:"flex",alignItems:"center",gap:28,flexWrap:"wrap"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:11,color:"rgba(255,255,255,.65)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:2}}>Total Score</div>
          <div style={{fontSize:44,fontWeight:800,color:"#fff",lineHeight:1}}>{overall.marks}<span style={{fontSize:18,fontWeight:400,opacity:.6}}>/180</span></div>
        </div>
        <div style={{width:1,height:50,background:"rgba(255,255,255,.2)"}}/>
        {[{v:overall.correct,l:"Correct",c:"#81c784"},{v:overall.wrong,l:"Wrong",c:"#e57373"},{v:overall.unattempted,l:"Skipped",c:"rgba(255,255,255,.5)"}].map(s=>(
          <div key={s.l} style={{textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:700,color:s.c}}>{s.v}</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.6)",textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={onRetry} className="nta-btn"
            style={{background:"rgba(255,255,255,.15)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",padding:"8px 16px"}}>
            try again
          </button>
          <button onClick={onBack} className="nta-btn"
            style={{background:"rgba(255,255,255,.15)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",padding:"8px 16px"}}>
            ← All Papers
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{background:nta.subBar,display:"flex",borderBottom:`1px solid ${nta.border}`}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)}
            style={{padding:"10px 20px",border:"none",borderBottom:`3px solid ${activeTab===t.id?"#fff":"transparent"}`,
              background:"transparent",color:activeTab===t.id?"#fff":"rgba(255,255,255,.6)",
              fontFamily:"Arial",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .15s"}}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"20px 16px"}}>

        {/* ── TAB: SCORE OVERVIEW ── */}
        {activeTab==="overview"&&(
          <div>
            {/* Section cards */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
              {SECTIONS.map(sec=>{
                const s=secScores[sec];
                const sp=Math.max(0,(s.marks/Math.max(s.total*4,1))*100);
                const wrongQs=questions.filter(q=>q.section===sec&&qState[q.id]?.answer&&qState[q.id].answer!==q.correct);
                return(
                  <div key={sec} style={{background:nta.card,border:`1px solid ${nta.border}`,borderTop:`3px solid ${SEC_COLOR[sec]}`,borderRadius:3,padding:"16px"}}>
                    <div style={{fontSize:10,fontWeight:700,color:SEC_COLOR[sec],textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>{sec}</div>
                    <div style={{fontSize:32,fontWeight:800,color:nta.text,lineHeight:1}}>{s.marks}</div>
                    <div style={{fontSize:10,color:nta.text3,marginBottom:10}}>out of {s.total*4} marks</div>
                    <div style={{height:3,background:nta.border,marginBottom:10}}>
                      <div style={{height:"100%",width:`${sp}%`,background:SEC_COLOR[sec]}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:10}}>
                      <span style={{color:nta.answered}}>✓ {s.correct} correct</span>
                      <span style={{color:nta.notAnswered}}>✗ {s.wrong} wrong</span>
                      <span style={{color:nta.text3}}>— {s.unattempted} skipped</span>
                    </div>
                    {wrongQs.length>0&&(
                      <div style={{fontSize:10,color:nta.text3,borderTop:`1px solid ${nta.border}`,paddingTop:8}}>
                        <div style={{fontWeight:700,marginBottom:4,color:nta.notAnswered}}>Chapters with errors:</div>
                        {[...new Set(wrongQs.map(q=>q.topic||"General"))].slice(0,3).map(t=>(
                          <div key={t} style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                            <span>{t}</span>
                            <span style={{color:nta.notAnswered,fontWeight:700}}>
                              {wrongQs.filter(q=>(q.topic||"General")===t).length} wrong
                            </span>
                          </div>
                        ))}
                        {[...new Set(wrongQs.map(q=>q.topic||"General"))].length>3&&(
                          <div style={{color:nta.text3,marginTop:2}}>+{[...new Set(wrongQs.map(q=>q.topic||"General"))].length-3} more → see Chapter Analysis</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Marks breakdown */}
            <div style={{background:nta.card,border:`1px solid ${nta.border}`,borderRadius:3,padding:"16px 20px"}}>
              <div style={{fontWeight:700,fontSize:12,color:nta.text,marginBottom:12,letterSpacing:".04em",textTransform:"uppercase"}}>Marks Breakdown</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,textAlign:"center"}}>
                {[
                  {v:`+${overall.correct*4}`,l:"From Correct",c:nta.answered},
                  {v:`-${questions.filter(q=>qState[q.id]?.answer&&qState[q.id].answer!==q.correct&&q.type==="mcq").length}`,l:"Negative Marks",c:nta.notAnswered},
                  {v:`${overall.marks}`,l:"Net Score",c:scoreColor},
                  {v:`${pct}%`,l:"Percentile Est.",c:nta.text2},
                ].map(s=>(
                  <div key={s.l} style={{padding:"12px",background:nta.hover,borderRadius:3}}>
                    <div style={{fontSize:22,fontWeight:800,color:s.c}}>{s.v}</div>
                    <div style={{fontSize:10,color:nta.text3,marginTop:3}}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: CHAPTER ANALYSIS ── */}
        {activeTab==="chapters"&&(
          <div>
            <div style={{fontSize:12,color:nta.text3,marginBottom:16,fontStyle:"italic"}}>
              sorted by damage. fix the red ones first.
            </div>
            {SECTIONS.map(sec=>{
              const topics=chapterBreakdown[sec]||[];
              const hasErrors=topics.some(t=>t.wrong>0);
              return(
                <div key={sec} style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,paddingBottom:8,borderBottom:`2px solid ${SEC_COLOR[sec]}`}}>
                    <div style={{fontSize:13,fontWeight:700,color:SEC_COLOR[sec]}}>{sec}</div>
                    <div style={{fontSize:11,color:nta.text3}}>{secScores[sec].marks}/{secScores[sec].total*4} marks · {secScores[sec].wrong} wrong</div>
                  </div>
                  {!hasErrors&&(
                    <div style={{fontSize:12,color:nta.answered,padding:"10px 0",fontStyle:"italic"}}>✓ No wrong answers in {sec}. clean.</div>
                  )}
                  {topics.filter(t=>t.wrong>0||t.unattempted>0).map(t=>{
                    const pctRight=t.total?Math.round((t.correct/t.total)*100):0;
                    const statusC=t.wrong>0?nta.notAnswered:nta.text3;
                    return(
                      <div key={t.topic} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",
                        marginBottom:5,background:t.wrong>0?`${nta.notAnswered}0a`:nta.card,
                        border:"1px solid "+(t.wrong>0?nta.notAnswered+"30":nta.border),borderRadius:3}}>
                        <div style={{width:36,height:36,borderRadius:3,background:t.wrong>0?`${nta.notAnswered}15`:nta.hover,
                          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <span style={{fontSize:14,fontWeight:800,color:statusC}}>{t.wrong||"—"}</span>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12.5,fontWeight:600,color:nta.text,marginBottom:3}}>{t.topic}</div>
                          <div style={{display:"flex",gap:10,fontSize:10.5}}>
                            <span style={{color:nta.answered}}>✓ {t.correct} correct</span>
                            {t.wrong>0&&<span style={{color:nta.notAnswered,fontWeight:700}}>✗ {t.wrong} wrong</span>}
                            {t.unattempted>0&&<span style={{color:nta.text3}}>— {t.unattempted} skipped</span>}
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:16,fontWeight:700,color:pctRight>=70?nta.answered:pctRight>=40?nta.scoreMid:nta.notAnswered}}>{pctRight}%</div>
                          <div style={{fontSize:9,color:nta.text3}}>accuracy</div>
                        </div>
                      </div>
                    );
                  })}
                  {topics.filter(t=>t.wrong===0&&t.unattempted===0&&t.correct>0).map(t=>(
                    <div key={t.topic} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 14px",
                      marginBottom:3,opacity:.5}}>
                      <span style={{fontSize:11,color:nta.answered}}>✓</span>
                      <span style={{fontSize:11.5,color:nta.text2}}>{t.topic}</span>
                      <span style={{fontSize:10.5,color:nta.answered,marginLeft:"auto"}}>{t.correct}/{t.total} correct</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* ── TAB: ANSWER KEY ── */}
        {activeTab==="key"&&(
          <div>
            {/* Section + filter bar */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {SECTIONS.map(sec=>(
                  <button key={sec} onClick={()=>setKeySection(sec)}
                    style={{padding:"6px 14px",borderRadius:3,border:`1px solid ${keySection===sec?SEC_COLOR[sec]:nta.border}`,
                      background:keySection===sec?`${SEC_COLOR[sec]}15`:"transparent",
                      color:keySection===sec?SEC_COLOR[sec]:nta.text3,
                      fontFamily:"Arial",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                    {sec}
                  </button>
                ))}
              </div>
              <div style={{display:"flex",gap:4,marginLeft:"auto",flexWrap:"wrap"}}>
                {[["all","All"],["wrong","Wrong Only"],["unattempted","Skipped"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setKeyFilter(v)}
                    style={{padding:"5px 12px",borderRadius:3,border:`1px solid ${keyFilter===v?nta.header:nta.border}`,
                      background:keyFilter===v?`${nta.header}15`:"transparent",
                      color:keyFilter===v?nta.header:nta.text3,
                      fontFamily:"Arial",fontSize:10.5,fontWeight:600,cursor:"pointer"}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {keyQs.length===0&&(
              <div style={{textAlign:"center",padding:"32px",color:nta.text3,fontStyle:"italic"}}>
                okay you're actually good. don't let it go to your head. nothing to fix.
              </div>
            )}
            {keyQs.map(q=>{
              const userAns=qState[q.id]?.answer;
              const isCorrect=userAns===q.correct;
              const attempted=userAns!=null;
              const statusC=!attempted?nta.text3:isCorrect?nta.answered:nta.notAnswered;
              const statusLabel=!attempted?"skipped":isCorrect?"✓ correct":"✗ wrong";
              const marksLabel=!attempted?"±0":isCorrect?"+4":q.type==="mcq"?"−1":"±0";
              return(
                <div key={q.id}
                  onClick={()=>setFullscreenQ(q.id)}
                  style={{marginBottom:6,border:`1px solid ${nta.border}`,borderLeft:`4px solid ${statusC}`,
                    borderRadius:3,background:nta.card,cursor:"pointer",transition:"all .12s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background=dark?"rgba(255,255,255,.03)":"rgba(0,0,0,.015)";e.currentTarget.style.borderColor=statusC+"66";}}
                  onMouseLeave={e=>{e.currentTarget.style.background=nta.card;e.currentTarget.style.borderColor=nta.border;}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px"}}>
                    <span style={{fontSize:11,fontWeight:700,color:nta.text3,flexShrink:0,width:26,textAlign:"right"}}>Q{q.qno}</span>
                    <span style={{flex:1,fontSize:12.5,color:nta.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.text}</span>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                      {q.topic&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:`${SEC_COLOR[q.section]}18`,color:SEC_COLOR[q.section],fontWeight:700,whiteSpace:"nowrap"}}>{q.topic}</span>}
                      <span style={{fontSize:10,fontWeight:700,color:"#fff",background:statusC,padding:"2px 8px",borderRadius:3,whiteSpace:"nowrap"}}>{marksLabel}</span>
                      <span style={{fontSize:10.5,color:statusC,fontWeight:600,whiteSpace:"nowrap",minWidth:64,textAlign:"right"}}>{statusLabel}</span>
                      <span style={{fontSize:11,color:nta.text3,opacity:.4}}>↗</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── FULLSCREEN QUESTION MODAL ── */}
        {(()=>{
          if(!fullscreenQ)return null;
          const q=questions.find(x=>x.id===fullscreenQ);
          if(!q)return null;
          const userAns=qState[q.id]?.answer;
          const isCorrect=userAns===q.correct;
          const attempted=userAns!=null;
          const currentIdx=keyQs.findIndex(x=>x.id===fullscreenQ);
          const goPrev=()=>{if(currentIdx>0)setFullscreenQ(keyQs[currentIdx-1].id);};
          const goNext=()=>{if(currentIdx<keyQs.length-1)setFullscreenQ(keyQs[currentIdx+1].id);};
          const statusC=!attempted?nta.text3:isCorrect?nta.answered:nta.notAnswered;
          const bgC=dark?"#0e0d0b":"#f7f4ee";
          return(
            <div style={{position:"fixed",inset:0,zIndex:200,background:bgC,display:"flex",flexDirection:"column",overflowY:"auto"}}>
              {/* ── Sticky header ── */}
              <div style={{position:"sticky",top:0,zIndex:10,background:bgC,borderBottom:`1px solid ${nta.border}`,
                display:"flex",alignItems:"center",gap:10,padding:"11px 20px",flexShrink:0,flexWrap:"wrap"}}>
                <button onClick={()=>setFullscreenQ(null)}
                  style={{background:"transparent",border:`1px solid ${nta.border}`,borderRadius:3,padding:"6px 14px",
                    color:nta.text3,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"Arial",flexShrink:0}}>
                  ← Back
                </button>
                <div style={{flex:1,display:"flex",alignItems:"center",gap:7,overflow:"hidden",flexWrap:"wrap"}}>
                  <span style={{fontSize:12,fontWeight:700,color:nta.text3,flexShrink:0}}>Q{q.qno}</span>
                  {q.topic&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:`${SEC_COLOR[q.section]}18`,color:SEC_COLOR[q.section],fontWeight:700,flexShrink:0}}>{q.topic}</span>}
                  <span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:nta.hover,color:nta.text3,fontWeight:600,flexShrink:0}}>{q.section}</span>
                  <span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:nta.hover,color:nta.text3,fontWeight:600,flexShrink:0}}>{q.type==="mcq"?"MCQ":"Integer"}</span>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                  <button onClick={goPrev} disabled={currentIdx<=0}
                    style={{background:"transparent",border:`1px solid ${nta.border}`,borderRadius:3,padding:"6px 12px",
                      color:currentIdx<=0?nta.text3+"33":nta.text2,cursor:currentIdx<=0?"default":"pointer",fontSize:12,fontFamily:"Arial",transition:"all .1s"}}>
                    ← Prev
                  </button>
                  <span style={{fontSize:11,color:nta.text3,minWidth:40,textAlign:"center"}}>{currentIdx+1}/{keyQs.length}</span>
                  <button onClick={goNext} disabled={currentIdx>=keyQs.length-1}
                    style={{background:"transparent",border:`1px solid ${nta.border}`,borderRadius:3,padding:"6px 12px",
                      color:currentIdx>=keyQs.length-1?nta.text3+"33":nta.text2,cursor:currentIdx>=keyQs.length-1?"default":"pointer",fontSize:12,fontFamily:"Arial",transition:"all .1s"}}>
                    Next →
                  </button>
                </div>
              </div>

              {/* ── Body ── */}
              <div style={{maxWidth:760,width:"100%",margin:"0 auto",padding:"32px 20px 80px",flex:1,boxSizing:"border-box"}}>

                {/* Status banner */}
                <div style={{padding:"12px 18px",borderRadius:4,marginBottom:28,
                  background:!attempted?`${nta.text3}0e`:isCorrect?`${nta.answered}12`:`${nta.notAnswered}12`,
                  border:`1.5px solid ${!attempted?nta.text3+"30":isCorrect?nta.answered+"60":nta.notAnswered+"60"}`,
                  display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                  <span style={{fontSize:22,lineHeight:1}}>{!attempted?"—":isCorrect?"✓":"✗"}</span>
                  <span style={{fontSize:13,fontWeight:700,color:statusC,flex:1}}>
                    {!attempted?"skipped."
                      :isCorrect?"correct."
                      :"wrong."+(q.type==="mcq"?" −1 mark.":" no penalty.")}
                  </span>
                  {attempted&&!isCorrect&&(
                    <div style={{display:"flex",gap:16,fontSize:12,flexShrink:0}}>
                      <span style={{color:nta.text3}}>you marked: <strong style={{color:nta.notAnswered}}>{userAns}</strong></span>
                      <span style={{color:nta.text3}}>correct: <strong style={{color:nta.answered}}>{q.correct}</strong></span>
                    </div>
                  )}
                  {!attempted&&q.correct&&(
                    <span style={{fontSize:12,color:nta.text3,flexShrink:0}}>answer: <strong style={{color:nta.answered}}>{q.correct}</strong></span>
                  )}
                </div>

                {/* Question text */}
                <div style={{fontSize:16,color:nta.text,lineHeight:2.1,fontWeight:400,marginBottom:28,letterSpacing:"-.01em",fontFamily:"serif"}}>
                  <MathText t={q.text}/>
                </div>

                {/* MCQ options */}
                {q.type==="mcq"&&q.options&&(
                  <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:36}}>
                    {Object.entries(q.options).map(([key,val])=>{
                      const isCorrectOpt=key===q.correct;
                      const isUserOpt=key===userAns;
                      let bdr=`1.5px solid ${nta.border}`,optBg="transparent",textC=nta.text2,keyBg="transparent",keyC=nta.text3;
                      if(isCorrectOpt){bdr=`1.5px solid ${nta.answered}`;optBg=`${nta.answered}10`;textC=nta.answered;keyBg=nta.answered;keyC="#fff";}
                      if(isUserOpt&&!isCorrectOpt){bdr=`1.5px solid ${nta.notAnswered}`;optBg=`${nta.notAnswered}10`;textC=nta.notAnswered;keyBg=nta.notAnswered;keyC="#fff";}
                      return(
                        <div key={key} style={{display:"flex",alignItems:"flex-start",gap:14,padding:"14px 16px",borderRadius:4,border:bdr,background:optBg,transition:"none"}}>
                          <div style={{width:32,height:32,borderRadius:4,background:keyBg,
                            border:`1.5px solid ${isCorrectOpt?nta.answered:isUserOpt&&!isCorrectOpt?nta.notAnswered:nta.border}`,
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:13,fontWeight:700,color:keyC,flexShrink:0,marginTop:2}}>{key}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:14,color:textC,lineHeight:1.8,fontFamily:"serif"}}><MathText t={val}/></div>
                            {isCorrectOpt&&<div style={{fontSize:10,color:nta.answered,fontWeight:700,marginTop:5,letterSpacing:".05em",textTransform:"uppercase"}}>correct answer</div>}
                            {isUserOpt&&!isCorrectOpt&&<div style={{fontSize:10,color:nta.notAnswered,fontWeight:700,marginTop:5,letterSpacing:".05em",textTransform:"uppercase"}}>your answer</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Integer answer */}
                {q.type==="numerical"&&(
                  <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:36}}>
                    <div style={{padding:"14px 24px",borderRadius:4,border:`1.5px solid ${nta.answered}`,background:`${nta.answered}10`,minWidth:120}}>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:nta.text3,marginBottom:6}}>Correct</div>
                      <div style={{fontSize:24,fontWeight:700,color:nta.answered,fontVariantNumeric:"tabular-nums"}}>{q.correct}</div>
                    </div>
                    {attempted&&!isCorrect&&(
                      <div style={{padding:"14px 24px",borderRadius:4,border:`1.5px solid ${nta.notAnswered}`,background:`${nta.notAnswered}10`,minWidth:120}}>
                        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:nta.text3,marginBottom:6}}>You Entered</div>
                        <div style={{fontSize:24,fontWeight:700,color:nta.notAnswered,fontVariantNumeric:"tabular-nums"}}>{userAns}</div>
                      </div>
                    )}
                    {!attempted&&<div style={{fontSize:13,color:nta.text3,fontStyle:"italic",alignSelf:"center"}}>you didn't attempt this.</div>}
                  </div>
                )}

                {/* Divider */}
                <div style={{height:1,background:nta.border,marginBottom:28}}/>

                {/* Solution block */}
                <div>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:nta.text3,marginBottom:16}}>Solution</div>
                  {q.solution?(
                    <div style={{fontSize:14,color:nta.text2,lineHeight:2.1,whiteSpace:"pre-wrap",
                      background:nta.hover,padding:"22px 24px",borderRadius:4,
                      borderLeft:`4px solid ${nta.header}`}}>
                      {q.solution.split("\n").map((line,i)=><div key={i}><MathText t={line}/></div>)}
                    </div>
                  ):(
                    <div style={{padding:"24px",borderRadius:4,border:`1px dashed ${nta.border}`,textAlign:"center",background:nta.hover}}>
                      <div style={{fontSize:24,marginBottom:10,opacity:.4}}>📝</div>
                      <div style={{fontSize:13,color:nta.text3,marginBottom:4}}>no solution yet.</div>
                      <div style={{fontSize:11,color:nta.text3,opacity:.6}}>add it in the admin panel.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function NTAMode({user,dark,onExit,onTestComplete,completedTests,onStoreTest}){
  const nta=getNTA(dark);
  const [screen,setScreen]=useState("list");
  const [selectedPaper,setSelectedPaper]=useState(null);
  const [finalQState,setFinalQState]=useState(null);
  const [questions,setQuestions]=useState([]);
  const [qLoading,setQLoading]=useState(false);
  const [qError,setQError]=useState(null);

  async function fetchQuestions(paperId){
    setQLoading(true); setQError(null); setQuestions([]);
    try {
      // paperId e.g. "adv-2024-p1" — matches slug prefix in Supabase
      // We derive year + paper from the id
      const parts = paperId.split("-"); // ["adv","2024","p1"]
      const year  = parseInt(parts[1]);
      const paper = parts[2].toUpperCase(); // "P1" or "P2"
      const shift = paper==="P1"?"Morning":"Evening";

      const params = [
        "select=*",
        `year=eq.${year}`,
        `shift=eq.${shift}`,
        "exam=eq.JEE%20Advanced",
        "is_active=eq.true",
        "is_verified=eq.true",
        "order=qno.asc",
      ].join("&");
      const r = await fetch(`${SB_URL}/rest/v1/questions?${params}`, {
        headers:{"apikey":SB_ANON,"Authorization":"Bearer "+SB_ANON}
      });
      if(!r.ok) throw new Error(await r.text());
      const raw = await r.json();

      // Map Supabase columns → NTA question shape
      const mapped = raw.map(q=>({
        id:       q.id,
        section:  q.subject,           // Physics / Chemistry / Mathematics
        qno:      q.qno || 1,
        type:     q.question_type==="SCQ"?"mcq":
                  q.question_type==="MSQ"?"msq":
                  q.question_type==="Integer"||q.question_type==="Decimal"?"numerical":"mcq",
        text:     q.question_text,
        options:  q.option_a?{A:q.option_a,B:q.option_b,C:q.option_c,D:q.option_d}:null,
        correct:  q.correct,
        solution: q.solution,
        topic:    q.topic,
        difficulty: q.difficulty,
        diagram_url: q.diagram_url||null,
        answer_type: q.answer_type||"text",
        partial_marks: q.partial_marks||null,
      }));

      if(mapped.length===0) setQError("No questions found for this paper yet. Add them in the admin panel.");
      else setQuestions(mapped);
    } catch(e){ setQError("Failed to load questions: "+e.message); }
    setQLoading(false);
  }

  function handleStart(p){
    setSelectedPaper(p);
    fetchQuestions(p.id);
    setScreen("instructions");
  }
  function handleBegin(){setScreen("exam");}
  function handleSubmit(qs){
    setFinalQState(qs);
    setScreen("result");
    // Store completed test for later review
    if(onStoreTest && selectedPaper){
      onStoreTest(selectedPaper.id, {qState:qs, questions, date:new Date().toISOString().slice(0,10)});
    }
    // ── Calculate result and bubble up to App ──────────────────────────────
    if(onTestComplete && selectedPaper){
      const secScores={};
      let totalCorrect=0, totalWrong=0;
      ["Physics","Chemistry","Mathematics"].forEach(sec=>{
        const secQs=questions.filter(q=>q.section===sec);
        let correct=0,wrong=0,marks=0;
        secQs.forEach(q=>{
          const ans=qs[q.id]?.answer;
          if(!ans){}
          else if(ans===q.correct){correct++;marks+=4;totalCorrect++;}
          else{wrong++;totalWrong++;if(q.type==="mcq")marks-=1;}
        });
        secScores[sec]={correct,wrong,marks,outOf:secQs.length*4};
      });
      // Score out of 100 per section (for coach analysis compat)
      const toHundred=(sec)=>Math.max(0,Math.round((secScores[sec].marks/Math.max(1,secScores[sec].outOf))*100));
      onTestComplete({
        paper: selectedPaper,
        qState: qs,
        questions,
        secScores,
        // mock-compatible shape for coach
        mockEntry:{
          id: Date.now(),
          date: new Date().toISOString().slice(0,10),
          name: `${selectedPaper.exam} — ${selectedPaper.session} (${selectedPaper.shift.split(" ")[0]})`,
          physics: toHundred("Physics"),
          chemistry: toHundred("Chemistry"),
          math: toHundred("Mathematics"),
          source: "slothr_practice",
        },
        // pyqHistory entries — one per answered question
        pyqEntries: questions
          .filter(q=>qs[q.id]?.answer!=null)
          .map(q=>({
            qid: q.id,
            subject: q.section,
            topic: q.topic||"General",
            correct: qs[q.id].answer===q.correct,
            date: new Date().toISOString().slice(0,10),
            source: "nta_sim",
          })),
      });
    }
  }
  function handleRetry(){setFinalQState(null);setScreen("instructions");}
  function handleBack(){setSelectedPaper(null);setFinalQState(null);setScreen("list");}

  if(screen==="list")         return <PaperList onStart={handleStart} onExit={onExit} nta={nta} completedTests={completedTests} onReview={(paper,result)=>{setSelectedPaper(paper);setFinalQState(result.qState);if(result.questions?.length)setQuestions(result.questions);setScreen("result");}}/>;
  if(screen==="instructions"){
    if(qLoading) return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:16,background:nta.bg}}>
        <div style={{fontSize:22,animation:"pulse 1.2s infinite",color:nta.text1}}>loading questions...</div>
        <div style={{fontSize:12,color:nta.text3}}>fetching from database</div>
      </div>
    );
    if(qError) return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:16,background:nta.bg,padding:32,textAlign:"center"}}>
        <div style={{fontSize:32}}>😶</div>
        <div style={{fontSize:15,color:nta.text1,fontWeight:600}}>couldn't load questions</div>
        <div style={{fontSize:13,color:nta.text3,maxWidth:400}}>{qError}</div>
        <button onClick={()=>{fetchQuestions(selectedPaper.id);}} style={{padding:"10px 24px",background:nta.accent,color:"#fff",border:"none",borderRadius:8,fontSize:13,cursor:"pointer",marginTop:8}}>retry</button>
        <button onClick={handleBack} style={{padding:"8px 20px",background:"transparent",color:nta.text3,border:`1px solid ${nta.border}`,borderRadius:8,fontSize:13,cursor:"pointer"}}>← back</button>
      </div>
    );
    return <InstructionsScreen paper={selectedPaper} user={user} onBegin={handleBegin} onBack={handleBack} nta={nta}/>;
  }
  if(screen==="exam")         return <ExamInterface paper={selectedPaper} user={user} questions={questions} onSubmit={handleSubmit} onExit={handleBack} nta={nta}/>;
  if(screen==="result")       return <ResultScreen paper={selectedPaper} user={user} questions={questions} qState={finalQState} onRetry={handleRetry} onBack={handleBack} nta={nta} dark={dark}/>;
  return null;
}




// ── Auth Screen ───────────────────────────────────────────────────────────────
function AuthScreen({onAuth}) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if(!email||!password){setError("fill in both fields.");return;}
    if(password.length<6){setError("password must be at least 6 characters.");return;}
    setLoading(true); setError("");
    try {
      if(mode==="signup") {
        await SB_AUTH.signUp(email, password);
        setError("account created! log in now.");
        setMode("login"); setLoading(false); return;
      }
      const session = await SB_AUTH.signInEmail(email, password);
      const stored = {
        access_token:session.access_token, refresh_token:session.refresh_token,
        expires_at:Date.now()+(session.expires_in||3600)*1000, user:session.user,
      };
      localStorage.setItem("slothr_auth", JSON.stringify(stored));
      onAuth(stored);
    } catch(e) { setError(e.message); }
    setLoading(false);
  }

  const inp = {
    width:"100%", padding:"11px 14px", border:"1px solid rgba(255,255,255,.12)",
    borderRadius:8, background:"rgba(255,255,255,.06)", color:"#f5f0e8",
    fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box",
    WebkitAppearance:"none",
  };

  return (
    <div style={{
      position:"fixed", top:0, left:0, right:0, bottom:0, zIndex:9999,
      background:"#0e0d0b", display:"flex", alignItems:"center",
      justifyContent:"center", padding:"20px 16px", boxSizing:"border-box",
      fontFamily:"'DM Sans',sans-serif", overflowY:"auto",
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
      <div style={{width:"100%", maxWidth:380, margin:"auto"}}>
        <div style={{textAlign:"center", marginBottom:32}}>
          <div style={{fontSize:40, marginBottom:8}}>🦥</div>
          <div style={{fontSize:26, fontWeight:900, letterSpacing:"-.06em", color:"#f5f0e8", fontFamily:"'DM Serif Display',serif"}}>
            sloth<span style={{color:"#e8723c"}}>r</span>
          </div>
          <div style={{fontSize:12, color:"#8a8070", marginTop:4}}>your smartest situationship.</div>
        </div>
        <button onClick={()=>window.location.href=`${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.origin)}`}
          style={{width:"100%", padding:"12px", borderRadius:8, background:"#fff", color:"#1a1510",
            border:"none", fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:14,
            display:"flex", alignItems:"center", justifyContent:"center", gap:10,
            fontFamily:"inherit", boxSizing:"border-box"}}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/></svg>
          continue with Google
        </button>
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:14}}>
          <div style={{flex:1, height:1, background:"rgba(255,255,255,.08)"}}/>
          <span style={{fontSize:11, color:"#4a4540"}}>or</span>
          <div style={{flex:1, height:1, background:"rgba(255,255,255,.08)"}}/>
        </div>
        <div style={{marginBottom:10}}>
          <input style={inp} type="email" placeholder="email" value={email}
            onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
        </div>
        <div style={{marginBottom:14}}>
          <input style={inp} type="password" placeholder="password (min 6 chars)" value={password}
            onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
        </div>
        {error&&<div style={{fontSize:12, color:error.includes("created")?"#4d9e78":"#d4604a",
          marginBottom:12, textAlign:"center", lineHeight:1.5}}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading}
          style={{width:"100%", padding:"12px", borderRadius:8, background:"#e8723c",
            color:"#fff", border:"none", fontSize:14, fontWeight:700,
            cursor:loading?"not-allowed":"pointer", opacity:loading?.6:1,
            fontFamily:"inherit", boxSizing:"border-box"}}>
          {loading?"...":(mode==="login"?"log in":"sign up")}
        </button>
        <div style={{textAlign:"center", marginTop:14, fontSize:12, color:"#8a8070"}}>
          {mode==="login"?"no account? ":"have one? "}
          <span style={{color:"#e8723c", cursor:"pointer"}}
            onClick={()=>{setMode(m=>m==="login"?"signup":"login");setError("");}}>
            {mode==="login"?"sign up":"log in"}
          </span>
        </div>
      </div>
    </div>
  );
}


export default function App(){
  // Tab switch
  function switchTab(newTab){
    if(newTab===tab) return;
    setTab(newTab);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [authSession,setAuthSession]=useState(()=>{
    try{
      const s=localStorage.getItem("slothr_auth");
      if(!s)return null;
      const p=JSON.parse(s);
      if(p.expires_at&&p.expires_at<Date.now()){localStorage.removeItem("slothr_auth");return null;}
      return p;
    }catch(e){return null;}
  });
  const user=authSession?{
    name:authSession.user?.user_metadata?.full_name||authSession.user?.email?.split("@")[0]||"Student",
    email:authSession.user?.email||"",
    avatar:authSession.user?.user_metadata?.avatar_url||null,
    id:authSession.user?.id,
  }:{name:"Student",email:"",avatar:null,id:null};
  function handleAuthSuccess(stored){
    const prev=()=>{try{return JSON.parse(localStorage.getItem("slothr_auth"));}catch(e){return null;}};
    const p=prev();
    if(p?.user?.id&&p.user.id!==stored?.user?.id){
      ["slothr_sessions","slothr_mocks","slothr_goals","slothr_pyq","slothr_completed","slothr_syllabus","slothr_class"].forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
    }
    localStorage.setItem("slothr_auth",JSON.stringify(stored));
    setAuthSession(stored);
  }
  function handleSignOut(){
    if(authSession?.access_token)SB_AUTH.signOut(authSession.access_token).catch(()=>{});
    setAuthSession(null);
    setSessions([]);setMocks([]);setGoals([]);setPyqHistory([]);setCompletedTests({});
    try{["slothr_auth","slothr_sessions","slothr_mocks","slothr_goals","slothr_pyq","slothr_completed","slothr_syllabus","slothr_class"].forEach(k=>localStorage.removeItem(k));}catch(e){}
  }
  // OAuth redirect handler
  const [authLoading,setAuthLoading]=useState(()=>window.location.hash.includes("access_token"));
  useEffect(()=>{
    const hash=window.location.hash;
    if(hash.includes("access_token")){
      const p=new URLSearchParams(hash.replace("#","?"));
      const token=p.get("access_token");
      if(token){
        SB_AUTH.getUser(token).then(u=>{
          if(u){
            const stored={access_token:token,refresh_token:p.get("refresh_token"),expires_at:Date.now()+parseInt(p.get("expires_in")||"3600")*1000,user:u};
            handleAuthSuccess(stored);
            window.history.replaceState(null,"",window.location.pathname);
          }
          setAuthLoading(false);
        }).catch(()=>setAuthLoading(false));
      } else {
        setAuthLoading(false);
      }
    }
  },[]);
  // Token refresh
  useEffect(()=>{
    if(!authSession?.refresh_token)return;
    const ms=Math.max(0,(authSession.expires_at||0)-Date.now()-5*60*1000);
    const t=setTimeout(async()=>{
      try{
        const r=await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:{"apikey":SB_ANON,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:authSession.refresh_token})});
        if(r.ok){const d=await r.json();handleAuthSuccess({access_token:d.access_token,refresh_token:d.refresh_token,expires_at:Date.now()+(d.expires_in||3600)*1000,user:d.user});}
      }catch(e){}
    },ms);
    return()=>clearTimeout(t);
  },[authSession?.refresh_token]);
  const [dark,setDark]=useState(true);
  const [sideOpen,setSideOpen]=useState(true);
  const [tab,setTab]=useState("overview");
  const [jeClass,setJeClass]=useState(()=>{try{return localStorage.getItem("slothr_class")||null;}catch(e){return null;}});
  const [sessions,setSessions]=useState(()=>{try{const c=localStorage.getItem("slothr_sessions");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [mocks,setMocks]=useState(()=>{try{const c=localStorage.getItem("slothr_mocks");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [completedTests,setCompletedTests]=useState(()=>{try{const c=localStorage.getItem("slothr_completed");if(!c)return {};const a=JSON.parse(c);return Object.fromEntries(Object.entries(a).slice(-2));}catch(e){return {};}});

  // ── Receive completed practice test result ────────────────────────────────
  function handleStoreTest(paperId,result){
    setCompletedTests(prev=>{
      const entries=Object.entries({...prev,[paperId]:result});
      const last2=Object.fromEntries(entries.slice(-2));
      try{localStorage.setItem("slothr_completed",JSON.stringify(last2));}catch(e){}
      return last2;
    });
    if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_completed`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({user_id:user.id,paper_id:paperId,data:result})}).catch(()=>{});
  }
  function handleTestComplete({mockEntry, pyqEntries}){
    // Add to mocks (for coach analysis)
    setMocks(prev=>[...prev, mockEntry]);
    // Add all answered questions to pyqHistory
    setPyqHistory(prev=>[...prev, ...pyqEntries]);
  }

  // Goals
  const [goals,setGoals]=useState(()=>{try{const c=localStorage.getItem("slothr_goals");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [goalInput,setGoalInput]=useState("");
  const [goalSub,setGoalSub]=useState("Physics");
  const [goalTopic,setGoalTopic]=useState("");
  const [goalType,setGoalType]=useState("study");
  const [goalTarget,setGoalTarget]=useState("");
  const [goalLoading,setGoalLoading]=useState(false);

  // PYQ
  const [pyqSubject,setPyqSubject]=useState("Physics");
  const [pyqTopic,setPyqTopic]=useState("");
  const [pyqDiff,setPyqDiff]=useState("All");
  const [currentPyq,setCurrentPyq]=useState(null);
  const [revealed,setRevealed]=useState(false);
  const [pyqResult,setPyqResult]=useState(null);
  const [pyqHistory,setPyqHistory]=useState(()=>{try{const c=localStorage.getItem("slothr_pyq");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [selectedOpt,setSelectedOpt]=useState(null);

  // Coach
  const [syllabusStatus,setSyllabusStatus]=useState(()=>{try{const c=localStorage.getItem("slothr_syllabus");return c?JSON.parse(c):{};}catch(e){return {};}});
  const [coachCards,setCoachCards]=useState(null);
  function setSyllabusChapter(sub,topic,status){setSyllabusStatus(prev=>({...prev,[sub+"|"+topic]:status}));}
  const [coachLoading,setCoachLoading]=useState(false);

  // Timer
  const [timerMode,setTimerMode]=useState("stopwatch");
  const [timerOn,setTimerOn]=useState(false);
  const [timerSec,setTimerSec]=useState(0);
  const [countdownSet,setCountdownSet]=useState(25);
  const [customMins,setCustomMins]=useState("");
  const [countdownSec,setCountdownSec]=useState(25*60);
  const [timerSub,setTimerSub]=useState("Physics");
  const [timerTopic,setTimerTopic]=useState("");
  const [timerNotes,setTimerNotes]=useState("");
  const [fullscreen,setFullscreen]=useState(false);
  const [timerDone,setTimerDone]=useState(false);
  const timerRef=useRef(null);
  const wakeLockRef=useRef(null);
  const timerSecRef=useRef(0); // always-current mirror of timerSec for stopTimer

  const [toast,setToast]=useState(null);
  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),3000);}
  const d=(dark?THEME.dark:THEME.light)||THEME.dark;
  const classTopics=sub=>TOPICS[sub][jeClass]||TOPICS[sub].dropper;
  const subColor=SUBJECT_COLORS[timerSub]||d.a1;

  // ── Wake Lock ─────────────────────────────────────────────────────────────
  const acquireWakeLock=useCallback(async()=>{
    try{
      if("wakeLock" in navigator){
        wakeLockRef.current=await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release",()=>{wakeLockRef.current=null;});
      }
    }catch(e){}
  },[]);
  const releaseWakeLock=useCallback(()=>{
    try{wakeLockRef.current?.release();wakeLockRef.current=null;}catch(e){}
  },[]);
  useEffect(()=>{
    if(timerOn){acquireWakeLock();}
    else{releaseWakeLock();}
    return()=>releaseWakeLock();
  },[timerOn]);
  // Reacquire if page becomes visible again while timer is running
  useEffect(()=>{
    const fn=async()=>{if(document.visibilityState==="visible"&&timerOn){await acquireWakeLock();}};
    document.addEventListener("visibilitychange",fn);
    return()=>document.removeEventListener("visibilitychange",fn);
  },[timerOn]);

  // ── Timer tick ────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(timerOn){
      timerRef.current=setInterval(()=>{
        if(timerMode==="stopwatch"){
          setTimerSec(s=>{timerSecRef.current=s+1;return s+1;});
        } else {
          setCountdownSec(s=>{
            if(s<=1){
              clearInterval(timerRef.current);
              setTimerOn(false);
              setTimerDone(true);
              setSessions(p=>[...p,{id:Date.now(),subject:timerSub,topic:timerTopic||"General",duration:countdownSet,date:today(),notes:timerNotes||"Countdown session"}]);
              return 0;
            }
            return s-1;
          });
        }
      },1000);
    } else clearInterval(timerRef.current);
    return()=>clearInterval(timerRef.current);
  },[timerOn,timerMode]);

  useEffect(()=>{const fn=e=>{if(e.key==="Escape")setFullscreen(false);};window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);},[]);

  const totBySub=Object.keys(SUBJECT_COLORS).reduce((a,s)=>({...a,[s]:sessions.filter(x=>x.subject===s).reduce((sum,x)=>sum+x.duration,0)}),{});
  const totalTime=Object.values(totBySub).reduce((a,b)=>a+b,0);
  const todayTime=sessions.filter(s=>s.date===today()).reduce((a,s)=>a+s.duration,0);
  // This week = Mon–today
  const weekStart=(()=>{const d=new Date();d.setHours(0,0,0,0);const day=d.getDay();d.setDate(d.getDate()-(day===0?6:day-1));return d.toISOString().split("T")[0];})();
  const weekTime=sessions.filter(s=>s.date>=weekStart).reduce((a,s)=>a+s.duration,0);
  const streak=calcStreak(sessions);
  const todayGoals=goals.filter(g=>g.date===today());
  const pyqAccuracy=pyqHistory.length?Math.round((pyqHistory.filter(p=>p.correct).length/pyqHistory.length)*100):null;
  // Sync all data to localStorage
  useEffect(()=>{try{localStorage.setItem("slothr_sessions",JSON.stringify(sessions));}catch(e){}},[sessions]);
  useEffect(()=>{try{localStorage.setItem("slothr_mocks",JSON.stringify(mocks));}catch(e){}},[mocks]);
  useEffect(()=>{try{localStorage.setItem("slothr_goals",JSON.stringify(goals));}catch(e){}},[goals]);
  useEffect(()=>{try{localStorage.setItem("slothr_pyq",JSON.stringify(pyqHistory));}catch(e){}},[pyqHistory]);
  useEffect(()=>{try{localStorage.setItem("slothr_syllabus",JSON.stringify(syllabusStatus));}catch(e){}},[syllabusStatus]);
  // Load from Supabase on login (only if localStorage empty)
  useEffect(()=>{
    if(!authSession?.access_token||!user?.id)return;
    const token=authSession.access_token, uid=user.id;
    if(!localStorage.getItem("slothr_sessions"))SB_AUTH.loadData("user_sessions",uid,token).then(d=>{if(d?.length)setSessions(d.map(r=>r.data||r));});
    if(!localStorage.getItem("slothr_goals"))SB_AUTH.loadData("user_goals",uid,token).then(d=>{if(d?.length)setGoals(d.map(r=>r.data||r));});
    if(!localStorage.getItem("slothr_mocks"))SB_AUTH.loadData("user_mocks",uid,token).then(d=>{if(d?.length)setMocks(d.map(r=>r.data||r));});
    if(!localStorage.getItem("slothr_pyq"))SB_AUTH.loadData("user_pyq",uid,token).then(d=>{if(d?.length)setPyqHistory(d.map(r=>r.data||r));});
    if(!localStorage.getItem("slothr_class"))fetch(`${SB_URL}/rest/v1/user_prefs?user_id=eq.${uid}&select=*`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${token}`}}).then(r=>r.json()).then(d=>{if(d?.[0]?.je_class){setJeClass(d[0].je_class);try{localStorage.setItem("slothr_class",d[0].je_class);}catch(e){}}}).catch(()=>{});
  },[authSession?.access_token]);
  useEffect(()=>{
    setGoals(prev=>prev.map(g=>{
      if(g.date!==today()) return g;
      if(g.type==="study"){const done=sessions.filter(s=>s.date===today()&&s.subject===g.subject&&(!g.topic||s.topic===g.topic)).reduce((a,s)=>a+s.duration,0);return{...g,achieved:done>=(g.target||60)};}
      if(g.type==="pyq"){const done=pyqHistory.filter(p=>p.date===today()&&p.subject===g.subject&&(!g.topic||p.topic===g.topic)).length;return{...g,achieved:done>=(g.target||10)};}
      return g;
    }));
  },[sessions,pyqHistory]);
  // Auth gate — after ALL hooks
  if(authLoading)return(
    <div style={{position:"fixed",inset:0,background:"#0e0d0b",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{fontSize:42}}>🦥</div>
      <div style={{fontSize:13,color:"#8a8070",letterSpacing:".06em"}}>signing you in...</div>
    </div>
  );
  if(!authSession)return <AuthScreen onAuth={handleAuthSuccess}/>;
  const barMax=Math.max(...Object.values(totBySub),1);
  const currentMilestone=[...STREAK_MILESTONES].reverse().find(b=>streak>=b.days);
  const nextMilestone=STREAK_MILESTONES.find(b=>b.days>streak);
  const sc=pct=>pct>=67?d.a2:pct>=50?d.a1:d.danger;
  const coachCardColor=color=>({danger:d.danger,success:d.a2,warning:d.gold,info:d.a3,primary:d.a1}[color]||d.a1);

  const cdTotal=countdownSet*60;
  const cdPct=cdTotal>0?countdownSec/cdTotal:1;
  const isLow=timerMode==="countdown"&&countdownSec<60&&timerOn;
  const RING=85;
  const CIRC=2*Math.PI*RING;

  function addGoal(){
    if(!goalTopic&&!goalInput.trim()) return;
    setGoals(p=>[...p,{id:Date.now(),date:today(),text:goalInput||`${goalType==="study"?"Study":"Solve PYQs for"} ${goalTopic||goalSub}`,subject:goalSub,topic:goalTopic,type:goalType,target:Math.max(1,parseInt(goalTarget)||(goalType==="pyq"?10:60)),achieved:false,aiGenerated:false}]);
    setGoalInput("");setGoalTopic("");setGoalTarget("");
  }
  function stopTimer(){
    setTimerOn(false);
    const rawSec=timerSecRef.current;
    const m=Math.max(1,Math.round(rawSec/60));
    // Only save if at least 30 seconds elapsed — prevents 0-minute ghost sessions
    if(rawSec>=30){
      const entry={id:Date.now(),subject:timerSub,topic:timerTopic||"General",duration:m,date:today(),notes:timerNotes||"Timer session"};
      setSessions(p=>[...p,entry]);
      if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_sessions`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({user_id:user.id,data:entry})}).catch(()=>{});
    }
    setTimerSec(0);
    timerSecRef.current=0;
  }
  function resetTimer(){setTimerOn(false);setTimerSec(0);timerSecRef.current=0;setCountdownSec(countdownSet*60);setTimerDone(false);}
  function applyCustom(){const m=parseInt(customMins);if(m>0&&m<=600){setCountdownSet(m);setCountdownSec(m*60);setCustomMins("");};}

  async function callAI(sys,usr,json=false){
    const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${OR_KEY}`,"HTTP-Referer":"https://slothr.in","X-Title":"Slothr"},
      body:JSON.stringify({model:"anthropic/claude-sonnet-4-5",max_tokens:1500,messages:[{role:"system",content:sys},{role:"user",content:usr}]})
    });
    if(!r.ok){const e=await r.text();throw new Error("AI unavailable: "+e);}
    const data=await r.json();
    const txt=data.choices?.[0]?.message?.content||"";
    if(json) return JSON.parse(txt.replace(/```json|```/g,"").trim());
    return txt;
  }
  async function runCoach(){
    const uniqueDays=new Set(sessions.map(s=>s.date)).size;
    if(uniqueDays<3){setCoachCards({locked:true,msg:"not enough data yet. log in consistently for 3 days to unlock AI insights."});return;}
    setCoachLoading(true);setCoachCards(null);
    try{
      const ss=Object.entries(totBySub).map(([s,t])=>`${s}:${fmt(t)}`).join(",");
      const ms=mocks.map(m=>`${m.name}:P=${m.physics},C=${m.chemistry},M=${m.math},T=${m.physics+m.chemistry+m.math}`).join(";");
      const tt=sessions.reduce((a,s)=>{const k=`${s.subject}-${s.topic}`;a[k]=(a[k]||0)+s.duration;return a;},{});
      const ef=Object.entries(tt).filter(([,t])=>t>120).map(([k])=>k).join(",");
      const ps=pyqHistory.length?`${pyqHistory.length} PYQs, ${pyqAccuracy}% accuracy`:"No PYQs yet";
      const cards=await callAI(`You are an elite JEE coach. Return ONLY valid JSON. No markdown.
{"cards":[{"type":"effort_trap","title":"Effort vs Score Gap","icon":"⚠","color":"danger","insight":"2-3 sharp sentences","topics":["t1","t2"],"action":"1 sentence"},{"type":"strengths","title":"Your Strengths","icon":"💪","color":"success","insight":"2-3 sentences","topics":["t1"],"action":"1 sentence"},{"type":"critical_gaps","title":"Critical Gaps","icon":"🎯","color":"warning","insight":"2-3 sentences","topics":["t1","t2"],"action":"1 sentence"},{"type":"time_analysis","title":"Time Analysis","icon":"⏱","color":"info","insight":"2-3 sentences","recommendation":"1 sentence"},{"type":"pyq_analysis","title":"PYQ Performance","icon":"📝","color":"info","insight":"2-3 sentences","action":"1 sentence"},{"type":"weekly_focus","title":"This Week's Focus","icon":"📅","color":"primary","insight":"2 sentences","plan":["Mon-Tue","Wed-Thu","Fri-Sun"]}]}`,
        `Class:${jeClass}. Study:${ss}. Mocks:${ms}. Topics>2h:${ef||"none"}. PYQs:${ps}. Streak:${streak}d. Be sharp and specific.`,true);
      setCoachCards(cards.cards);
    }catch{setCoachCards([{type:"error",title:"Error",icon:"⚠",color:"danger",insight:"broke. try again.",action:""}]);}
    setCoachLoading(false);
  }
  async function aiSuggestGoals(){
    const uniqueDays=new Set(sessions.map(s=>s.date)).size;
    if(uniqueDays<3){showToast("log 3 days of study first. then i'll plan your day. 😏");return;}
    setGoalLoading(true);
    try{
      // ── Study totals ──────────────────────────────────────────────────────
      const studySummary=Object.entries(totBySub).map(([s,t])=>`${s}:${fmt(t)}`).join(", ");

      // ── Today's load ──────────────────────────────────────────────────────
      const todayBySubject=Object.keys(SUBJECT_COLORS).reduce((a,sub)=>({
        ...a,[sub]:sessions.filter(s=>s.date===today()&&s.subject===sub).reduce((sum,s)=>sum+s.duration,0)
      }),{});
      const todayStudySummary=Object.entries(todayBySubject).map(([s,t])=>`${s}:${fmt(t)||"0m"}`).join(", ");
      const todayTotalMins=Object.values(todayBySubject).reduce((a,b)=>a+b,0);

      // ── Mock scores per subject ───────────────────────────────────────────
      const mockBySubject=Object.keys(SUBJECT_COLORS).map(sub=>{
        const scores=mocks.map(m=>({Physics:m.physics,Chemistry:m.chemistry,Mathematics:m.math}[sub]));
        const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null;
        const latest=scores.length?scores[scores.length-1]:null;
        return{sub,avg,latest};
      }).filter(s=>s.avg!==null).sort((a,b)=>a.avg-b.avg);

      // ── BUCKET A: High-weightage chapters soon studied ─────────────────
      // These are genuine coverage gaps that cost marks
      const highWeightGaps=Object.keys(TOPICS).flatMap(sub=>
        classTopics(sub)
          .filter(t=>
            !sessions.some(s=>s.subject===sub&&s.topic===t) &&
            (JEE_WEIGHTAGE[sub]?.[t]||"M")==="H"
          )
          .map(t=>({subject:sub, topic:t, weight:"H"}))
      ).slice(0,6);

      // ── BUCKET B: Chapters studied but performing badly ───────────────────
      // Combines mock weakness + PYQ accuracy per topic
      const topicPyqMap=pyqHistory.reduce((acc,p)=>{
        const key=`${p.subject}||${p.topic}`;
        if(!acc[key]) acc[key]={subject:p.subject,topic:p.topic,correct:0,total:0};
        acc[key].total++;
        if(p.correct) acc[key].correct++;
        return acc;
      },{});

      // Topics studied but with <60% PYQ accuracy (min 2 attempts), weighted by JEE weight
      const poorPyqTopics=Object.values(topicPyqMap)
        .map(t=>({
          ...t,
          acc:Math.round((t.correct/t.total)*100),
          weight: JEE_WEIGHTAGE[t.subject]?.[t.topic]||"M",
          studied: sessions.some(s=>s.subject===t.subject&&s.topic===t.topic)
        }))
        .filter(t=>t.acc<60&&t.total>=2)
        .sort((a,b)=>{
          // H-weight poor topics first, then by worst accuracy
          const wdiff=WEIGHT_SCORE[b.weight]-WEIGHT_SCORE[a.weight];
          return wdiff!==0?wdiff:a.acc-b.acc;
        })
        .slice(0,5)
        .map(t=>`${t.subject}-${t.topic}(PYQ:${t.acc}%,${t.total}Qs,${t.weight}-weight)`);

      // Topics with study sessions but low mock performance in that subject
      const mockWeakTopics=mockBySubject
        .filter(s=>s.avg!==null&&s.avg<65)
        .map(s=>{
          // Find the most-studied topic in this weak subject as a revision candidate
          const topicTimes=sessions
            .filter(x=>x.subject===s.sub)
            .reduce((a,x)=>{a[x.topic]=(a[x.topic]||0)+x.duration;return a;},{});
          const topTopics=Object.entries(topicTimes)
            .sort((a,b)=>b[1]-a[1])
            .slice(0,2)
            .map(([t])=>`${s.sub}-${t}(mock:${s.avg}/100,${JEE_WEIGHTAGE[s.sub]?.[t]||"M"}-weight)`);
          return topTopics;
        }).flat().slice(0,4);

      // Existing goals dedup
      const existingGoalTopics=todayGoals.map(g=>`${g.subject}-${g.topic||"no subject picked"}`).join(", ");

      const res=await callAI(
        `You are a world-class JEE personal coach. Generate exactly 4 goals for today. Return ONLY valid JSON. No markdown.
Format: {"goals":[{"text":"short action-oriented string","subject":"Physics|Chemistry|Mathematics","topic":"string","type":"study|pyq|revision","target":number,"reasoning":"one sentence citing the exact data point — weightage, PYQ%, mock score, or session count"}]}

GOAL MIX RULES — this is the most important instruction:
- 2 goals should address HIGH-WEIGHTAGE chapters soon studied (pure coverage gaps)
- i know your sessions. your weak chapters. i don't miss.'ll be gentle.
- If there aren't enough of one type, fill from the other — but always aim for this balanced split
- Cover at least 2 different subjects across the 4 goals
- NEVER suggest L-weight chapters that aren't studied — not worth the time at this stage
- For "study" goals: target 45–90 minutes. For "pyq" goals: target 10–20 questions. For "revision": 30–60 min.
- If >4hrs studied today, cap study goals at 45 min, lean towards revision and pyq
- Avoid duplicating topics in today's existing goals

GOAL TYPE GUIDANCE:
- Unstudied H-weight chapter → type: "study"
- Studied chapter with bad PYQ accuracy → type: "pyq" (drill it with practice questions)
- Studied chapter with bad mock score → type: "revision" (go back and consolidate)
- reasoning must be specific: "H-weight, 0 sessions logged" OR "44% PYQ accuracy on 6 questions" OR "Chemistry avg mock 61/100"`,

        `Class: ${jeClass}. Streak: ${streak} days.
STUDY TIME (total): ${studySummary}
TODAY studied: ${todayStudySummary} (${fmt(todayTotalMins)} total today)
MOCK SCORES: ${mockBySubject.map(s=>`${s.sub} avg=${s.avg}/100 latest=${s.latest}/100`).join("; ")||"no mocks yet"}

BUCKET A — High-weight chapters NEVER studied (push for coverage):
${highWeightGaps.map(t=>`  • ${t.subject} - ${t.topic} [H-weight, 0 sessions]`).join("\n")||"  None — all H-weight chapters started!"}

BUCKET B — Chapters studied but performing badly (push for consolidation):
  PYQ weak topics: ${poorPyqTopics.join(", ")||"none yet"}
  Mock-weak chapter candidates: ${mockWeakTopics.join(", ")||"none yet"}

TODAY'S EXISTING GOALS (skip these): ${existingGoalTopics||"none"}

Generate a balanced 4-goal mix: roughly 2 from Bucket A (coverage) + 2 from Bucket B (consolidation).`,true);

      setGoals(p=>[...p,...res.goals.map(g=>({...g,id:Date.now()+Math.random(),date:today(),achieved:false,aiGenerated:true}))]);
    }catch(e){console.error(e);}
    setGoalLoading(false);
  }
  async function generatePYQ(){
    setCurrentPyq({loading:true});
    try {
      let params=[
        "select=id,subject,topic,question_text,option_a,option_b,option_c,option_d,correct,solution,difficulty,diagram_url,answer_type",
        "subject=eq."+pyqSubject,
        "exam=eq.JEE%20Advanced",
        "is_active=eq.true",
        "is_verified=eq.true",
        "limit=50",
      ];
      if(pyqTopic) params.push("topic=eq."+encodeURIComponent(pyqTopic));
      if(pyqDiff!=="All") params.push("difficulty=eq."+pyqDiff);
      const r=await fetch(`${SB_URL}/rest/v1/questions?${params.join("&")}`,{headers:{"apikey":SB_ANON,"Authorization":"Bearer "+SB_ANON}});
      if(!r.ok) throw new Error(await r.text());
      let pool=await r.json();
      if(pool.length===0){
        setCurrentPyq({error:true,msg:`No questions yet for ${pyqSubject}${pyqTopic?" — "+pyqTopic:""}. Add them in the admin panel.`});
        return;
      }
      // Avoid recently seen questions
      const recent=pyqHistory.slice(-5).map(p=>p.qid).filter(Boolean);
      const fresh=pool.filter(q=>!recent.includes(q.id));
      const candidates=fresh.length>0?fresh:pool;
      const raw=candidates[Math.floor(Math.random()*candidates.length)];
      // Map to slothr question shape
      const q={
        id:raw.id, subject:raw.subject, topic:raw.topic,
        text:raw.question_text, difficulty:raw.difficulty,
        options:raw.option_a?{A:raw.option_a,B:raw.option_b,C:raw.option_c,D:raw.option_d}:null,
        correct:raw.correct, solution:raw.solution,
        diagram_url:raw.diagram_url||null, answer_type:raw.answer_type||"text",
      };
      setCurrentPyq(q);
      setRevealed(false);
      setPyqResult(null);
      setSelectedOpt(null);
    } catch(e){
      setCurrentPyq({error:true,msg:"Failed to load question. Check your connection."});
    }
  }
  function submitPYQAnswer(opt){
    if(!currentPyq||revealed) return;
    setSelectedOpt(opt);
    const correct=opt===currentPyq.correct;
    setPyqResult(correct?"correct":"incorrect");
    setRevealed(true);
    setPyqHistory(p=>[...p,{qid:currentPyq.id,subject:currentPyq.subject,topic:currentPyq.topic,correct,date:today(),difficulty:currentPyq.difficulty,year:currentPyq.year}]);
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  const SW=sideOpen?220:56;
  const css=`
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&display=swap');
    html,body{overflow-x:hidden;width:100%;}
    body{margin:0;padding:0;}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{background:${d.bg};font-family:'DM Sans',sans-serif;color:${d.t};-webkit-font-smoothing:antialiased;}
    *{transition:background-color .18s,border-color .18s,color .12s;}
    ::-webkit-scrollbar{width:2px;} ::-webkit-scrollbar-thumb{background:${d.b};border-radius:1px;}

    /* ── LAYOUT ── */
    .layout{display:flex;min-height:100vh;overflow-x:hidden;width:100%;max-width:100%;}
    .sidebar{width:${SW}px;min-height:100vh;background:${d.sb};border-right:1px solid ${d.b};position:fixed;top:0;left:0;display:flex;flex-direction:column;z-index:20;overflow:hidden;transition:width .28s cubic-bezier(.16,1,.3,1);}
    .content{margin-left:${SW}px;flex:1;background:${d.bg};min-height:100vh;transition:margin-left .25s ease;min-width:0;overflow-x:hidden;width:calc(100% - ${SW}px);box-sizing:border-box;}
    .inner{max-width:1060px;padding:32px 40px;width:100%;margin:0 auto;box-sizing:border-box;}
    /* ── RESPONSIVE ── */
    @media(min-width:1400px){
      .inner{padding:36px 56px;}
      .topbar{padding:0 56px;}
    }
    @media(max-width:1100px){
      .inner{padding:28px 28px;}
      .topbar{padding:0 28px;}
    }
    @media(max-width:900px){
      .sidebar{width:${sideOpen?"220px":"0px"} !important;z-index:50;box-shadow:${sideOpen?"2px 0 24px rgba(0,0,0,.5)":"none"};}
      .content{margin-left:0 !important;width:100% !important;}
      .inner{padding:20px 18px;}
      .topbar{padding:0 18px !important;}
      .g3{grid-template-columns:1fr 1fr !important;}
      .g4{grid-template-columns:1fr 1fr !important;}
      .coach-grid{grid-template-columns:1fr !important;}
      .stat-num{font-size:30px !important;}
    }
    @media(max-width:600px){
      .sidebar{width:0 !important;transform:translateX(-110%) !important;box-shadow:none !important;}
      .content{margin-left:0 !important;width:100% !important;padding-bottom:68px;}
      .inner{padding:14px 12px !important;}
      .topbar{padding:0 12px !important;min-height:50px;}
      .g2{grid-template-columns:1fr 1fr !important;}
      .g3,.g4{grid-template-columns:1fr 1fr !important;}
      .coach-grid{grid-template-columns:1fr !important;}
      .stat-num{font-size:20px !important;}
      .ptitle{font-size:14px !important;}
      .psub{display:none !important;}
      .section-head{font-size:16px !important;}
      .snotes{display:none;}
    }
    @media(max-width:400px){
      .g2,.g3,.g4{grid-template-columns:1fr !important;}
      .inner{padding:12px 10px !important;}
      .stat-num{font-size:18px !important;}
    }
    /* sidebar overlay on tablet */
    .sb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:45;cursor:pointer;}
    @media(max-width:900px){.sb-overlay{display:${sideOpen?"block":"none"};}}
    /* hamburger for tablet */
    .mob-btn{display:none;width:34px;height:34px;border-radius:4px;background:transparent;border:1px solid ${d.b};cursor:pointer;align-items:center;justify-content:center;color:${d.t};font-size:18px;flex-shrink:0;}
    @media(max-width:900px){.mob-btn{display:flex;}}
    /* mobile bottom tab bar */
    .mob-tabs{display:none;position:fixed;bottom:0;left:0;right:0;z-index:30;background:${d.sb};border-top:1px solid ${d.b};align-items:stretch;padding-bottom:env(safe-area-inset-bottom,0px);}
    @media(max-width:600px){.mob-tabs{display:flex;}}

    /* ── SIDEBAR ── */
    .s-logo{padding:18px 16px 14px;border-bottom:1px solid ${d.b};display:flex;align-items:center;gap:10px;min-height:58px;flex-shrink:0;}
    .s-brand{font-size:16px;font-weight:700;color:${d.t};letter-spacing:-.05em;white-space:nowrap;opacity:${sideOpen?1:0};transition:opacity .18s;line-height:1;font-family:'DM Serif Display',serif;}
    .s-toggle{width:26px;height:26px;border-radius:4px;background:transparent;border:1px solid ${d.b};cursor:pointer;display:flex;align-items:center;justify-content:center;color:${d.t3};font-size:11px;flex-shrink:0;}
    .s-toggle:hover{color:${d.t};border-color:${d.bs};}
    .s-nav{padding:10px 8px;flex:1;overflow-y:auto;overflow-x:hidden;}
    .s-sec{font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:${d.t4};padding:0 8px;margin:14px 0 4px;opacity:${sideOpen?1:0};transition:opacity .15s;font-family:'DM Sans',sans-serif;font-weight:600;}
    .s-item{display:flex;align-items:center;gap:9px;padding:${sideOpen?"7px 10px":"7px"};border-radius:3px;cursor:pointer;color:${d.sm};font-size:12px;margin-bottom:1px;border:1px solid transparent;user-select:none;justify-content:${sideOpen?"flex-start":"center"};font-weight:500;letter-spacing:.01em;}
    .s-item:hover{color:${d.t};background:${d.sa};}
    .s-item.active{color:${d.t};background:${d.sa};border-color:${d.sab};font-weight:600;}
    .s-icon{font-size:12px;flex-shrink:0;width:16px;text-align:center;opacity:.6;}
    .s-item.active .s-icon{opacity:1;}
    .s-label{white-space:nowrap;overflow:hidden;opacity:${sideOpen?1:0};transition:opacity .15s;}
    .s-footer{padding:12px 14px;border-top:1px solid ${d.b};flex-shrink:0;}
    .s-av{width:26px;height:26px;border-radius:2px;background:${d.a1};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;flex-shrink:0;letter-spacing:.02em;}
    .s-uinfo{overflow:hidden;opacity:${sideOpen?1:0};transition:opacity .15s;}

    /* ── TOPBAR ── */
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0 40px;border-bottom:1px solid ${d.b};background:${dark?"rgba(14,13,11,.92)":"rgba(247,244,238,.92)"};position:sticky;top:0;z-index:10;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);min-height:60px;}
    .ptitle{font-size:18px;font-weight:400;letter-spacing:-.02em;font-family:'DM Serif Display',serif;line-height:1;}
    .psub{font-size:11px;color:${d.t3};margin-top:3px;letter-spacing:.01em;font-style:italic;}
    .tbr{display:flex;align-items:center;gap:7px;}
    .icon-btn{width:30px;height:30px;border-radius:3px;background:transparent;border:1px solid ${d.b};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;color:${d.t3};}
    .icon-btn:hover{border-color:${d.bs};color:${d.t};}
    .ghost-sm{background:transparent;color:${d.t3};border:1px solid ${d.b};border-radius:3px;padding:5px 12px;font-family:'DM Sans',inherit;font-size:11px;cursor:pointer;font-weight:500;letter-spacing:.02em;}
    .ghost-sm:hover{color:${d.t};border-color:${d.bs};}

    /* ── CARDS ── */
    .card{background:${d.card};border:1px solid ${d.b};border-radius:2px;}
    .cp{padding:20px 22px;}
    .cl{font-size:8.5px;color:${d.t3};font-weight:700;letter-spacing:.16em;text-transform:uppercase;font-family:'DM Sans',sans-serif;}
    .g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
    .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
    .g4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
    .mb12{margin-bottom:12px;}.mb16{margin-bottom:16px;}
    .field{margin-bottom:11px;}
    .fl{display:block;font-size:10px;color:${d.t3};margin-bottom:5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;}

    /* ── INPUTS ── */
    input.inp,textarea.inp{width:100%;padding:9px 13px;border:1px solid ${d.inpb};border-radius:3px;background:${d.inp};font-family:'DM Sans',sans-serif;font-size:13px;color:${d.t};outline:none;}
    input.inp:focus,textarea.inp:focus{border-color:${d.a1}66;}
    input.inp::placeholder{color:${d.t4};}

    /* ── BUTTONS ── */
    .btn{border:none;border-radius:3px;padding:9px 18px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px;letter-spacing:.02em;}
    .btn-d{background:${d.t};color:${d.bg};}
    .btn-d:hover{opacity:.84;}
    .btn-d:disabled{opacity:.25;cursor:not-allowed;}
    .btn-full{width:100%;padding:11px;}
    .btn-danger{background:${d.danger};color:#fff;}

    /* ── MISC ── */
    .btrack{height:2px;background:${d.b};border-radius:1px;overflow:hidden;}
    .bfill{height:100%;border-radius:1px;transition:width .8s cubic-bezier(.16,1,.3,1);}
    .dot{width:5px;height:5px;border-radius:50%;}
    .row{display:flex;align-items:center;}
    .rowb{display:flex;align-items:center;justify-content:space-between;}
    .f1{flex:1;}
    .pin{animation:pin .2s ease;}
    @keyframes pin{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    @keyframes selIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    .shim{border-radius:2px;height:10px;background:linear-gradient(90deg,${d.sh1} 25%,${d.sh2} 50%,${d.sh1} 75%);background-size:200%;animation:sh 1.5s infinite;margin-bottom:8px;}
    @keyframes sh{0%{background-position:200%}100%{background-position:-200%}}
    .empty{text-align:center;padding:44px 20px;}
    .et{font-size:13px;font-weight:500;color:${d.t3};margin-bottom:3px;font-style:italic;font-family:'DM Serif Display',serif;}
    .es{font-size:11px;color:${d.t4};}
    hr{border:none;border-top:1px solid ${d.div};margin:14px 0;}
    .rec-dot{display:inline-block;width:4px;height:4px;background:${subColor};border-radius:50%;margin-right:5px;animation:blink 1.2s infinite;}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.1}}
    @keyframes ring-pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .ring-alert{animation:ring-pulse .75s infinite;}

    /* ── STAT CARDS — editorial number treatment ── */
    .stat-num{font-family:'DM Serif Display',serif;font-size:38px;font-weight:400;line-height:1;letter-spacing:-.02em;}
    .stat-label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${d.t3};margin-top:5px;}
    .stat-hint{font-size:11px;color:${d.t3};margin-top:4px;font-style:italic;}

    /* ── SECTION DIVIDER — magazine rule ── */
    .sec-rule{display:flex;align-items:center;gap:10px;margin-bottom:16px;}
    .sec-rule-line{flex:1;height:1px;background:${d.b};}
    .sec-rule-label{font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${d.t4};}

    /* ── SECTION heading style ── */
    .section-head{font-family:'DM Serif Display',serif;font-size:22px;font-weight:400;letter-spacing:-.02em;color:${d.t};line-height:1.2;margin-bottom:4px;}
    .section-sub{font-size:11px;color:${d.t3};margin-bottom:20px;font-style:italic;}

    /* ── Mode toggle ── */
    .mode-tab{display:flex;background:${d.inp};border:1px solid ${d.inpb};border-radius:3px;padding:2px;gap:2px;margin-bottom:16px;}
    .mode-opt{flex:1;padding:7px;border-radius:2px;border:none;font-family:'DM Sans',sans-serif;font-size:11.5px;font-weight:500;cursor:pointer;background:none;color:${d.t3};letter-spacing:.02em;}
    .mode-opt.active{background:${d.card};color:${d.t};font-weight:600;}

    /* ── Ring wrap ── */
    .ring-wrap{position:relative;width:190px;height:190px;margin:0 auto;}
    .ring-svg{position:absolute;inset:0;width:100%;height:100%;}
    .ring-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
    .ring-time{font-family:'DM Serif Display',serif;font-size:40px;font-weight:400;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums;}
    .ring-sub{font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:${d.t4};margin-top:5px;font-weight:700;}

    /* ── Fullscreen timer ── */
    .fs-overlay{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${dark?"#0e0d0b":"#f7f4ee"};}
    .fs-exit{position:absolute;top:22px;right:24px;background:transparent;border:1px solid ${d.b};border-radius:3px;padding:7px 14px;font-family:'DM Sans',sans-serif;font-size:11px;color:${d.t3};cursor:pointer;font-weight:600;letter-spacing:.04em;}
    .fs-exit:hover{color:${d.t};border-color:${d.bs};}
    .fs-sub{font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${subColor};margin-bottom:8px;}
    .fs-topic{font-size:13px;color:${d.t2};margin-bottom:40px;font-style:italic;}
    .fs-time{font-family:'DM Serif Display',serif;font-size:104px;font-weight:400;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums;color:${d.t};}
    .fs-actions{display:flex;gap:12px;margin-top:38px;}

    /* ── PYQ ── */
    .pyq-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-radius:4px;background:${d.card};border:1px solid ${d.b};}
    .pyq-q-top{padding:16px 20px;border-bottom:1px solid ${d.b};background:${d.hover};}
    .pyq-tag{font-size:9px;padding:2px 7px;border-radius:2px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;}
    .pyq-opts{padding:16px 20px;display:flex;flex-direction:column;gap:7px;}
    .pyq-opt{display:flex;align-items:center;gap:12px;padding:12px 15px;border-radius:3px;border:1px solid ${d.b};cursor:pointer;background:${d.card};transition:all .12s;}
    .pyq-opt:hover{border-color:${d.bs};background:${d.hover};}
    .pyq-opt.sel{border-color:${d.a1};background:${d.a1}0e;}
    .pyq-result-banner{margin:0 20px 14px;padding:11px 15px;border-radius:3px;display:flex;align-items:center;gap:10px;}
    .pyq-solution{margin:0 20px 20px;padding:14px;border-radius:3px;background:${d.hover};border:1px solid ${d.b};}
    .pyq-nav{padding:14px 20px;border-top:1px solid ${d.b};display:flex;align-items:center;gap:9px;background:${d.hover};}

    /* ── Coach card ── */
    .coach-card{position:relative;overflow:hidden;border-radius:4px;background:${d.card};border:1px solid ${d.b};padding:18px 20px;margin-bottom:12px;}
    .coach-card::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;}

    /* Session rows */
    .srow{display:flex;align-items:center;gap:12px;padding:12px 4px;border-radius:0;border:none;border-bottom:1px solid ${d.div};margin-bottom:0;}
    .srow:hover{background:transparent;}
    .ssub{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;width:70px;flex-shrink:0;}
    .stopic{font-size:13px;flex:1;}
    .snotes{font-size:11px;color:${d.t3};flex:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sdur{font-size:10.5px;color:${d.t3};background:${d.tag};padding:2px 8px;border-radius:20px;flex-shrink:0;border:1px solid ${d.b};}
    .sdate{font-size:10px;color:${d.t4};flex-shrink:0;}

    /* Mode toggle */
    .mode-tab{display:flex;background:${d.inp};border:1px solid ${d.inpb};border-radius:10px;padding:3px;gap:3px;margin-bottom:16px;}
    .mode-opt{flex:1;padding:7px;border-radius:7px;border:none;font-family:inherit;font-size:12px;font-weight:500;cursor:pointer;background:none;color:${d.t3};}
    .mode-opt.active{background:${d.card};color:${d.t};box-shadow:0 1px 4px rgba(0,0,0,.2);}

    /* Ring wrap */
    .ring-wrap{position:relative;width:200px;height:200px;margin:0 auto;}
    .ring-svg{position:absolute;inset:0;width:100%;height:100%;}
    .ring-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
    .ring-time{font-size:42px;font-weight:300;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;}
    .ring-sub{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:${d.t4};margin-top:4px;}

    /* Fullscreen */
    .fs-overlay{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${dark?"#0d0d0c":"#f8f8f6"};}
    .fs-exit{position:absolute;top:20px;right:22px;background:${d.tag};border:1px solid ${d.b};border-radius:8px;padding:7px 13px;font-family:inherit;font-size:12px;color:${d.t3};cursor:pointer;}
    .fs-exit:hover{color:${d.t};}
    .fs-sub{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${subColor};margin-bottom:6px;}
    .fs-topic{font-size:14px;color:${d.t2};margin-bottom:32px;}
    .fs-time{font-size:100px;font-weight:200;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums;color:${d.t};}
    .fs-actions{display:flex;gap:12px;margin-top:36px;}
    .fs-btn{padding:12px 28px;border-radius:10px;border:none;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;}
    .fs-btn-stop{background:${d.danger};color:#fff;}
    .fs-btn-pause{background:${d.tag};color:${d.t};border:1px solid ${d.b};}
    .fs-done{text-align:center;}
    .fs-ring-wrap{position:relative;width:300px;height:300px;margin:0 auto 12px;}

    /* Coach */
    .coach-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px;margin-bottom:16px;}
    .coach-card{padding:17px;border-radius:12px;border:1px solid ${d.b};background:${d.card};position:relative;overflow:hidden;}
    .coach-card::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;}
    .coach-card.danger::before{background:${d.danger};}
    .coach-card.success::before{background:${d.a2};}
    .coach-card.warning::before{background:${d.gold};}
    .coach-card.info::before{background:${d.a3};}
    .coach-card.primary::before{background:${d.a1};}
    .cc-icon{font-size:19px;margin-bottom:9px;}
    .cc-title{font-size:12px;font-weight:600;color:${d.t};margin-bottom:7px;}
    .cc-insight{font-size:11.5px;color:${d.t2};line-height:1.7;margin-bottom:9px;}
    .cc-topics{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px;}
    .cc-topic{font-size:10px;padding:2px 7px;border-radius:20px;font-weight:500;}
    .cc-action{font-size:11px;color:${d.t3};padding:8px 10px;background:${d.hover};border-radius:7px;line-height:1.5;border-left:2px solid ${d.a1};}

    /* Goals */
    .goal-item{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-radius:9px;margin-bottom:6px;border:1px solid ${d.b};background:${d.card};}
    .goal-item.achieved{border-color:${d.a2}30;background:${d.a2}05;}
    .goal-check{width:19px;height:19px;border-radius:50%;border:1.5px solid ${d.b};display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0;margin-top:1px;cursor:pointer;}
    .goal-check.done{background:${d.a2};border-color:${d.a2};color:white;}
    .goal-text{font-size:13px;flex:1;line-height:1.4;}
    .goal-text.done{text-decoration:line-through;color:${d.t3};}
    .goal-meta{font-size:10.5px;color:${d.t3};margin-top:2px;}
    .goal-ai-badge{font-size:9px;padding:1px 6px;border-radius:20px;background:${d.a3}18;color:${d.a3};font-weight:500;flex-shrink:0;}
    .goal-prog{height:2px;background:${d.b};border-radius:2px;overflow:hidden;margin-top:5px;}
    .goal-prog-fill{height:100%;border-radius:2px;background:${d.a2};}

    /* ── Streak ── */
    .streak-hero{text-align:center;padding:24px 20px;border-radius:14px;background:linear-gradient(135deg,${d.a1}10,${d.a3}10);border:1px solid ${d.b};margin-bottom:13px;}
    .streak-num{font-size:60px;font-weight:700;letter-spacing:-.04em;line-height:1;color:${d.a1};}
    .milestone-row{display:flex;align-items:center;gap:10px;padding:10px 13px;border-radius:9px;margin-bottom:3px;border:1px solid transparent;}
    .milestone-row.reached{background:${d.hover};border-color:${d.b};}
    .milestone-row:not(.reached){opacity:.38;}
    .m-check{width:18px;height:18px;border-radius:50%;background:${d.a2};display:flex;align-items:center;justify-content:center;font-size:9px;color:white;flex-shrink:0;}
    .m-lock{width:18px;height:18px;border-radius:50%;background:${d.b};display:flex;align-items:center;justify-content:center;font-size:9px;color:${d.t4};flex-shrink:0;}

    /* ── PYQ Examgoal style ── */
    .pyq-shell{display:flex;flex-direction:column;gap:13px;}
    .pyq-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-radius:12px;background:${d.card};border:1px solid ${d.b};}
    .pyq-q-card{background:${d.card};border:1px solid ${d.b};border-radius:12px;overflow:hidden;}
    .pyq-q-top{padding:16px 20px;border-bottom:1px solid ${d.b};background:${d.hover};}
    .pyq-q-meta{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
    .pyq-tag{font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;letter-spacing:.03em;}
    .pyq-q-text{font-size:15px;line-height:1.85;color:${d.t};font-weight:400;}
    .pyq-opts{padding:16px 20px;display:flex;flex-direction:column;gap:8px;}
    .pyq-opt{display:flex;align-items:center;gap:13px;padding:13px 16px;border-radius:10px;border:1.5px solid ${d.b};cursor:pointer;background:${d.card};transition:all .14s;}
    .pyq-opt:hover:not(.disabled){border-color:${d.a3};background:${d.a3}09;}
    .pyq-opt.disabled{cursor:default;}
    .pyq-opt.opt-correct{border-color:${d.a2};background:${d.a2}0d;}
    .pyq-opt.opt-wrong{border-color:${d.danger};background:${d.danger}0d;}
    .pyq-opt.opt-reveal{border-color:${d.a2}60;background:${d.a2}07;}
    .pyq-opt-key{width:30px;height:30px;border-radius:50%;border:1.5px solid ${d.b};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;color:${d.t3};}
    .pyq-opt.opt-correct .pyq-opt-key{border-color:${d.a2};background:${d.a2};color:white;}
    .pyq-opt.opt-wrong .pyq-opt-key{border-color:${d.danger};background:${d.danger};color:white;}
    .pyq-opt.opt-reveal .pyq-opt-key{border-color:${d.a2};color:${d.a2};}
    .pyq-opt-text{font-size:13.5px;color:${d.t};flex:1;line-height:1.5;}
    .pyq-opt.opt-correct .pyq-opt-text{color:${d.a2};font-weight:500;}
    .pyq-opt.opt-wrong .pyq-opt-text{color:${d.danger};}
    .pyq-result-banner{margin:0 20px 16px;padding:12px 16px;border-radius:10px;display:flex;align-items:center;gap:10px;}
    .pyq-result-banner.correct{background:${d.a2}10;border:1px solid ${d.a2}30;}
    .pyq-result-banner.incorrect{background:${d.danger}10;border:1px solid ${d.danger}30;}
    .pyq-solution{margin:0 20px 20px;padding:16px;border-radius:10px;background:${d.hover};border:1px solid ${d.b};}
    .pyq-sol-title{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${d.t3};margin-bottom:10px;}
    .pyq-sol-text{font-size:13px;line-height:1.85;color:${d.t2};white-space:pre-wrap;}
    .pyq-tip{margin:0 20px 20px;padding:11px 14px;border-radius:9px;background:${d.gold}0a;border:1px solid ${d.gold}22;font-size:12.5px;color:${d.t2};line-height:1.6;}
    .pyq-nav{padding:16px 20px;border-top:1px solid ${d.b};display:flex;align-items:center;gap:10px;background:${d.hover};}
    .pyq-stat-row{display:flex;gap:6px;}
    .pyq-stat-pill{display:flex;flex-direction:column;align-items:center;padding:10px 14px;border-radius:9px;border:1px solid ${d.b};background:${d.card};min-width:64px;}
    .pyq-stat-v{font-size:20px;font-weight:600;letter-spacing:-.02em;line-height:1;}
    .pyq-stat-l{font-size:9.5px;color:${d.t3};margin-top:2px;text-transform:uppercase;letter-spacing:.04em;}

    /* Onboarding */
    .onboard{min-height:100vh;background:${d.bg};display:flex;align-items:center;justify-content:center;padding:40px;}
    .ob-box{width:100%;max-width:400px;}
    .ob-logo{font-size:28px;font-weight:900;color:${d.t};margin-bottom:28px;letter-spacing:-.05em;line-height:1;}
    .ob-title{font-size:22px;font-weight:600;letter-spacing:-.03em;margin-bottom:4px;}
    .ob-sub{font-size:13px;color:${d.t3};margin-bottom:24px;line-height:1.5;}
    .class-opt{display:flex;align-items:center;gap:13px;padding:13px 15px;border:1.5px solid ${d.b};border-radius:11px;cursor:pointer;margin-bottom:8px;background:${d.card};}
    .class-opt:hover{border-color:${d.bs};}
    .class-opt.sel{border-color:${d.a1};background:${d.a1}07;}
    .co-icon{width:32px;height:32px;border-radius:8px;background:${d.tag};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}
  `;

  // ─── Onboarding ───────────────────────────────────────────────────────────


  if(!jeClass) return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:9999,background:d.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px",boxSizing:"border-box",overflowY:"auto",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`html,body{overflow:hidden;}@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
      <div style={{width:"100%",maxWidth:380,margin:"auto"}}>
        <div style={{fontSize:26,fontWeight:900,color:d.t,marginBottom:24,letterSpacing:"-.05em",fontFamily:"'DM Serif Display',serif"}}>
          <span style={{fontSize:32,marginRight:6}}>🦥</span>sloth<span style={{color:d.a1}}>r</span>
        </div>
        <div style={{fontSize:20,fontWeight:600,letterSpacing:"-.02em",color:d.t,marginBottom:4}}>who are you.</div>
        <div style={{fontSize:13,color:d.t3,marginBottom:20,lineHeight:1.5}}>study less. rank more. nap often.</div>
        {CLASSES.map(c=>(
          <div key={c.id}
            style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",border:`1.5px solid ${d.b}`,borderRadius:10,cursor:"pointer",marginBottom:8,background:d.card,transition:"border-color .15s"}}
            onMouseOver={e=>e.currentTarget.style.borderColor=d.bs}
            onMouseOut={e=>e.currentTarget.style.borderColor=d.b}
            onClick={()=>{
                  setJeClass(c.id);
                  try{localStorage.setItem("slothr_class",c.id);}catch(e){}
                  if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,je_class:c.id})}).catch(()=>{});
                }}>
            <div style={{width:32,height:32,borderRadius:8,background:d.hover,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{c.icon}</div>
            <div style={{fontSize:13,fontWeight:500,color:d.t}}>{c.label}</div>
          </div>
        ))}
        <div style={{fontSize:10.5,color:d.t4,textAlign:"center",marginTop:12}}>you can change this later.</div>
      </div>
    </div>
  );

  const classLabel=CLASSES.find(c=>c.id===jeClass)?.label;

  // ── Fullscreen render ─────────────────────────────────────────────────────
  const renderFS=()=>{
    const isCD=timerMode==="countdown";
    const FS_R=120,FS_C=2*Math.PI*FS_R;
    return(
      <div className="fs-overlay"><style>{css}</style>
        <button className="fs-exit" onClick={()=>setFullscreen(false)}>✕ back  <span style={{opacity:.4,fontSize:9}}>ESC</span></button>
        {timerDone?(
          <div className="fs-done">
            
            <div style={{fontSize:28,fontWeight:600,color:d.a2,marginBottom:6}}>session saved. look at you. knew you had it in you.</div>
            <div style={{fontSize:14,color:d.t3,marginBottom:4}}>{countdownSet} min · {timerSub}{timerTopic?` · ${timerTopic}`:""}</div>
            <div style={{fontSize:12,color:d.t4,marginBottom:24}}>done.</div>
            <button className="fs-btn fs-btn-pause" onClick={()=>{setTimerDone(false);setFullscreen(false);}}>back</button>
          </div>
        ):(
          <>
            <div className="fs-sub">{timerSub}</div>
            <div className="fs-topic">{timerTopic||"no subject picked"}</div>
            {isCD?(
              <div className="fs-ring-wrap">
                <svg style={{position:"absolute",inset:0,width:"100%",height:"100%"}} viewBox="0 0 300 300">
                  <circle cx="150" cy="150" r={FS_R} fill="none" stroke={`${subColor}18`} strokeWidth="10"/>
                  <circle cx="150" cy="150" r={FS_R} fill="none" stroke={isLow?d.danger:subColor} strokeWidth="10"
                    strokeDasharray={FS_C} strokeDashoffset={FS_C*(1-cdPct)}
                    strokeLinecap="round" transform="rotate(-90 150 150)"
                    className={isLow?"ring-alert":""}
                    style={{transition:"stroke-dashoffset 1s linear,stroke .3s"}}/>
                </svg>
                <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                  <div style={{fontSize:72,fontWeight:200,letterSpacing:"-.04em",color:isLow?d.danger:d.t,fontVariantNumeric:"tabular-nums"}}>{fmtT(countdownSec)}</div>
                  <div style={{fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:d.t4,marginTop:6}}>{timerOn?"locked in 🔒":"paused"}</div>
                </div>
              </div>
            ):(
              <div className="fs-time">{fmtT(timerSec)}</div>
            )}
            {timerOn&&<div style={{fontSize:12,color:subColor,marginTop:isCD?8:16}}><span className="rec-dot"/>don't close this tab.</div>}
            <div className="fs-actions">
              {timerOn?(
                <>
                  <button className="fs-btn fs-btn-pause" onClick={()=>setTimerOn(false)}>⏸ pause</button>
                  {!isCD&&<button className="fs-btn fs-btn-stop" onClick={()=>{stopTimer();setFullscreen(false);}}>⏹ stop</button>}
                </>
              ):(
                <>
                  <button className="fs-btn" style={{background:subColor,color:"#fff"}} onClick={()=>{setTimerDone(false);if(isCD)setCountdownSec(s=>s||countdownSet*60);setTimerOn(true);}}>▶ lock in</button>
                  {!isCD&&(timerSec>0)&&<button className="fs-btn fs-btn-stop" onClick={()=>{stopTimer();setFullscreen(false);}}>⏹ stop</button>}
                  <button className="fs-btn fs-btn-pause" onClick={resetTimer}>↺ reset</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Timer card ────────────────────────────────────────────────────────────
  const renderTimer=()=>{
    const isCD=timerMode==="countdown";
    return(
      <div className="card cp">
        <div className="mode-tab">
          <button className={`mode-opt${timerMode==="stopwatch"?" active":""}`} onClick={()=>{if(!timerOn){setTimerMode("stopwatch");resetTimer();}}}>⏱ Stopwatch</button>
          <button className={`mode-opt${timerMode==="countdown"?" active":""}`} onClick={()=>{if(!timerOn){setTimerMode("countdown");resetTimer();}}}>⏳ Countdown</button>
        </div>
        <div className="field">
          <label className="fl">subject</label>
          <Select value={timerSub} onChange={v=>{setTimerSub(v);setTimerTopic("");}} options={Object.keys(SUBJECT_COLORS)} disabled={timerOn} d={d}/>
        </div>
        <div className="field">
          <label className="fl">topic</label>
          <Select value={timerTopic} onChange={setTimerTopic} options={[{value:"",label:"General Study"},...classTopics(timerSub).map(t=>({value:t,label:t}))]} disabled={timerOn} d={d}/>
        </div>
        <div className="field">
          <label className="fl">what are we doing today.</label>
          <input className="inp" placeholder="be specific." value={timerNotes} onChange={e=>setTimerNotes(e.target.value)} disabled={timerOn}/>
        </div>
        {isCD&&!timerOn&&(
          <div className="field">
            <label className="fl">Duration</label>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
              {[15,25,30,45,60,90].map(m=>(
                <button key={m} onClick={()=>{setCountdownSet(m);setCountdownSec(m*60);}} style={{padding:"6px 13px",borderRadius:3,border:`1.5px solid ${countdownSet===m?subColor:d.b}`,background:countdownSet===m?`${subColor}15`:d.tag,color:countdownSet===m?subColor:d.t3,fontFamily:"inherit",fontSize:12,cursor:"pointer",fontWeight:countdownSet===m?600:400,transition:"all .12s"}}>
                  {m}m
                </button>
              ))}
            </div>
            {/* Custom duration */}
            <div style={{display:"flex",gap:6}}>
              <input className="inp" type="number" placeholder="Custom (e.g. 20)" min="1" max="600" value={customMins} onChange={e=>setCustomMins(e.target.value)} onKeyDown={e=>e.key==="Enter"&&applyCustom()} style={{flex:1}}/>
              <button onClick={applyCustom} style={{padding:"9px 14px",border:`1px solid ${d.b}`,borderRadius:3,background:d.tag,color:d.t3,fontFamily:"inherit",fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>Set</button>
            </div>
          </div>
        )}
        {/* Ring display */}
        <div style={{margin:"10px 0 8px"}}>
          <div className="ring-wrap">
            <svg className="ring-svg" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r={RING} fill="none" stroke={`${subColor}12`} strokeWidth="7"/>
              {isCD?(
                <circle cx="100" cy="100" r={RING} fill="none" stroke={isLow?d.danger:subColor} strokeWidth="7"
                  strokeDasharray={CIRC} strokeDashoffset={CIRC*(1-cdPct)}
                  strokeLinecap="round" transform="rotate(-90 100 100)"
                  className={isLow?"ring-alert":""} style={{transition:"stroke-dashoffset 1s linear,stroke .3s"}}/>
              ):timerOn?(
                <circle cx="100" cy="100" r={RING} fill="none" stroke={subColor} strokeWidth="7"
                  strokeDasharray={CIRC} strokeDashoffset={CIRC*(1-Math.min((timerSec%3600)/3600,1))}
                  strokeLinecap="round" transform="rotate(-90 100 100)" style={{transition:"stroke-dashoffset 1s linear"}}/>
              ):null}
            </svg>
            <div className="ring-inner">
              <div className="ring-time" style={{color:isLow?d.danger:timerOn?d.t:d.t3}}>{isCD?fmtT(countdownSec):fmtT(timerSec)}</div>
              <div className="ring-sub">{timerOn?(isCD?"locked in 🔒":"i'm watching. go."):""}</div>
            </div>
          </div>
          {timerOn&&<div style={{textAlign:"center",fontSize:11,color:subColor,marginTop:6}}><span className="rec-dot"/>i'm watching. go.</div>}
          {timerDone&&<div style={{textAlign:"center",fontSize:12,color:d.a2,marginTop:6,fontWeight:500}}>session saved. look at you. knew you had it in you.</div>}
        </div>
        {/* Controls */}
        <div style={{display:"flex",gap:7}}>
          {!timerOn?(
            <>
              <button className="btn btn-full" style={{background:subColor,color:"#fff",flex:2}}
                onClick={()=>{setTimerDone(false);if(isCD){setCountdownSec(countdownSet*60);}setTimerOn(true);}}>
                ▶ lock in
              </button>
              {(timerSec>0||(isCD&&countdownSec<cdTotal))&&<button className="btn" style={{background:d.tag,color:d.t3,border:`1px solid ${d.b}`,flex:1}} onClick={resetTimer}>↺ reset</button>}
            </>
          ):(
            <>
              <button className="btn btn-full" style={{background:d.tag,color:d.t,border:`1px solid ${d.b}`,flex:1}} onClick={()=>setTimerOn(false)}>⏸ pause</button>
              {!isCD&&<button className="btn btn-danger btn-full" style={{flex:1}} onClick={stopTimer}>⏹ stop</button>}
            </>
          )}
        </div>
        <button className="btn btn-full" style={{background:d.tag,border:`1px solid ${d.b}`,color:d.t3,fontSize:12,marginTop:7}} onClick={()=>setFullscreen(true)}>⛶ go fullscreen</button>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return(
    <>
      {/* ── Ad Modals ── */}

      {fullscreen&&renderFS()}
      <div className="layout" style={{visibility:fullscreen?"hidden":"visible"}}><style>{css}</style>
      {/* ── Sticky Banner Ad ── */}

        <div className="sb-overlay" onClick={()=>setSideOpen(false)}/>
        <aside className="sidebar">
          <div className="s-logo">
            <button className="s-toggle" onClick={()=>setSideOpen(p=>!p)}>{sideOpen?"‹":"›"}</button>
            <div className="s-brand">
              <span style={{fontSize:14,marginRight:4}}>🦥</span><span style={{fontWeight:800,letterSpacing:"-.04em",fontSize:15}}>sloth</span><span style={{fontWeight:800,letterSpacing:"-.04em",fontSize:15,color:d.a1}}>r</span>
            </div>
          </div>
          <nav className="s-nav">
            <div className="s-sec" style={{marginTop:6}}>navigation</div>
            {TABS.map(t=>(
              <div key={t.id} className={`s-item${tab===t.id?" active":""}`} onClick={()=>switchTab(t.id)} title={!sideOpen?t.label:""}>
                <span className="s-icon">{t.icon}</span>
                <span className="s-label">{t.label}</span>
              </div>
            ))}
            {sideOpen&&(
              <div style={{margin:"10px 4px 0",padding:"10px 11px",background:d.sa,borderRadius:3,border:`1px solid ${d.sab}`}}>
                <div style={{fontSize:9,color:d.t4,letterSpacing:".1em",textTransform:"uppercase",marginBottom:4}}>today</div>
                <div style={{fontSize:11.5,color:d.t2,marginBottom:5}}>{todayTime>0?`${fmt(todayTime)} today`:"zero. the exam doesn't care."}</div>
                <div className="btrack" style={{height:3}}>
                  <div className="bfill" style={{width:`${Math.min((todayTime/360)*100,100)}%`,background:`linear-gradient(90deg,${d.a1},${d.a3})`}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:d.t4,marginTop:4}}>
                  <span>{todayGoals.filter(g=>g.achieved).length}/{todayGoals.length} goals</span>
                  <span>🔥 {streak}d</span>
                </div>
              </div>
            )}
          </nav>
          <div className="s-footer">
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {user?.avatar?(
                <img src={user.avatar} style={{width:27,height:27,borderRadius:"50%",objectFit:"cover",flexShrink:0}} alt="avatar"/>
              ):(
                <div className="s-av">{(user?.name||"S")[0].toUpperCase()}</div>
              )}
              <div className="s-uinfo">
                <div style={{fontSize:12,fontWeight:500,color:d.t,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:130}}>{user?.name||"Student"}</div>
                <div style={{fontSize:10,color:d.a1}}>{classLabel} · 🦥</div>
              </div>
              {sideOpen&&(
                <button onClick={handleSignOut} title="sign out"
                  style={{marginLeft:"auto",background:"none",border:"none",color:d.t4,cursor:"pointer",fontSize:14,padding:"2px 4px",flexShrink:0}}
                  onMouseOver={e=>e.target.style.color=d.danger} onMouseOut={e=>e.target.style.color=d.t4}>
                  ⏻
                </button>
              )}
            </div>

          </div>
        </aside>

        <div className="content">
          {tab!=="pyq"&&<div className="topbar">
            {/* Always-visible Slothr logo */}
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <button className="mob-btn" onClick={()=>setSideOpen(p=>!p)} aria-label="menu">☰</button>
              <div>
                <div className="ptitle">{TABS.find(t=>t.id===tab)?.label}</div>
                <div className="psub">
                  {tab==="overview"&&`${new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})} · ${Math.max(0,Math.ceil((new Date("2026-05-24")-new Date())/86400000))}d left. days left. tick tock.`}
                  {tab==="coach"&&"your smartest situationship. i know things about you."}
                  {tab==="goals"&&(todayGoals.length===0?"no goals. bold strategy.":todayGoals.filter(g=>g.achieved).length===todayGoals.length?`all ${todayGoals.length} done.`:`${todayGoals.filter(g=>g.achieved).length}/${todayGoals.length} done.`)}
                  {tab==="pyq"&&"3 hours. 54 questions. no one to save you."}
                  {tab==="sessions"&&`${sessions.length} sessions · ${fmt(totalTime)} total. not bad.`}
                  {tab==="streaks"&&`${streak} day streak${currentMilestone?" · "+currentMilestone.icon+" "+currentMilestone.label:""}`}
                  {tab==="syllabus"&&"track every chapter. i know which ones you're avoiding."}
                </div>
              </div>
            </div>
            <div className="tbr">
              <button className="icon-btn" onClick={()=>setDark(p=>!p)}>{dark?"☀":"◑"}</button>
              <button className="ghost-sm" onClick={()=>setJeClass(null)}>switch class</button>
            </div>
          </div>}

          {/* ── PRACTICE — full bleed, no inner wrapper ── */}
          {tab==="pyq"&&(
            <NTAMode user={user} dark={dark} onExit={()=>switchTab("overview")} onTestComplete={handleTestComplete} completedTests={completedTests} onStoreTest={handleStoreTest}/>
          )}

          <div className="inner" style={{display:tab==="pyq"?"none":"block"}}>

            {/* ── OVERVIEW ── */}
            {tab==="overview"&&(
              <div className="pin">
                {/* ── Hero stats — editorial wide layout ── */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:1,border:`1px solid ${d.b}`,borderRadius:2,overflow:"hidden",marginBottom:32,background:d.b}}>
                  {[
                    {lbl:"This Week",    val:fmt(weekTime),  hint:`${sessions.filter(s=>s.date>=weekStart).length} sessions. i saw every one. don't think i didn't notice.`,     color:d.a1},
                    {lbl:"Today",        val:fmt(todayTime), hint:todayTime===0?"oh you studied 0m? cute.":todayTime>=360?"okay you're actually good. don't let it go to your head.":`${fmt(todayTime)} logged. i saw every minute.`,color:todayTime>=360?d.a2:d.t},
                    {lbl:"Goals",        val:`${todayGoals.filter(g=>g.achieved).length}/${todayGoals.length||0}`, hint:todayGoals.filter(g=>g.achieved).length===todayGoals.length&&todayGoals.length>0?"i knew you had it. always did. 😏":"goals set. bold of you.", color:d.a2},
                    {lbl:"PYQ Accuracy", val:pyqAccuracy!==null?`${pyqAccuracy}%`:"—", hint:pyqAccuracy===null?"uncharted territory.":pyqAccuracy>=80?"okay you're actually good. don't let it go to your head.":"yeah we're fixing this. together.", color:d.a3},
                  ].map(s=>(
                    <div key={s.lbl} style={{background:d.card,padding:"28px 26px"}}>
                      <div style={{fontSize:8.5,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:d.t4,marginBottom:14}}>{s.lbl}</div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:46,fontWeight:400,lineHeight:1,letterSpacing:"-.02em",color:s.color,marginBottom:10}}>{s.val}</div>
                      <div style={{fontSize:11,color:d.t3,fontStyle:"italic"}}>{s.hint}</div>
                    </div>
                  ))}
                </div>
                <div className="g2" style={{gap:14,marginBottom:32}}>
                  <div className="card cp" style={{padding:"24px 26px"}}>
                    <div className="cl" style={{marginBottom:18,letterSpacing:".14em"}}>Subject Time</div>
                    {Object.entries(SUBJECT_COLORS).map(([sub,color])=>(
                      <div key={sub} style={{marginBottom:13}}>
                        <div className="rowb" style={{marginBottom:5}}>
                          <div className="row" style={{gap:8}}><div className="dot" style={{background:color}}/><span style={{fontSize:12.5,fontWeight:500}}>{sub}</span></div>
                          <span style={{fontSize:11,color:d.t3}}>{fmt(totBySub[sub])}</span>
                        </div>
                        <div className="btrack"><div className="bfill" style={{width:`${(totBySub[sub]/barMax)*100}%`,background:color}}/></div>
                      </div>
                    ))}
                  </div>
                  <div className="card cp">
                    <div className="cl mb12">Today's Goals</div>
                    {todayGoals.length===0?(<div className="empty" style={{padding:"18px 0"}}><div className="et">no goals yet.</div><div className="es">go to today's goals and add some.</div></div>)
                    :todayGoals.slice(0,5).map(g=>(
                      <div key={g.id} className={`goal-item${g.achieved?" achieved":""}`} style={{padding:"9px 11px"}}>
                        <div className={`goal-check${g.achieved?" done":""}`} onClick={()=>setGoals(p=>p.map(x=>x.id===g.id?{...x,achieved:!x.achieved}:x))}>{g.achieved?"✓":""}</div>
                        <div style={{flex:1}}>
                          <div className={`goal-text${g.achieved?" done":""}`} style={{fontSize:12.5}}>{g.text}</div>
                          <div className="goal-meta">{g.subject}{g.topic?` · ${g.topic}`:""}</div>
                        </div>
                        {g.aiGenerated&&<div className="goal-ai-badge">AI</div>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="g2" style={{gap:14,marginBottom:0}}>
                  {/* Recent Study Sessions */}
                  <div className="card" style={{padding:"22px 24px"}}>
                    <div className="rowb" style={{marginBottom:16}}><div className="cl" style={{letterSpacing:".14em"}}>recent sessions</div><button className="ghost-sm" onClick={()=>setTab("sessions")}>see all →</button></div>
                    {sessions.length===0&&<div className="empty" style={{padding:"14px 0"}}><div className="et">nothing yet.</div><div className="es">i'm watching. go.</div></div>}
                    {[...sessions].reverse().slice(0,5).map(s=>(
                      <div key={s.id} className="srow">
                        <div className="dot" style={{background:SUBJECT_COLORS[s.subject]}}/>
                        <div className="ssub" style={{color:SUBJECT_COLORS[s.subject]}}>{s.subject}</div>
                        <div className="stopic">{s.topic}</div>
                        <div className="sdur">{fmt(s.duration)}</div>
                        <div className="sdate">{s.date}</div>
                      </div>
                    ))}
                  </div>
                  {/* recent practice tests — auto-populated from NTA simulation */}
                  <div className="card" style={{padding:"22px 24px"}}>
                    <div className="rowb" style={{marginBottom:16}}>
                      <div className="cl" style={{letterSpacing:".14em"}}>recent practice tests</div>
                      {mocks.length>0&&<button className="ghost-sm" onClick={()=>switchTab("pyq")}>take a test →</button>}
                    </div>
                    {mocks.length===0?(
                      <div className="empty" style={{padding:"14px 0"}}>
                        <div className="et">zero attempts. bold. i like the confidence.</div>
                        <div className="es">uncharted territory. take the test.</div>
                        <button className="btn btn-d" style={{marginTop:12,padding:"8px 18px",fontSize:12}} onClick={()=>switchTab("pyq")}>→ go to practice</button>
                      </div>
                    ):[...mocks].reverse().slice(0,4).map(m=>{
                      const total=m.physics+m.chemistry+m.math;
                      const outOf=180;
                      const pct=Math.round((total/outOf)*100);
                      const scoreC=pct>=60?d.a2:pct>=40?d.gold:d.danger;
                      return(
                        <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${d.div}`}}>
                          <div style={{width:38,height:38,borderRadius:2,background:`${scoreC}14`,border:`1px solid ${scoreC}30`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <span style={{fontFamily:"'DM Serif Display',serif",fontSize:15,fontWeight:400,color:scoreC}}>{total}</span>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:500,color:d.t,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>
                            <div style={{fontSize:10.5,color:d.t3,marginTop:2}}>
                              <span style={{color:SUBJECT_COLORS.Physics}}>P {m.physics}</span>
                              <span style={{margin:"0 5px",color:d.t4}}>·</span>
                              <span style={{color:SUBJECT_COLORS.Chemistry}}>C {m.chemistry}</span>
                              <span style={{margin:"0 5px",color:d.t4}}>·</span>
                              <span style={{color:SUBJECT_COLORS.Mathematics}}>M {m.math}</span>
                            </div>
                          </div>
                          <div style={{fontSize:10,color:d.t4,flexShrink:0}}>{m.date}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── JEE COACH ── */}
            {tab==="coach"&&(
              <div className="pin">
                <div className="rowb" style={{marginBottom:32,alignItems:"flex-end"}}>
                  <div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28,fontWeight:400,letterSpacing:"-.02em",color:d.t,marginBottom:6,lineHeight:1.2}}>okay. let's talk about your data.</div>
                    <div style={{fontSize:12,color:d.t3,fontStyle:"italic"}}>let me tell you exactly where you're leaking marks.</div>
                  </div>
                  <button className="btn btn-d" onClick={runCoach} disabled={coachLoading}>{coachLoading?"looking...":"analyse"}</button>
                </div>
                <div className="g3 mb16">
                  {Object.entries(SUBJECT_COLORS).map(([sub,color])=>{
                    const sm=mocks.map(m=>({Physics:m.physics,Chemistry:m.chemistry,Mathematics:m.math}[sub]));
                    const avg=sm.length?Math.round(sm.reduce((a,b)=>a+b,0)/sm.length):null;
                    const hrs=(totBySub[sub]/60).toFixed(1);
                    const eff=avg&&parseFloat(hrs)>0?Math.round(avg/parseFloat(hrs)):null;
                    return(
                      <div key={sub} className="card cp">
                        <div className="row mb12" style={{gap:8}}><div className="dot" style={{background:color}}/><span style={{fontSize:12,fontWeight:600,color}}>{sub}</span></div>
                        <div className="g2" style={{gap:7}}>
                          <div style={{textAlign:"center",padding:"8px",background:d.hover,borderRadius:3}}><div style={{fontSize:20,fontWeight:600,color,letterSpacing:"-.02em"}}>{hrs}h</div><div style={{fontSize:9.5,color:d.t4,marginTop:1}}>Time</div></div>
                          <div style={{textAlign:"center",padding:"8px",background:d.hover,borderRadius:3}}><div style={{fontSize:20,fontWeight:600,color:avg?sc(avg):d.t4,letterSpacing:"-.02em"}}>{avg||"—"}</div><div style={{fontSize:9.5,color:d.t4,marginTop:1}}>Avg score</div></div>
                        </div>
                        {eff&&<div style={{marginTop:8,fontSize:11,textAlign:"center",padding:"5px",background:eff>8?`${d.a2}10`:`${d.danger}10`,borderRadius:6,color:eff>8?d.a2:d.danger}}>{eff>8?"✓ Efficient":"⚠ Low efficiency"} · {eff} pts/hr</div>}
                      </div>
                    );
                  })}
                </div>
                {!coachCards&&!coachLoading&&(<div className="card empty"><div style={{fontSize:26,marginBottom:10}}>👀</div><div className="et">nothing yet.</div><div className="es">i know your weak spots. i'll be gentle.ng. we fix it today.</div></div>)}
                {coachCards?.locked&&(
                  <div className="card cp" style={{textAlign:"center",padding:"32px 24px"}}>
                    <div style={{fontSize:28,marginBottom:12}}>🔒</div>
                    <div style={{fontSize:14,fontWeight:600,color:d.t,marginBottom:8}}>not enough data yet.</div>
                    <div style={{fontSize:12,color:d.t3,lineHeight:1.7}}>{coachCards.msg}</div>
                  </div>
                )}
                {!coachCards?.locked&&coachLoading&&<div className="card cp">{[100,85,92,78,88,70].map((w,i)=><div key={i} className="shim" style={{width:`${w}%`}}/>)}</div>}
                {coachCards&&(
                  <div className="coach-grid">
                    {coachCards.map((card,i)=>(
                      <div key={i} className={`coach-card ${card.color}`}>
                        <div className="cc-icon">{card.icon}</div>
                        <div className="cc-title">{card.title}</div>
                        <div className="cc-insight">{card.insight}</div>
                        {card.topics?.length>0&&<div className="cc-topics">{card.topics.map(t=><span key={t} className="cc-topic" style={{background:`${coachCardColor(card.color)}14`,color:coachCardColor(card.color)}}>{t}</span>)}</div>}
                        {card.plan&&card.plan.map((p,pi)=><div key={pi} style={{fontSize:11,color:d.t3,padding:"3px 0",borderBottom:`1px solid ${d.div}`}}>{p}</div>)}
                        {(card.recommendation||card.action)&&<div className="cc-action">{card.recommendation||card.action}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── GOALS ── */}
            {tab==="goals"&&(
              <div className="pin">
                <div style={{marginBottom:28}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28,fontWeight:400,letterSpacing:"-.02em",color:d.t,marginBottom:4,lineHeight:1.2}}>today's goals.</div>
                  <div style={{fontSize:12,color:d.t3,fontStyle:"italic"}}>no goals yet. add one.</div>
                </div>
                <div className="g2" style={{gap:14,marginBottom:28}}>
                  <div className="card cp">
                    <div className="cl mb12">Add Goal</div>
                    <div className="field"><label className="fl">Subject</label><Select value={goalSub} onChange={v=>{setGoalSub(v);setGoalTopic("");}} options={Object.keys(SUBJECT_COLORS)} d={d}/></div>
                    <div className="field"><label className="fl">Topic</label><Select value={goalTopic} onChange={setGoalTopic} options={[{value:"",label:"All topics"},...classTopics(goalSub).map(t=>({value:t,label:t}))]} d={d}/></div>
                    <div className="field"><label className="fl">Type</label><Select value={goalType} onChange={setGoalType} options={[{value:"study",label:"Study (time)"},{value:"pyq",label:"Solve PYQs (count)"},{value:"revision",label:"Revision"}]} d={d}/></div>
                    <div className="field"><label className="fl">{goalType==="pyq"?"Questions target":"Minutes target"}</label><input className="inp" type="number" placeholder={goalType==="pyq"?"e.g. 15":"e.g. 90"} min="1" max={goalType==="pyq"?"50":"480"} value={goalTarget} onChange={e=>setGoalTarget(e.target.value)}/></div>
                    <div className="field"><label className="fl">Note (optional)</label><input className="inp" placeholder="e.g. Focus on integration by parts" value={goalInput} onChange={e=>setGoalInput(e.target.value)}/></div>
                    <button className="btn btn-d btn-full" onClick={addGoal}>+ Add Goal</button>
                  </div>
                  <div className="card cp">
                    <div className="rowb mb12">
                      <div><div style={{fontSize:13,fontWeight:500}}>let me plan your day 😏</div><div style={{fontSize:11,color:d.t3,marginTop:2}}>i know your weak spots. i'll be gentle.</div></div>
                      <button className="btn btn-d" style={{padding:"7px 12px",fontSize:11.5}} onClick={aiSuggestGoals} disabled={goalLoading}>{goalLoading?"looking...":"suggest goals"}</button>
                    </div>
                    {goalLoading&&[80,90,75,85].map((w,i)=><div key={i} className="shim" style={{width:`${w}%`}}/>)}
                    {/* Signal breakdown — two bucket framing */}
                    <div style={{display:"flex",flexDirection:"column",gap:5}}>
                      <div style={{fontSize:10,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",color:d.t4,marginBottom:2}}>what it looks at</div>
                      {(()=>{
                        const hGaps=Object.keys(TOPICS).flatMap(sub=>classTopics(sub).filter(t=>!sessions.some(s=>s.subject===sub&&s.topic===t)&&(JEE_WEIGHTAGE[sub]?.[t]||"M")==="H")).length;
                        const weakPyqs=pyqHistory.length;
                        const hasMocks=mocks.length>0;
                        const sigs=[
                          {icon:"📥", label:"not started", bucket:"A", detail:`${hGaps} high-weight chapter${hGaps!==1?"s":""} soon started`, active:hGaps>0, color:d.a1},
                          {icon:"🔁", label:"needs work", bucket:"B", detail:hasMocks?`Practice test scores + ${weakPyqs>0?weakPyqs+" PYQ attempts":"no PYQ data yet"}`:"take a test first", active:hasMocks||weakPyqs>0, color:d.a3},
                          {icon:"⏱", label:"today", bucket:"", detail:`${fmt(todayTime)||"0m"} studied · adjusts goal intensity`, active:true, color:d.a2},
                          {icon:"📊", label:"mock scores", bucket:"", detail:mocks.length?Object.keys(SUBJECT_COLORS).map(s=>{const sc2=mocks.map(m=>({Physics:m.physics,Chemistry:m.chemistry,Mathematics:m.math}[s]));return s.slice(0,4)+" "+Math.round(sc2.reduce((a,b)=>a+b,0)/sc2.length)+"/100";}).join(" · "):"take a test first", active:mocks.length>0, color:d.gold},
                        ];
                        return sigs.map(sig=>(
                          <div key={sig.label} style={{display:"flex",alignItems:"center",gap:9,padding:"8px 11px",borderRadius:3,background:sig.active?sig.color+"08":d.hover,border:"1px solid "+(sig.active?sig.color+"22":d.b)}}>
                            <span style={{fontSize:13,flexShrink:0}}>{sig.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:5}}>
                                <span style={{fontSize:11.5,fontWeight:500,color:sig.active?d.t:d.t3}}>{sig.label}</span>
                                {sig.bucket&&<span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:4,background:`${sig.color}18`,color:sig.color}}>Bucket {sig.bucket}</span>}
                              </div>
                              <div style={{fontSize:10.5,color:d.t4,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sig.detail}</div>
                            </div>
                            <div style={{width:6,height:6,borderRadius:"50%",background:sig.active?sig.color:d.t4,flexShrink:0,opacity:sig.active?1:.4}}/>
                          </div>
                        ));
                      })()}
                      <div style={{fontSize:10.5,color:d.t4,padding:"6px 8px",lineHeight:1.6}}>
                        i know your weak spots. let me plan your day.
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card cp">
                  <div className="rowb mb12">
                    <div className="cl">{new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"short"})}</div>
                    <div style={{fontSize:11,color:d.t3}}>{todayGoals.filter(g=>g.achieved).length}/{todayGoals.length} done</div>
                  </div>
                  {todayGoals.length>0&&<div style={{marginBottom:12}}><div className="btrack" style={{height:4}}><div className="bfill" style={{width:`${todayGoals.length?(todayGoals.filter(g=>g.achieved).length/todayGoals.length)*100:0}%`,background:`linear-gradient(90deg,${d.a1},${d.a2})`}}/></div></div>}
                  {todayGoals.length===0&&<div className="empty" style={{padding:"22px 0"}}><div className="et">no goals yet.</div><div className="es">let me plan your day. i know exactly what you need. 😏</div></div>}
                  {todayGoals.map(g=>{
                    const prog=g.type==="study"?sessions.filter(s=>s.date===today()&&s.subject===g.subject&&(!g.topic||s.topic===g.topic)).reduce((a,s)=>a+s.duration,0):g.type==="pyq"?pyqHistory.filter(p=>p.date===today()&&p.subject===g.subject&&(!g.topic||p.topic===g.topic)).length:g.achieved?g.target:0;
                    const pct=Math.min((prog/g.target)*100,100);
                    return(
                      <div key={g.id} className={`goal-item${g.achieved?" achieved":""}`}>
                        <div className={`goal-check${g.achieved?" done":""}`} onClick={()=>setGoals(p=>p.map(x=>x.id===g.id?{...x,achieved:!x.achieved}:x))}>{g.achieved?"✓":""}</div>
                        <div className="f1">
                          <div className="rowb">
                            <div className={`goal-text${g.achieved?" done":""}`}>{g.text}</div>
                            {g.aiGenerated&&<div className="goal-ai-badge">AI</div>}
                          </div>
                          <div className="goal-meta"><span style={{color:SUBJECT_COLORS[g.subject]}}>{g.subject}</span>{g.topic&&<span> · {g.topic}</span>}<span> · {g.type==="pyq"?`${prog}/${g.target} Qs`:`${fmt(prog)} / ${fmt(g.target)}`}</span>{g.reasoning&&<span style={{color:d.t4}}> — {g.reasoning}</span>}</div>
                          <div className="goal-prog"><div className="goal-prog-fill" style={{width:`${pct}%`}}/></div>
                        </div>
                        <button onClick={()=>setGoals(p=>p.filter(x=>x.id!==g.id))} style={{background:"none",border:"none",color:d.t4,cursor:"pointer",fontSize:15,padding:"0 2px",marginLeft:4}}>×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── SESSIONS ── */}
            {tab==="sessions"&&(
              <div className="pin">
                <div style={{marginBottom:28}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28,fontWeight:400,letterSpacing:"-.02em",color:d.t,marginBottom:4,lineHeight:1.2}}>sessions.</div>
                  <div style={{fontSize:12,color:d.t3,fontStyle:"italic"}}>{sessions.length===0?"nothing yet.":`${sessions.length} session${sessions.length!==1?"s":""} · ${fmt(totalTime)} total. not bad.`}</div>
                </div>
                <div className="g2" style={{gap:14,marginBottom:28}}>
                  {renderTimer()}
                  <div className="card cp">
                    <div className="cl mb12">today's sessions</div>
                    {sessions.filter(s=>s.date===today()).length===0?(
                      <div className="empty" style={{padding:"18px 0"}}><div className="et">nothing yet.</div><div className="es">timer is right there.</div></div>
                    ):sessions.filter(s=>s.date===today()).map(s=>(
                      <div key={s.id} className="srow">
                        <div className="dot" style={{background:SUBJECT_COLORS[s.subject]}}/>
                        <div className="ssub" style={{color:SUBJECT_COLORS[s.subject]}}>{s.subject}</div>
                        <div className="stopic">{s.topic}</div>
                        <div className="snotes">{s.notes||""}</div>
                        <div className="sdur">{fmt(s.duration)}</div>
                      </div>
                    ))}
                    {sessions.filter(s=>s.date===today()).length>0&&(
                      <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${d.div}`,display:"flex",justifyContent:"space-between",fontSize:12}}>
                        <span style={{color:d.t3}}>total today</span>
                        <span style={{fontWeight:600,color:d.a2}}>{fmt(todayTime)} today</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="card cp">
                  <div className="rowb mb10"><div className="cl">all sessions</div><div style={{fontSize:11,color:d.t4}}>{sessions.length} sessions · {fmt(totalTime)} total. not bad.</div></div>
                  {[...sessions].reverse().map(s=>(
                    <div key={s.id} className="srow">
                      <div className="dot" style={{background:SUBJECT_COLORS[s.subject]}}/>
                      <div className="ssub" style={{color:SUBJECT_COLORS[s.subject]}}>{s.subject}</div>
                      <div className="stopic">{s.topic}</div>
                      <div className="snotes">{s.notes||"—"}</div>
                      <div className="sdur">{fmt(s.duration)}</div>
                      <div className="sdate">{s.date}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STREAKS ── */}
            {tab==="syllabus"&&(()=>{
              const SUBS=["Physics","Chemistry","Mathematics"];
              const STATUS_OPTS=[
                {v:"not_started",l:"Not Started",icon:"—",c:d.t4,bg:"transparent"},
                {v:"in_progress",l:"In Progress",icon:"▶",c:d.a3,bg:d.a3+"15"},
                {v:"done",l:"Done",icon:"✓",c:d.a2,bg:d.a2+"15"},
                {v:"need_revision",l:"Needs Revision",icon:"↺",c:d.a1,bg:d.a1+"15"},
              ];
              const WT_ORDER={"H":0,"M":1,"L":2};
              const allChapters=sub=>{const s=new Set();return[...(TOPICS[sub]["11th"]||[]),...(TOPICS[sub]["12th"]||[]),...(TOPICS[sub].dropper||[])].filter(t=>{if(s.has(t))return false;s.add(t);return true;});};
              const sorted=sub=>[...allChapters(sub)].sort((a,b)=>(WT_ORDER[JEE_WEIGHTAGE[sub]?.[a]||"M"]||1)-(WT_ORDER[JEE_WEIGHTAGE[sub]?.[b]||"M"]||1));
              const chHrs=(sub,t)=>sessions.filter(s=>s.subject===sub&&s.topic===t).reduce((a,s)=>a+(s.duration||0),0);
              const chAcc=(sub,t)=>{const qs=pyqHistory.filter(p=>p.subject===sub&&p.topic===t);return qs.length?Math.round(qs.filter(p=>p.correct).length/qs.length*100):null;};
              const total=SUBS.reduce((a,sub)=>a+allChapters(sub).length,0);
              const done=Object.values(syllabusStatus).filter(v=>v==="done").length;
              const prog=Object.values(syllabusStatus).filter(v=>v==="in_progress").length;
              const rev=Object.values(syllabusStatus).filter(v=>v==="need_revision").length;
              const pct=total>0?Math.round((done/total)*100):0;
              return(
                <div>
                  <div className="card cp mb16">
                    <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
                      <div style={{textAlign:"center",minWidth:70}}>
                        <div style={{fontSize:48,fontWeight:700,fontFamily:"'DM Serif Display',serif",color:pct>=80?d.a2:pct>=50?d.gold:d.danger,letterSpacing:"-.04em",lineHeight:1}}>{pct}%</div>
                        <div style={{fontSize:10,color:d.t3,marginTop:3,letterSpacing:".06em",textTransform:"uppercase"}}>covered</div>
                      </div>
                      <div style={{flex:1,minWidth:160}}>
                        <div style={{height:6,background:d.b,borderRadius:3,overflow:"hidden",marginBottom:10,display:"flex"}}>
                          <div style={{width:`${Math.round((done/total)*100)}%`,background:d.a2,transition:"width .5s"}}/>
                          <div style={{width:`${Math.round((prog/total)*100)}%`,background:d.a3}}/>
                          <div style={{width:`${Math.round((rev/total)*100)}%`,background:d.a1}}/>
                        </div>
                        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                          {[{l:"Done",v:done,c:d.a2},{l:"In Progress",v:prog,c:d.a3},{l:"Revision",v:rev,c:d.a1},{l:"Not Started",v:total-done-prog-rev,c:d.t4}].map(s=>(
                            <div key={s.l} style={{display:"flex",alignItems:"center",gap:4}}>
                              <div style={{width:6,height:6,borderRadius:2,background:s.c}}/>
                              <span style={{fontSize:10,color:d.t3}}>{s.l}</span>
                              <span style={{fontSize:11,fontWeight:700,color:s.c}}>{s.v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:10,color:d.t3}}>JEE Advanced 2026</div>
                        <div style={{fontSize:16,fontWeight:700,color:d.t}}>{Math.max(0,Math.ceil((new Date("2026-05-24")-new Date())/86400000))}d left</div>
                      </div>
                    </div>
                  </div>
                  {SUBS.map(sub=>{
                    const chapters=sorted(sub);
                    const subDone=chapters.filter(t=>syllabusStatus[sub+"|"+t]==="done").length;
                    const subPct=Math.round((subDone/chapters.length)*100);
                    const subColor=SUBJECT_COLORS[sub];
                    return(
                      <div key={sub} style={{marginBottom:14}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:d.card,border:`1px solid ${d.b}`,borderLeft:`3px solid ${subColor}`,borderRadius:4,marginBottom:2}}>
                          <div style={{fontSize:12,fontWeight:700,color:subColor,flex:1}}>{sub}</div>
                          <div style={{fontSize:10,color:d.t3}}>{subDone}/{chapters.length}</div>
                          <div style={{width:60,height:4,background:d.b,borderRadius:2,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${subPct}%`,background:subColor,borderRadius:2}}/>
                          </div>
                          <div style={{fontSize:11,fontWeight:700,color:subColor,minWidth:28,textAlign:"right"}}>{subPct}%</div>
                        </div>
                        {["H","M","L"].map(wt=>{
                          const wtCh=chapters.filter(t=>(JEE_WEIGHTAGE[sub]?.[t]||"M")===wt);
                          if(!wtCh.length)return null;
                          const wtColor=wt==="H"?d.danger:wt==="M"?d.gold:d.t4;
                          return(
                            <div key={wt}>
                              <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 14px",background:wt==="H"?`${d.danger}06`:wt==="M"?`${d.gold}06`:`${d.t4}06`,borderLeft:`3px solid ${wtColor}30`,borderBottom:`1px solid ${d.b}`}}>
                                <div style={{fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:wtColor}}>{wt==="H"?"High Priority":wt==="M"?"Medium":"Low"}</div>
                                <div style={{fontSize:9,color:d.t4}}>{wtCh.filter(t=>syllabusStatus[sub+"|"+t]==="done").length}/{wtCh.length} done</div>
                              </div>
                              {wtCh.map((topic,idx)=>{
                                const status=syllabusStatus[sub+"|"+topic]||"not_started";
                                const hrs=chHrs(sub,topic);
                                const acc=chAcc(sub,topic);
                                const sOpt=STATUS_OPTS.find(s=>s.v===status)||STATUS_OPTS[0];
                                return(
                                  <div key={topic} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",background:status==="done"?`${d.a2}05`:status==="in_progress"?`${d.a3}05`:status==="need_revision"?`${d.a1}05`:"transparent",borderBottom:`1px solid ${d.b}44`,transition:"background .12s"}}>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontSize:12,fontWeight:500,color:status==="done"?d.t3:d.t,textDecoration:status==="done"?"line-through":"none",textDecorationColor:d.t4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{topic}</div>
                                      <div style={{display:"flex",gap:6,marginTop:2}}>
                                        {hrs>0&&<span style={{fontSize:9,color:d.t3,background:d.hover,padding:"1px 5px",borderRadius:2}}>{fmt(hrs)}</span>}
                                        {acc!==null&&<span style={{fontSize:9,fontWeight:600,color:acc>=70?d.a2:acc>=40?d.gold:d.danger,background:acc>=70?`${d.a2}15`:acc>=40?`${d.gold}15`:`${d.danger}15`,padding:"1px 5px",borderRadius:2}}>{acc}%</span>}
                                      </div>
                                    </div>
                                    <div style={{display:"flex",gap:2,flexShrink:0}}>
                                      {STATUS_OPTS.map(opt=>(
                                        <button key={opt.v} onClick={()=>setSyllabusChapter(sub,topic,opt.v)} title={opt.l}
                                          style={{width:24,height:24,borderRadius:3,fontSize:10,fontWeight:700,cursor:"pointer",background:status===opt.v?opt.bg:d.hover,border:`1px solid ${status===opt.v?opt.c:d.b}`,color:status===opt.v?opt.c:d.t4,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .1s"}}>
                                          {opt.icon}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {tab==="streaks"&&(
              <div className="pin">
                <div className="streak-hero mb13">
                  <div style={{fontSize:10,color:d.t3,letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>streak</div>
                  <div className="streak-num">{streak}</div>
                  <div style={{fontSize:13,color:d.t3,marginTop:3}}>{streak===0?"no streak. every legend starts somewhere.":streak===1?"day one. don't ghost me.":streak<7?`${streak} days. i\'ve been watching.`:`${streak} days straight.${streak>=30?" 🔥":""}`}</div>
                  {currentMilestone&&<div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 13px",borderRadius:20,background:`${d.gold}18`,border:`1px solid ${d.gold}28`,color:d.gold,fontSize:12.5,fontWeight:600,marginTop:10}}>{currentMilestone.icon} {currentMilestone.label}</div>}
                  {nextMilestone&&<div style={{fontSize:11,color:d.t3,marginTop:10}}>{nextMilestone.days-streak} more day{nextMilestone.days-streak!==1?"s":""} to {nextMilestone.icon} {nextMilestone.label}. keep it goingked in 🔒</div>}
                </div>
                <div className="g2 mb13">
                  <div>
                    <div className="cl mb10">milestones</div>
                    {STREAK_MILESTONES.map(b=>{
                      const reached=streak>=b.days;
                      return(
                        <div key={b.days} className={`milestone-row${reached?" reached":""}`}>
                          <div style={{fontSize:18,width:30,textAlign:"center"}}>{b.icon}</div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:12.5,fontWeight:500,color:reached?d.t:d.t3}}>{b.label}</div>
                            <div style={{fontSize:10.5,color:d.t4}}>{b.days} day streak</div>
                          </div>
                          {reached?<div className="m-check">✓</div>:<div className="m-lock">{b.days}</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    {nextMilestone&&(
                      <div className="card cp mb12">
                        <div className="cl mb10">next one</div>
                        <div style={{textAlign:"center",padding:"6px 0"}}>
                          <div style={{fontSize:28,marginBottom:5}}>{nextMilestone.icon}</div>
                          <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{nextMilestone.label}</div>
                          <div style={{fontSize:11,color:d.t3,marginBottom:12}}>{nextMilestone.days} day streak</div>
                          <div className="btrack" style={{height:5,marginBottom:4}}><div className="bfill" style={{width:`${(streak/nextMilestone.days)*100}%`,background:d.a1}}/></div>
                          <div style={{fontSize:10.5,color:d.t4}}>{streak}/{nextMilestone.days}</div>
                        </div>
                      </div>
                    )}
                    <div className="card cp mb12">
                      <div className="cl mb10">stats</div>
                      {[{lbl:"streak",val:`${streak}d`,c:d.a1},{lbl:"study days",val:new Set(sessions.map(s=>s.date)).size,c:d.a2},{lbl:"total sessions",val:sessions.length,c:d.a3},{lbl:"PYQs solved",val:pyqHistory.length,c:d.gold}].map(s=>(
                        <div key={s.lbl} className="rowb" style={{marginBottom:8}}>
                          <span style={{fontSize:12,color:d.t3}}>{s.lbl}</span>
                          <span style={{fontSize:13,fontWeight:600,color:s.c}}>{s.val}</span>
                        </div>
                      ))}
                    </div>
                    <div className="card cp">
                      <div className="cl mb10">60-day history — every square is a day you showed up</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                        {Array.from({length:60},(_,i)=>{
                          const dt=new Date();dt.setDate(dt.getDate()-59+i);
                          const ds=dt.toISOString().split("T")[0];
                          const mins=sessions.filter(s=>s.date===ds).reduce((a,s)=>a+s.duration,0);
                          const op=mins===0?0:mins<60?.3:mins<120?.55:mins<240?.8:1;
                          return <div key={ds} title={`${ds}: ${fmt(mins)||"No study"}`} style={{width:9,height:9,borderRadius:2,background:mins>0?d.a2:d.b,opacity:mins>0?op:.4,border:ds===today()?`1.5px solid ${d.a1}`:"none"}}/>;
                        })}
                      </div>
                      <div style={{display:"flex",gap:5,marginTop:6,alignItems:"center",fontSize:9.5,color:d.t4}}>
                        <span>Less</span>{[.3,.55,.8,1].map((o,i)=><div key={i} style={{width:9,height:9,borderRadius:2,background:d.a2,opacity:o}}/>)}<span>More</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
      {/* Mobile bottom tabs */}
      <div className="mob-tabs">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>switchTab(t.id)}
            style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              gap:1,background:"none",border:"none",cursor:"pointer",padding:"8px 2px",
              color:tab===t.id?d.a1:d.t3,minWidth:0,boxSizing:"border-box"}}>
            <span style={{fontSize:16,lineHeight:1}}>{t.icon}</span>
            <span style={{fontSize:8,fontWeight:tab===t.id?700:400,whiteSpace:"nowrap",overflow:"hidden",maxWidth:"100%",textOverflow:"ellipsis"}}>
              {t.label.slice(0,5)}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

