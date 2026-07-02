import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

const SB_URL  = import.meta.env.VITE_SUPABASE_URL;
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const OR_KEY  = "YOUR_OPENROUTER_KEY";

// ── Supabase Auth helpers ─────────────────────────────────────────────────────
const SB_AUTH = {
  async signUp(email, password) {
    const r = await fetch(`${SB_URL}/auth/v1/signup`, {
      method:"POST",
      headers:{"apikey":SB_ANON,"Content-Type":"application/json"},
      body:JSON.stringify({email,password}),
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error_description||d.msg||"Sign up failed");
    return d;
  },
  async signInEmail(email, password) {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method:"POST",
      headers:{"apikey":SB_ANON,"Content-Type":"application/json"},
      body:JSON.stringify({email,password}),
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error_description||d.msg||"Login failed");
    return d;
  },
  async signOut(accessToken) {
    await fetch(`${SB_URL}/auth/v1/logout`, {
      method:"POST",
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${accessToken}`},
    });
    localStorage.removeItem("slothr_auth");
  },
  async getUser(accessToken) {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${accessToken}`},
    });
    if(!r.ok) return null;
    return await r.json();
  },
  async loadData(table, userId, accessToken) {
    const r = await fetch(
      `${SB_URL}/rest/v1/${table}?user_id=eq.${userId}&select=*&order=created_at.asc`,
      {headers:{"apikey":SB_ANON,"Authorization":`Bearer ${accessToken}`}}
    );
    if(!r.ok) return [];
    return await r.json();
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// ── Math renderer — proper stacked fractions via JSX ─────────────────────────
// Parses a LaTeX-subset string into tokens, renders as React elements.
// Supports: \frac{}{}, \sqrt{}, ^{}, _{}, Greek, trig inverses, operators.

function parseMath(raw) {
  // Returns array of token objects: {t:"txt"|"frac"|"sqrt"|"sup"|"sub", ...}
  const out = [];
  let i = 0;
  const BSRE = /^\\([a-zA-Z]+|\^)/;

  function readBraced(from) {
    // reads {content} starting at from, returns [content, endIndex]
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

    // backslash command
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
function addDays(dateStr,n){const d=new Date(dateStr);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function daysBetween(a,b){return Math.round((new Date(b)-new Date(a))/86400000);}
function isOverdue(dateStr){return dateStr<today();}
function isDueToday(dateStr){return dateStr===today();}
function isDueSoon(dateStr){const d=daysBetween(today(),dateStr);return d>=0&&d<=2;}
function calcStreak(sessions){
  const days=[...new Set(sessions.map(s=>s.date))].sort().reverse();
  if(!days.length)return 0;
  // Use local date string to avoid timezone issues
  const todayStr=(()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");})();
  let streak=0,curStr=todayStr;
  for(const d of days){
    const diff=daysBetween(d,curStr);
    if(diff===0||diff===1){streak++;curStr=d;}
    else break;
  }
  return streak;
}
function weekdayIndex(dateStr){const jsDay=new Date(dateStr+"T00:00:00").getDay();return (jsDay+6)%7;} // Mon=0..Sun=6
function weekStartOf(dateStr){return addDays(dateStr,-weekdayIndex(dateStr));}
function longestStreak(sessions){
  const days=[...new Set(sessions.map(s=>s.date))].sort();
  if(!days.length)return 0;
  let longest=1,cur=1;
  for(let i=1;i<days.length;i++){
    if(daysBetween(days[i-1],days[i])===1){cur++;longest=Math.max(longest,cur);}
    else cur=1;
  }
  return longest;
}
// ── Roadmap generator — distributes all topics for a level across study days ──
function allTopicsForLevel(level){
  const out=[];
  Object.keys(TOPICS).forEach(sub=>{
    const list=TOPICS[sub]?.[level]||[];
    list.forEach(topic=>out.push({subject:sub,topic,weight:getWeight(sub,topic,level)}));
  });
  const order={H:0,M:1,L:2};
  return out.sort((a,b)=>order[a.weight]-order[b.weight]);
}
function generateRoadmap({level,examDate,studyDays,answers}){
  let topics=allTopicsForLevel(level);
  if(topics.length===0||!examDate) return {weeks:[],totalDays:0};
  // Filter out topics user already completed in questionnaire
  if(answers&&!answers.skipped&&answers.completedTopics){
    topics=topics.filter(t=>!answers.completedTopics[t.subject+"|"+t.topic]);
  }
  const weakSet=new Set(answers?.weakAreas||[]);
  const totalDaysToExam=Math.max(1,daysBetween(today(),examDate));
  const revisionDays=Math.min(14,Math.max(5,Math.round(totalDaysToExam*0.12)));
  const studyPhaseDays=Math.max(1,totalDaysToExam-revisionDays);
  const studyDates=[];
  for(let i=0;i<studyPhaseDays;i++){
    const dt=addDays(today(),i);
    if((studyDays||[]).includes(weekdayIndex(dt))) studyDates.push(dt);
  }
  if(studyDates.length===0) return {weeks:[],totalDays:totalDaysToExam,revisionDays,noStudyDays:true};
  const passesFor={H:3,M:2,L:1};
  const sessionPool=[];
  topics.forEach(t=>{
    const base=passesFor[t.weight]||1;
    const boost=weakSet.has(t.subject)?1:0; // extra pass for weak areas
    const passes=base+boost;
    for(let p=0;p<passes;p++) sessionPool.push({...t,pass:p+1,totalPasses:passes});
  });
  sessionPool.sort((a,b)=>a.pass-b.pass);
  const perDaySessions=Math.max(1,Math.round(sessionPool.length/studyDates.length));
  const assignments=studyDates.map(dt=>({date:dt,items:[]}));
  let poolIdx=0,dayIdx=0;
  while(poolIdx<sessionPool.length){
    const slot=assignments[dayIdx%assignments.length];
    if(slot.items.length<perDaySessions||dayIdx>=assignments.length){slot.items.push(sessionPool[poolIdx]);poolIdx++;}
    dayIdx++;
    if(dayIdx>assignments.length*6) break;
  }
  while(poolIdx<sessionPool.length){assignments[assignments.length-1].items.push(sessionPool[poolIdx]);poolIdx++;}
  const weeksMap={};
  assignments.forEach(a=>{
    const wIdx=Math.floor(daysBetween(today(),a.date)/7);
    if(!weeksMap[wIdx]) weeksMap[wIdx]=[];
    weeksMap[wIdx].push(a);
  });
  const weeks=Object.keys(weeksMap).sort((a,b)=>a-b).map(k=>({weekNum:parseInt(k)+1,days:weeksMap[k]}));
  const revisionStart=addDays(examDate,-revisionDays);
  const revisionTopics=topics.filter(t=>t.weight==="H"||t.weight==="M");
  return {weeks,totalDays:totalDaysToExam,studyDates,revisionDays,revisionStart,revisionTopics,totalSessions:sessionPool.length,perDaySessions};
}
function itemKey(date,item){return date+"|"+item.subject+"|"+item.topic+"|"+item.pass;}

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
    bg:"#0a0a0f",sb:"#0d0d15",card:"#12121e",hover:"#1a1a28",
    b:"rgba(255,255,255,0.06)",bs:"rgba(255,255,255,0.12)",
    t:"#f0f0ff",t2:"#c0c0e0",t3:"#7070a0",t4:"#404060",
    a1:"#6c63ff",a2:"#00d4aa",a3:"#ff6b9d",
    gold:"#ffd166",danger:"#ff4d6d",
    inp:"#1a1a28",ring:"#6c63ff",
    div:"rgba(255,255,255,0.05)",
    tag:"rgba(255,255,255,0.04)",
    sa:"rgba(108,99,255,0.08)",sab:"rgba(108,99,255,0.2)",
    inpb:"rgba(255,255,255,0.08)",
    sh1:"#1a1a28",sh2:"#222235",
    sm:"#7070a0",
  },
  light:{
    bg:"#f5f5ff",sb:"#ededfc",card:"#ffffff",hover:"#ededfc",
    b:"rgba(0,0,0,0.07)",bs:"rgba(0,0,0,0.14)",
    t:"#0a0a1a",t2:"#2a2a4a",t3:"#6060a0",t4:"#b0b0d0",
    a1:"#5a52e8",a2:"#00b894",a3:"#e8437a",
    gold:"#e8a000",danger:"#e8285a",
    inp:"#f5f5ff",ring:"#5a52e8",
    div:"rgba(0,0,0,0.05)",
    tag:"rgba(0,0,0,0.03)",
    sa:"rgba(90,82,232,0.06)",sab:"rgba(90,82,232,0.18)",
    inpb:"rgba(0,0,0,0.08)",
    sh1:"#ededfc",sh2:"#e5e5f8",
    sm:"#6060a0",
  },
};





// ── Placeholder papers — replace questions with real ones from your DB ────────
const SUBJECT_COLORS = {
  Ethics:"#6c63ff",
  Quantitative:"#00d4aa",
  Economics:"#ffd166",
  "Fin. Reporting":"#ff6b9d",
  "Corp. Issuers":"#4ecdc4",
  Equity:"#45b7d1",
  "Fixed Income":"#96ceb4",
  Derivatives:"#ff9f43",
  "Alt. Investments":"#a29bfe",
  "Portfolio Mgmt":"#fd79a8",
};

// ── Real CFA exam windows (2026) ──────────────────────────────────────────────
const CFA_EXAM_WINDOWS = {
  L1: [
    {id:"2026-08",label:"August 2026",start:"2026-08-18",end:"2026-08-24"},
    {id:"2026-11",label:"November 2026",start:"2026-11-11",end:"2026-11-17"},
    {id:"2027-02",label:"February 2027",start:"2027-02-08",end:"2027-02-14"},
    {id:"2027-05",label:"May 2027",start:"2027-05-17",end:"2027-05-23"},
  ],
  L2: [
    {id:"2026-08",label:"August 2026",start:"2026-08-25",end:"2026-08-29"},
    {id:"2026-11",label:"November 2026",start:"2026-11-18",end:"2026-11-22"},
    {id:"2027-05",label:"May 2027",start:"2027-05-19",end:"2027-05-23"},
  ],
  L3: [
    {id:"2026-08",label:"August 2026",start:"2026-08-13",end:"2026-08-17"},
    {id:"2027-02",label:"February 2027",start:"2027-02-03",end:"2027-02-07"},
    {id:"2027-08",label:"August 2027",start:"2027-08-12",end:"2027-08-16"},
  ],
};
const CFA_RECOMMENDED_HOURS = {L1:300, L2:328, L3:344}; // CFA Institute candidate survey averages

const TOPICS = {
  Ethics:{
    L1:["Code of Ethics","Standards of Professional Conduct","GIPS"],
    L2:["Code of Ethics","Standards of Professional Conduct","GIPS","Asset Manager Code"],
    L3:["Code of Ethics","Standards of Professional Conduct","GIPS","Asset Manager Code"],
  },
  Quantitative:{
    L1:["Time Value of Money","Statistical Concepts","Probability","Sampling","Hypothesis Testing","Correlation & Regression"],
    L2:["Correlation & Regression","Time Series Analysis","Machine Learning","Big Data"],
    L3:["Quantitative Methods"],
  },
  Economics:{
    L1:["Microeconomics","Macroeconomics","Global Trade","Currency Exchange","Business Cycles"],
    L2:["Economics & Investment Markets","Analysis of Active Investment Management"],
    L3:["Capital Market Expectations","Economics & Investment"],
  },
  "Fin. Reporting":{
    L1:["Financial Statements","Income Statement","Balance Sheet","Cash Flow","Inventories","PP&E","Deferred Taxes","Long-Term Debt","Leases","Intercorporate Investments","Multinational Operations","Financial Ratios"],
    L2:["Intercorporate Investments","Pension & Employee Benefits","Multinational Operations","Evaluating Quality of Financial Reports","Integration of Financial Analysis"],
    L3:[],
  },
  "Corp. Issuers":{
    L1:["Capital Budgeting","Cost of Capital","Leverage","Working Capital","Corporate Governance","ESG"],
    L2:["Capital Structure","Dividends","Corporate Governance & ESG"],
    L3:["Corporate Issuers"],
  },
  Equity:{
    L1:["Market Organisation","Securities","Equity Valuation Intro","Industry Analysis","DCF Valuation","Price Multiples"],
    L2:["Equity Valuation DDM","FCF Valuation","Price Multiples","Residual Income","Private Company Valuation"],
    L3:["Equity Portfolio Management","Active Equity Investing"],
  },
  "Fixed Income":{
    L1:["Bond Features","Bond Valuation","Duration & Convexity","Credit Analysis","MBS"],
    L2:["Term Structure","Credit Analysis","CDS","MBS"],
    L3:["Fixed Income Portfolio Management","Liability-Driven Investing","Yield Curve Strategies"],
  },
  Derivatives:{
    L1:["Futures & Forwards","Options","Swaps","Risk Management"],
    L2:["Derivatives Valuation","Options Strategies"],
    L3:["Derivatives & Currency Management","Options Strategies"],
  },
  "Alt. Investments":{
    L1:["Alternative Investment Features","Hedge Funds","Private Equity","Real Estate","Commodities"],
    L2:["Real Estate","Private Equity","Commodities","Infrastructure"],
    L3:["Alternative Investments Portfolio Management"],
  },
  "Portfolio Mgmt":{
    L1:["Portfolio Management Intro","IPS","Risk & Return","Basics of Portfolio Planning"],
    L2:["Portfolio Concepts","Risk Management","Algorithmic Trading"],
    L3:["Portfolio Management Process","IPS","Behavioural Finance","Risk Management","Algorithmic Trading","Performance Evaluation","GIPS"],
  },
};
// CFA exam weights (approximate % of exam)
const CFA_WEIGHTS = {
  Ethics:{"L1":"H","L2":"H","L3":"H"},              // 15-20% all levels
  Quantitative:{"L1":"H","L2":"M","L3":"L"},        // 8-12% L1
  Economics:{"L1":"M","L2":"M","L3":"M"},           // 8-12% L1
  "Fin. Reporting":{"L1":"H","L2":"H","L3":"L"},    // 13-17% L1, highest weight
  "Corp. Issuers":{"L1":"M","L2":"M","L3":"L"},     // 8-12% L1
  Equity:{"L1":"H","L2":"H","L3":"H"},              // 10-12% L1
  "Fixed Income":{"L1":"H","L2":"H","L3":"H"},      // 10-12% L1
  Derivatives:{"L1":"M","L2":"M","L3":"H"},         // 5-8% L1
  "Alt. Investments":{"L1":"M","L2":"M","L3":"M"},  // 5-8% L1
  "Portfolio Mgmt":{"L1":"M","L2":"M","L3":"H"},    // 5-8% L1, 35-40% L3
};
// Weights are looked up live via getWeight(subject, topic, level) — see below
function getWeight(sub, topic, level){
  const lvlWeights = CFA_WEIGHTS[sub]||{};
  return lvlWeights[level||"L1"]||"M";
}
// Exam weight % ranges per topic area per level (from CFA Institute curriculum)
const TOPIC_WEIGHT_RANGES = {
  Ethics:           {L1:"15-20%",L2:"10-15%",L3:"10-15%"},
  Quantitative:     {L1:"8-12%", L2:"5-10%", L3:"0-5%"},
  Economics:        {L1:"8-12%", L2:"5-10%", L3:"5-10%"},
  "Fin. Reporting": {L1:"13-17%",L2:"10-15%",L3:"0%"},
  "Corp. Issuers":  {L1:"8-12%", L2:"5-10%", L3:"0%"},
  Equity:           {L1:"10-12%",L2:"10-15%",L3:"10-15%"},
  "Fixed Income":   {L1:"10-12%",L2:"10-15%",L3:"15-20%"},
  Derivatives:      {L1:"5-8%",  L2:"5-10%", L3:"5-10%"},
  "Alt. Investments":{L1:"5-8%", L2:"5-10%", L3:"5-10%"},
  "Portfolio Mgmt": {L1:"5-8%",  L2:"10-15%",L3:"35-40%"},
};

// Per-topic exam probability scores (modeled like Mathongo's weightage sheets)
// Scale: 5=very high, 4=high, 3=medium, 2=low, 1=rarely tested
const TOPIC_PROBABILITY = {
  Ethics: {
    "Code of Ethics":5, "Standards of Professional Conduct":5, "GIPS":3, "Asset Manager Code":3,
  },
  Quantitative: {
    "Time Value of Money":5, "Statistical Concepts":4, "Probability":4,
    "Sampling":3, "Hypothesis Testing":3, "Correlation & Regression":4,
    "Time Series Analysis":3, "Machine Learning":3, "Big Data Techniques":2,
    "Quantitative Methods for Portfolio Management":3,
  },
  Economics: {
    "Microeconomics":3, "Macroeconomics":4, "Global Trade":3,
    "Currency Exchange":4, "Business Cycles":4,
    "Economics & Investment Markets":3, "Currency Exchange Rates":3,
    "Capital Market Expectations":4,
  },
  "Fin. Reporting": {
    "Intro to Financial Statements":3, "Income Statement":5, "Balance Sheet":5,
    "Cash Flow Statement":5, "Inventories":4, "PP&E":4, "Deferred Taxes":3,
    "Long-Term Debt":4, "Leases":3, "Intercorporate Investments":5,
    "Multinational Operations":4, "Financial Ratio Analysis":5,
    "Pension & Employee Benefits":4, "Evaluating Quality of Reports":4,
  },
  "Corp. Issuers": {
    "Capital Budgeting":4, "Cost of Capital":5, "Capital Structure":4,
    "Working Capital":3, "Corporate Governance":4, "ESG Considerations":3,
    "Dividends & Share Repurchases":4, "Corporate Governance & ESG":3,
  },
  Equity: {
    "Market Organisation":3, "Security Market Indices":3, "Equity Valuation Basics":4,
    "Industry Analysis":4, "DCF Valuation":5, "Price Multiples":5,
    "Equity Valuation: DDM":5, "Free Cash Flow Valuation":5,
    "Residual Income":4, "Private Company Valuation":4,
    "Equity Portfolio Management":4, "Active Equity Investing":4,
  },
  "Fixed Income": {
    "Bond Features":4, "Bond Valuation":5, "Yield Measures":4,
    "Duration & Convexity":5, "Credit Analysis":5, "Asset-Backed Securities":4,
    "Term Structure & Interest Rates":5, "Credit Default Swaps":4, "MBS / ABS":4,
    "Fixed Income Portfolio Management":5, "Liability-Driven Investing":4,
    "Yield Curve Strategies":4,
  },
  Derivatives: {
    "Futures & Forwards":4, "Options Basics":4, "Swaps":4,
    "Risk Management with Derivatives":4, "Derivatives Valuation & Strategies":4,
    "Derivatives & Currency Management":4,
  },
  "Alt. Investments": {
    "Alt Investment Features":3, "Hedge Funds":4, "Private Equity":4,
    "Real Estate":4, "Commodities":3, "Infrastructure":3,
    "Alternative Investments Portfolio Management":4,
  },
  "Portfolio Mgmt": {
    "Portfolio Management Intro":3, "Investment Policy Statements":5,
    "Risk & Return Basics":4, "Portfolio Construction":4, "Risk Management":4,
    "Algorithmic Trading":3, "Portfolio Management Process":5, "IPS Construction":5,
    "Behavioural Finance":4, "Performance Evaluation":4, "GIPS Application":4,
  },
};
function getTopicProbability(sub, topic){ return TOPIC_PROBABILITY[sub]?.[topic]||3; }
function getProbabilityLabel(score){
  // Dead simple: emoji + one word, like a traffic light. No dots, no jargon.
  if(score>=5) return {label:"Definitely Asked",emoji:"🔴",color:"#ff4d6d",short:"Must Know"};
  if(score>=4) return {label:"Very Likely",emoji:"🟠",color:"#ff9f43",short:"Important"};
  if(score>=3) return {label:"Sometimes Asked",emoji:"🟡",color:"#ffd166",short:"Good to Know"};
  if(score>=2) return {label:"Rarely Asked",emoji:"🟢",color:"#00d4aa",short:"Low Priority"};
  return {label:"Almost Never Asked",emoji:"⚪",color:"#7878a8",short:"Skip if Short on Time"};
}

const CLASSES = [
  {id:"L1", label:"CFA Level 1", icon:"Ⅰ"},
  {id:"L2", label:"CFA Level 2", icon:"Ⅱ"},
  {id:"L3", label:"CFA Level 3", icon:"Ⅲ"},
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
  {id:"rank",label:"Readiness",icon:"🎯"},
  {id:"goals",label:"Today's Goals",icon:"◎"},
  {id:"planner",label:"Planner",icon:"📅"},
  {id:"syllabus",label:"Syllabus",icon:"📋"},
  {id:"revision",label:"Revision",icon:"↺"},
  {id:"mocks",label:"Mock Scores",icon:"📝"},
  {id:"sessions",label:"Sessions",icon:"◷"},
  {id:"coach",label:"Analytics",icon:"◈"},
  {id:"streaks",label:"Streaks",icon:"🔥"},
  {id:"buddy",label:"Study Buddy",icon:"🤝"},
  {id:"report",label:"Weekly Report",icon:"📨"},
  {id:"profile",label:"Profile",icon:"◯"},
];


// ── Placeholder questions — you'll populate these from Supabase ───────────────
// Each question: { id, section, type:"mcq"|"numerical", text, options:{A,B,C,D}, correct, solution }
// ── PLACEHOLDER QUESTIONS ────────────────────────────────────────────────────
// Replace these with real questions fetched from Supabase.
// IMPORTANT: every real question MUST include a `topic` field (chapter name).
// This is how the Analytics tab and AI coach know which chapter you got wrong.
// Supabase schema: { id, paper_id, section, qno, type, text, options, correct, solution, topic, difficulty }
// ─────────────────────────────────────────────────────────────────────────────const SEC_SHORT = {Physics:"PHY", Chemistry:"CHEM", Mathematics:"MATH"};

// NTA palette — intentionally clinical/utilitarian (matches real NTA UI)
// ── NTA Theme — light matches real NTA exactly, dark is adapted ──────────────


// ── Question Status ───────────────────────────────────────────────────────────
// notVisited | notAnswered | answered | markedReview | answeredMarked


// ─────────────────────────────────────────────────────────────────────────────
// PAPER LIST — card view
// ─────────────────────────────────────────────────────────────────────────────










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
          <div style={{fontSize:12, color:"#8a8070", marginTop:4}}>your CFA exam co-pilot.</div>
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


function buildCSS(d,dark,sideOpen,SW,subColor,sT,sW6,sOD,sOO,sOP,tBg,fsB,fsDo,sIP,sIJ){
// sT=sideTranslate, sW6=sideW600, sOD=sbOverlayDisplay, sOO=sbOverlayOp, sOP=sbOverlayPE
// tBg=topbarBg, fsB=fsOverlayBg, fsDo=fsDoneBg, sIP=sItemPad, sIJ=sItemJust
var c=[];
c.push("@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&display=swap');");
c.push("html,body{overflow-x:hidden;margin:0;padding:0;width:100%;}");
c.push("*{box-sizing:border-box;}");
c.push("*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}");
c.push("body{background:"+d.bg+";font-family:'DM Sans',sans-serif;color:"+d.t+";-webkit-font-smoothing:antialiased;}");
c.push("*{transition:background-color .18s,border-color .18s,color .12s;}");
c.push("::-webkit-scrollbar{width:2px;} ::-webkit-scrollbar-thumb{background:"+d.b+";border-radius:1px;}");
c.push(".layout{display:block;min-height:100vh;width:100%;background:"+d.bg+";}");
c.push(".sidebar{width:"+SW+"px;min-height:100vh;background:"+d.sb+";border-right:1px solid "+d.b+";position:fixed;top:0;left:0;display:flex;flex-direction:column;z-index:50;overflow:hidden;transition:transform .28s cubic-bezier(.16,1,.3,1),width .28s cubic-bezier(.16,1,.3,1);}");
c.push(".content{margin-left:"+SW+"px;min-height:100vh;overflow-x:hidden;box-sizing:border-box;width:calc(100vw - "+SW+"px);}");
c.push(".inner{max-width:1060px;padding:32px 40px;width:100%;margin:0 auto;box-sizing:border-box;overflow-x:hidden;}");
c.push("@media(min-width:1400px){.inner{padding:36px 60px;}.topbar{padding:0 60px;}}");
c.push("@media(max-width:1100px){.inner{padding:28px 32px;}.topbar{padding:0 32px;}}");
c.push("@media(max-width:900px){.content{margin-left:0!important;width:100%!important;}.inner{padding:20px 18px;}.topbar{padding:0 18px!important;}.g3{grid-template-columns:1fr 1fr!important;}.g4{grid-template-columns:1fr 1fr!important;}.coach-grid{grid-template-columns:1fr 1fr!important;}.stat-num{font-size:26px!important;}.sidebar{transform:translateX("+sT+");width:260px!important;}}");
c.push("@media(max-width:600px){.content{margin-left:0!important;width:100%!important;}.inner{padding:14px 14px!important;}.topbar{padding:0 14px!important;min-height:52px;}.g2{grid-template-columns:1fr 1fr!important;}.g3,.g4{grid-template-columns:1fr 1fr!important;}.coach-grid{grid-template-columns:1fr!important;}.stat-num{font-size:20px!important;}.ptitle{font-size:15px!important;}.psub{display:none!important;}.section-head{font-size:16px!important;}.snotes{display:none;}.sidebar{transform:translateX("+sT+");width:80vw!important;max-width:280px!important;}}");
c.push("@media(max-width:380px){.g2,.g3,.g4{grid-template-columns:1fr!important;}.inner{padding:12px 10px!important;}}");
c.push(".sb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:45;cursor:pointer;opacity:"+sOO+";pointer-events:"+sOP+";transition:opacity .25s;}");
c.push("@media(min-width:901px){.sb-overlay{display:none;}}");
c.push(".mob-btn{display:none;width:34px;height:34px;border-radius:6px;background:"+d.hover+";border:1px solid "+d.b+";cursor:pointer;align-items:center;justify-content:center;color:"+d.t+";font-size:18px;flex-shrink:0;}");
c.push("@media(max-width:900px){.mob-btn{display:flex;}}");
c.push(".s-logo{padding:18px 16px 14px;border-bottom:1px solid "+d.b+";display:flex;align-items:center;gap:10px;min-height:58px;flex-shrink:0;}");
c.push(".s-brand{font-size:16px;font-weight:700;color:"+d.t+";letter-spacing:-.05em;white-space:nowrap;line-height:1;font-family:'DM Serif Display',serif;}");
c.push(".s-toggle{width:26px;height:26px;border-radius:4px;background:transparent;border:1px solid "+d.b+";cursor:pointer;display:flex;align-items:center;justify-content:center;color:"+d.t3+";font-size:11px;flex-shrink:0;}");
c.push(".s-toggle:hover{color:"+d.t+";border-color:"+d.bs+";}");
c.push(".s-nav{padding:10px 8px;flex:1;overflow-y:auto;overflow-x:hidden;}");
c.push(".s-sec{font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:"+d.t4+";padding:0 8px;margin:14px 0 4px;font-family:'DM Sans',sans-serif;font-weight:600;}");
c.push(".s-item{display:flex;align-items:center;gap:9px;padding:"+sIP+";border-radius:3px;cursor:pointer;color:"+d.t3+";font-size:12px;margin-bottom:1px;border:1px solid transparent;user-select:none;justify-content:"+sIJ+";font-weight:500;letter-spacing:.01em;}");
c.push(".s-item:hover{color:"+d.t+";background:"+d.hover+";}");
c.push(".s-item.active{color:"+d.t+";background:"+d.hover+";font-weight:600;}");
c.push(".s-icon{font-size:12px;flex-shrink:0;width:16px;text-align:center;opacity:.6;}");
c.push(".s-item.active .s-icon{opacity:1;}");
c.push(".s-label{white-space:nowrap;overflow:hidden;}");
c.push(".s-footer{padding:12px 14px;border-top:1px solid "+d.b+";flex-shrink:0;}");
c.push(".s-av{width:26px;height:26px;border-radius:2px;background:"+d.a1+";display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;flex-shrink:0;}");
c.push(".s-uinfo{overflow:hidden;}");
c.push(".topbar{display:flex;align-items:center;justify-content:space-between;padding:0 40px;border-bottom:1px solid "+d.b+";background:"+tBg+";position:sticky;top:0;z-index:10;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);min-height:60px;width:100%;box-sizing:border-box;}");
c.push(".ptitle{font-size:18px;font-weight:400;letter-spacing:-.02em;font-family:'DM Serif Display',serif;line-height:1;}");
c.push(".psub{font-size:11px;color:"+d.t3+";margin-top:3px;letter-spacing:.01em;font-style:italic;}");
c.push(".tbr{display:flex;align-items:center;gap:7px;}");
c.push(".icon-btn{width:30px;height:30px;border-radius:3px;background:transparent;border:1px solid "+d.b+";cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;color:"+d.t3+";}");
c.push(".icon-btn:hover{border-color:"+d.bs+";color:"+d.t+";}");
c.push(".ghost-sm{background:transparent;color:"+d.t3+";border:1px solid "+d.b+";border-radius:3px;padding:5px 12px;font-family:'DM Sans',sans-serif;font-size:11px;cursor:pointer;font-weight:500;}");
c.push(".ghost-sm:hover{color:"+d.t+";border-color:"+d.bs+";}");
c.push(".card{background:"+d.card+";border:1px solid "+d.b+";border-radius:2px;}");
c.push(".cp{padding:20px 22px;}");
c.push(".cl{font-size:8.5px;color:"+d.t3+";font-weight:700;letter-spacing:.16em;text-transform:uppercase;font-family:'DM Sans',sans-serif;}");
c.push(".g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}");
c.push(".g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}");
c.push(".g4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}");
c.push(".mb12{margin-bottom:12px;}.mb16{margin-bottom:16px;}");
c.push(".field{margin-bottom:11px;}");
c.push(".fl{display:block;font-size:10px;color:"+d.t3+";margin-bottom:5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;}");
c.push("input.inp,textarea.inp{width:100%;padding:9px 13px;border:1px solid "+d.b+";border-radius:3px;background:"+d.inp+";font-family:'DM Sans',sans-serif;font-size:13px;color:"+d.t+";outline:none;}");
c.push("input.inp:focus,textarea.inp:focus{border-color:"+d.a1+"66;}");
c.push("input.inp::placeholder{color:"+d.t4+";}");
c.push(".btn{border:none;border-radius:3px;padding:9px 18px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px;letter-spacing:.02em;}");
c.push(".btn-d{background:"+d.t+";color:"+d.bg+";}");
c.push(".btn-d:hover{opacity:.84;}.btn-d:disabled{opacity:.25;cursor:not-allowed;}");
c.push(".btn-full{width:100%;padding:11px;}.btn-danger{background:"+d.danger+";color:#fff;}");
c.push(".btrack{height:2px;background:"+d.b+";border-radius:1px;overflow:hidden;}");
c.push(".bfill{height:100%;border-radius:1px;transition:width .8s cubic-bezier(.16,1,.3,1);}");
c.push(".dot{width:5px;height:5px;border-radius:50%;}.row{display:flex;align-items:center;}.rowb{display:flex;align-items:center;justify-content:space-between;}.f1{flex:1;}");
c.push(".pin{animation:pin .2s ease;}@keyframes pin{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}");
c.push(".shim{border-radius:2px;height:10px;background:linear-gradient(90deg,"+d.b+" 25%,"+d.hover+" 50%,"+d.b+" 75%);background-size:200%;animation:sh 1.5s infinite;margin-bottom:8px;}@keyframes sh{0%{background-position:200%}100%{background-position:-200%}}");
c.push(".empty{text-align:center;padding:44px 20px;}");
c.push(".et{font-size:13px;font-weight:500;color:"+d.t3+";margin-bottom:3px;font-style:italic;font-family:'DM Serif Display',serif;}");
c.push(".es{font-size:11px;color:"+d.t4+";}");
c.push("hr{border:none;border-top:1px solid "+d.b+";margin:14px 0;}");
c.push(".rec-dot{display:inline-block;width:4px;height:4px;background:"+subColor+";border-radius:50%;margin-right:5px;animation:blink 1.2s infinite;}@keyframes blink{0%,100%{opacity:1}50%{opacity:.1}}");
c.push("@keyframes ring-pulse{0%,100%{opacity:1}50%{opacity:.3}}.ring-alert{animation:ring-pulse .75s infinite;}");
c.push(".stat-num{font-family:'DM Serif Display',serif;font-size:38px;font-weight:400;line-height:1;letter-spacing:-.02em;}");
c.push(".stat-label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:"+d.t3+";margin-top:5px;}");
c.push(".stat-hint{font-size:11px;color:"+d.t3+";margin-top:4px;font-style:italic;}");
c.push(".sec-rule{display:flex;align-items:center;gap:10px;margin-bottom:16px;}.sec-rule-line{flex:1;height:1px;background:"+d.b+";}.sec-rule-label{font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:"+d.t4+";}");
c.push(".section-head{font-family:'DM Serif Display',serif;font-size:22px;font-weight:400;letter-spacing:-.02em;color:"+d.t+";line-height:1.2;margin-bottom:4px;}");
c.push(".section-sub{font-size:11px;color:"+d.t3+";margin-bottom:20px;font-style:italic;}");
c.push(".mode-tab{display:flex;background:"+d.inp+";border:1px solid "+d.b+";border-radius:10px;padding:3px;gap:3px;margin-bottom:16px;}");
c.push(".mode-opt{flex:1;padding:7px;border-radius:7px;border:none;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;cursor:pointer;background:none;color:"+d.t3+";}");
c.push(".mode-opt.active{background:"+d.card+";color:"+d.t+";box-shadow:0 1px 4px rgba(0,0,0,.2);}");
c.push(".ring-wrap{position:relative;width:200px;height:200px;margin:0 auto;}");
c.push(".ring-svg{position:absolute;inset:0;width:100%;height:100%;}");
c.push(".ring-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}");
c.push(".ring-time{font-size:42px;font-weight:300;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;}");
c.push(".ring-sub{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:"+d.t4+";margin-top:4px;}");
c.push(".fs-overlay{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:"+fsB+";}");
c.push(".fs-exit{position:absolute;top:20px;right:22px;background:"+d.hover+";border:1px solid "+d.b+";border-radius:8px;padding:7px 13px;font-family:'DM Sans',sans-serif;font-size:12px;color:"+d.t3+";cursor:pointer;}");
c.push(".fs-exit:hover{color:"+d.t+";}.fs-sub{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:"+subColor+";margin-bottom:6px;}");
c.push(".fs-topic{font-size:14px;color:"+d.t2+";margin-bottom:32px;}.fs-time{font-size:100px;font-weight:200;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums;color:"+d.t+";}");
c.push(".fs-actions{display:flex;gap:12px;margin-top:36px;}.fs-btn{padding:12px 28px;border-radius:10px;border:none;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;}");
c.push(".fs-btn-stop{background:"+d.danger+";color:#fff;}.fs-btn-pause{background:"+d.hover+";color:"+d.t+";border:1px solid "+d.b+";}.fs-done{text-align:center;}");
c.push(".fs-ring-wrap{position:relative;width:300px;height:300px;margin:0 auto 12px;}");
c.push(".coach-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:16px;width:100%;}");
c.push(".coach-card{padding:17px;border-radius:12px;border:1px solid "+d.b+";background:"+d.card+";position:relative;overflow:hidden;}");
c.push(".coach-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}");
c.push(".coach-card.danger::before{background:"+d.danger+";}.coach-card.success::before{background:"+d.a2+";}.coach-card.warning::before{background:"+d.gold+";}.coach-card.info::before{background:"+d.a3+";}.coach-card.primary::before{background:"+d.a1+";}");
c.push(".cc-icon{font-size:19px;margin-bottom:9px;}.cc-title{font-size:12px;font-weight:600;color:"+d.t+";margin-bottom:7px;}");
c.push(".cc-insight{font-size:11.5px;color:"+d.t2+";line-height:1.7;margin-bottom:9px;}");
c.push(".cc-topics{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px;}.cc-topic{font-size:10px;padding:2px 7px;border-radius:20px;font-weight:500;}");
c.push(".cc-action{font-size:11px;color:"+d.t3+";padding:8px 10px;background:"+d.hover+";border-radius:7px;line-height:1.5;border-left:2px solid "+d.a1+";}");
c.push(".goal-item{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-radius:9px;margin-bottom:6px;border:1px solid "+d.b+";background:"+d.card+";}");
c.push(".goal-item.achieved{border-color:"+d.a2+"30;background:"+d.a2+"05;}");
c.push(".goal-check{width:19px;height:19px;border-radius:50%;border:1.5px solid "+d.b+";display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0;margin-top:1px;cursor:pointer;}");
c.push(".goal-check.done{background:"+d.a2+";border-color:"+d.a2+";color:white;}");
c.push(".goal-text{font-size:13px;flex:1;line-height:1.4;}.goal-text.done{text-decoration:line-through;color:"+d.t3+";}");
c.push(".goal-meta{font-size:10.5px;color:"+d.t3+";margin-top:2px;}");
c.push(".goal-ai-badge{font-size:9px;padding:1px 6px;border-radius:20px;background:"+d.a3+"18;color:"+d.a3+";font-weight:500;flex-shrink:0;}");
c.push(".goal-prog{height:2px;background:"+d.b+";border-radius:2px;overflow:hidden;margin-top:5px;}.goal-prog-fill{height:100%;border-radius:2px;background:"+d.a2+";}");
c.push(".streak-hero{text-align:center;padding:24px 20px;border-radius:14px;background:linear-gradient(135deg,"+d.a1+"10,"+d.a3+"10);border:1px solid "+d.b+";margin-bottom:13px;}");
c.push(".streak-num{font-size:60px;font-weight:700;letter-spacing:-.04em;line-height:1;color:"+d.a1+";}");
c.push(".milestone-row{display:flex;align-items:center;gap:10px;padding:10px 13px;border-radius:9px;margin-bottom:3px;border:1px solid transparent;}");
c.push(".milestone-row.reached{background:"+d.hover+";border-color:"+d.b+";}.milestone-row:not(.reached){opacity:.38;}");
c.push(".m-check{width:18px;height:18px;border-radius:50%;background:"+d.a2+";display:flex;align-items:center;justify-content:center;font-size:9px;color:white;flex-shrink:0;}");
c.push(".m-lock{width:18px;height:18px;border-radius:50%;background:"+d.b+";display:flex;align-items:center;justify-content:center;font-size:9px;color:"+d.t4+";flex-shrink:0;}");
c.push(".srow{display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid "+d.b+";margin-bottom:0;}");
c.push(".srow:hover{background:transparent;}.ssub{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;width:70px;flex-shrink:0;}");
c.push(".stopic{font-size:13px;flex:1;}.snotes{font-size:11px;color:"+d.t3+";flex:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}");
c.push(".sdur{font-size:10.5px;color:"+d.t3+";background:"+d.hover+";padding:2px 8px;border-radius:20px;flex-shrink:0;border:1px solid "+d.b+";}.sdate{font-size:10px;color:"+d.t4+";flex-shrink:0;}");
return c.join("\n");
}

// ── ExamSetupScreen — fully self-contained 4-step setup ──────────────────────
function ExamSetupScreen({d,initialLevel,onComplete}){
  const [step,setStep]=useState(initialLevel?2:1);
  const [level,setLevel]=useState(initialLevel||null);
  const [examWindow,setExamWindow]=useState(null);
  const [studyDays,setStudyDays]=useState([0,1,2,3,4]);
  const [dailyHours,setDailyHours]=useState(2);
  const DAY_NAMES=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const windows=(CFA_EXAM_WINDOWS[level]||[]).filter(w=>new Date(w.start)>new Date());
  const recommended=(level&&CFA_RECOMMENDED_HOURS[level])||300;
  const classLabel=(level&&CLASSES.find(c=>c.id===level)?.label)||"";
  function toggleDay(i){setStudyDays(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i].sort());}
  const card={display:"flex",alignItems:"center",gap:12,padding:"14px 16px",border:"1.5px solid "+d.b,borderRadius:12,cursor:"pointer",marginBottom:8,background:d.card,transition:"all .15s"};
  const totalSteps=4;
  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,background:d.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px",boxSizing:"border-box",overflowY:"auto",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');"}</style>
      <div style={{width:"100%",maxWidth:420,margin:"auto"}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,letterSpacing:"-.04em",marginBottom:4}}>nevile<span style={{color:d.a1}}>te</span></div>
        <div style={{fontSize:12,color:d.t3,marginBottom:20}}>step {step} of {totalSteps}</div>
        <div style={{display:"flex",gap:4,marginBottom:28}}>
          {[1,2,3,4].map(s=><div key={s} style={{height:3,flex:1,borderRadius:2,background:s<=step?d.a1:d.b,transition:"background .2s"}}/>)}
        </div>

        {/* Step 1 — Level */}
        {step===1&&(
          <div>
            <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>which level are you taking?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:22}}>your roadmap is built around this level's real curriculum and weighting.</div>
            {CLASSES.map(c=>(
              <div key={c.id} style={card}
                onMouseOver={e=>e.currentTarget.style.borderColor=d.a1}
                onMouseOut={e=>e.currentTarget.style.borderColor=d.b}
                onClick={()=>{setLevel(c.id);setExamWindow(null);setStep(2);}}>
                <div style={{width:36,height:36,borderRadius:9,background:d.a1+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:d.a1,flexShrink:0}}>{c.icon}</div>
                <div>
                  <div style={{fontSize:13.5,fontWeight:600,color:d.t}}>{c.label}</div>
                  <div style={{fontSize:11,color:d.t3,marginTop:1}}>
                    {c.id==="L1"?"foundational — ethics, quant, equity, fixed income":c.id==="L2"?"application — valuation, analysis depth":"portfolio management heavy — constructed response"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 2 — Exam window */}
        {step===2&&(
          <div>
            <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>when's your exam?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:22}}>upcoming CFA Institute windows for {classLabel}</div>
            {windows.length===0&&(
              <div style={{padding:"24px",textAlign:"center",color:d.t3,fontSize:13,background:d.card,borderRadius:12,border:"1px solid "+d.b}}>
                no upcoming windows found — go back and pick a different level, or check cfainstitute.org
              </div>
            )}
            {windows.map(w=>{
              const days=Math.ceil((new Date(w.start)-new Date())/86400000);
              return(
                <div key={w.id} style={card}
                  onMouseOver={e=>e.currentTarget.style.borderColor=d.a1}
                  onMouseOut={e=>e.currentTarget.style.borderColor=d.b}
                  onClick={()=>{setExamWindow(w.id);setStep(3);}}>
                  <div style={{width:44,height:44,borderRadius:10,background:d.a1+"18",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,lineHeight:1.2}}>
                    <div style={{fontSize:11,fontWeight:800,color:d.a1}}>{w.label.split(" ")[0].slice(0,3).toUpperCase()}</div>
                    <div style={{fontSize:12,fontWeight:700,color:d.a1}}>{w.label.split(" ")[1]}</div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13.5,fontWeight:600,color:d.t}}>{w.label}</div>
                    <div style={{fontSize:11,color:d.t3,marginTop:2}}>{days} days away</div>
                  </div>
                  <div style={{fontSize:16,color:d.t4}}>›</div>
                </div>
              );
            })}
            <button onClick={()=>setStep(1)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",marginTop:10,fontFamily:"inherit"}}>← back</button>
          </div>
        )}

        {/* Step 3 — Study days */}
        {step===3&&(
          <div>
            <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>which days can you study?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:22}}>your roadmap will only schedule sessions on these days — be realistic.</div>
            <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
              {DAY_NAMES.map((dn,i)=>(
                <div key={dn} onClick={()=>toggleDay(i)}
                  style={{width:52,height:52,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:12,fontWeight:700,cursor:"pointer",userSelect:"none",transition:"all .15s",
                    background:studyDays.includes(i)?d.a1:d.card,
                    color:studyDays.includes(i)?"#fff":d.t3,
                    border:"1.5px solid "+(studyDays.includes(i)?d.a1:d.b)}}>
                  {dn}
                </div>
              ))}
            </div>
            <div style={{fontSize:13,fontWeight:600,color:d.t,marginBottom:10}}>hours per study day</div>
            <div style={{display:"flex",gap:8,marginBottom:22}}>
              {[1,1.5,2,3,4].map(h=>(
                <div key={h} onClick={()=>setDailyHours(h)}
                  style={{flex:1,padding:"11px 4px",borderRadius:10,textAlign:"center",cursor:"pointer",transition:"all .15s",
                    background:dailyHours===h?d.a1+"18":d.card,
                    border:"1.5px solid "+(dailyHours===h?d.a1:d.b),
                    color:dailyHours===h?d.a1:d.t3,fontSize:13,fontWeight:700}}>
                  {h}h
                </div>
              ))}
            </div>
            {studyDays.length>0&&<div style={{fontSize:12,color:d.t3,marginBottom:18,fontStyle:"italic"}}>
              {studyDays.length * dailyHours}h/week. CFA Institute candidates average {recommended}h total for {classLabel}.
            </div>}
            <button disabled={studyDays.length===0} onClick={()=>setStep(4)}
              style={{width:"100%",padding:"13px",borderRadius:12,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",opacity:studyDays.length===0?0.4:1,marginBottom:10}}>
              continue →
            </button>
            <button onClick={()=>setStep(2)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
          </div>
        )}

        {/* Step 4 — Hours target */}
        {step===4&&(
          <div>
            <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>your study hour target</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:22}}>CFA Institute candidates report averaging {recommended}h for {classLabel}. pick a target or set your own.</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
              {[
                {h:recommended,label:"Recommended — CFA Institute average"},
                {h:Math.round(recommended*1.15),label:"Extra buffer — first-time candidate"},
                {h:Math.round(recommended*0.85),label:"Lean — strong background or retake"},
              ].map(({h,label},i)=>(
                <div key={h} onClick={()=>setDailyHours(-h)}
                  style={{...card,border:dailyHours===-h?"1.5px solid "+d.a1:card.border,background:dailyHours===-h?d.a1+"10":d.card}}
                  onClick={()=>setDailyHours(-h)}>
                  <div style={{width:36,height:36,borderRadius:9,background:d.hover,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:d.a1,flexShrink:0}}>{h}h</div>
                  <div style={{fontSize:12.5,color:d.t2}}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:24}}>
              <span style={{fontSize:12,color:d.t3,whiteSpace:"nowrap"}}>or enter custom:</span>
              <input type="number" placeholder={String(recommended)} min="100" max="600"
                onChange={e=>setDailyHours(-(parseInt(e.target.value)||recommended))}
                style={{flex:1,padding:"10px 12px",borderRadius:8,background:d.hover,border:"1px solid "+d.b,color:d.t,fontSize:14,fontFamily:"inherit",outline:"none"}}/>
              <span style={{fontSize:12,color:d.t3}}>hours</span>
            </div>
            <button
              onClick={()=>onComplete({level,examWindow,studyDays,dailyHours:Math.abs(dailyHours)||2,targetHours:dailyHours<0?Math.abs(dailyHours):recommended})}
              style={{width:"100%",padding:"14px",borderRadius:12,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",marginBottom:10}}>
              build my roadmap →
            </button>
            <button onClick={()=>setStep(3)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Roadmap Questionnaire ─────────────────────────────────────────────────────
function RoadmapQuestionnaire({d,jeClass,onSave,onSkip}){
  const SUBS=Object.keys(TOPICS).filter(s=>(TOPICS[s][jeClass]||[]).length>0);
  const [step,setStep]=useState(0); // 0=completed topics, 1=weekly hours, 2=weak areas
  const [completedTopics,setCompletedTopics]=useState({});
  const [weeklyHrs,setWeeklyHrs]=useState(null);
  const [weakAreas,setWeakAreas]=useState([]);
  const [expandedSub,setExpandedSub]=useState(SUBS[0]||null);

  function toggleTopic(sub,topic){
    const key=sub+"|"+topic;
    setCompletedTopics(prev=>({...prev,[key]:!prev[key]}));
  }
  function toggleWeak(sub){
    setWeakAreas(prev=>prev.includes(sub)?prev.filter(x=>x!==sub):[...prev,sub]);
  }

  const totalTopics=SUBS.reduce((a,s)=>a+(TOPICS[s][jeClass]||[]).length,0);
  const doneCount=Object.values(completedTopics).filter(Boolean).length;

  return(
    <div style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(10,10,15,.97)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"20px 16px",overflowY:"auto",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{width:"100%",maxWidth:520,margin:"auto",paddingBottom:40}}>
        <div style={{display:"flex",gap:4,marginBottom:24}}>
          {[0,1,2].map(s=><div key={s} style={{height:3,flex:1,borderRadius:2,background:s<=step?d.a1:d.b,transition:"background .2s"}}/>)}
        </div>

        {step===0&&(
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,marginBottom:4,letterSpacing:"-.03em"}}>what have you already covered?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:6}}>tick anything you've studied before — even partially. we'll skip these in your roadmap.</div>
            <div style={{fontSize:12,color:d.a2,marginBottom:20}}>{doneCount}/{totalTopics} topics marked done</div>
            {SUBS.map(sub=>{
              const topics=TOPICS[sub][jeClass]||[];
              const subDone=topics.filter(t=>completedTopics[sub+"|"+t]).length;
              const col=SUBJECT_COLORS[sub]||d.a1;
              return(
                <div key={sub} style={{marginBottom:8,background:d.card,border:`1px solid ${d.b}`,borderRadius:10,overflow:"hidden"}}>
                  <div onClick={()=>setExpandedSub(expandedSub===sub?null:sub)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",cursor:"pointer"}}>
                    <div style={{width:4,height:28,borderRadius:2,background:col,flexShrink:0}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700,color:d.t}}>{sub}</div>
                      <div style={{fontSize:10,color:d.t3,marginTop:1}}>{subDone}/{topics.length} done · {TOPIC_WEIGHT_RANGES[sub]?.[jeClass]||"—"} of exam</div>
                    </div>
                    <div style={{fontSize:11,color:d.t3}}>{expandedSub===sub?"▲":"▼"}</div>
                  </div>
                  {expandedSub===sub&&(
                    <div style={{borderTop:`1px solid ${d.b}`}}>
                      {topics.map(topic=>{
                        const key=sub+"|"+topic;
                        const done=completedTopics[key];
                        return(
                          <div key={topic} onClick={()=>toggleTopic(sub,topic)}
                            style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",cursor:"pointer",background:done?d.a2+"08":"transparent",borderBottom:`1px solid ${d.b}44`,transition:"background .1s"}}>
                            <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${done?d.a2:d.b}`,background:done?d.a2:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#fff",fontSize:10,fontWeight:700}}>{done&&"✓"}</div>
                            <div style={{flex:1,fontSize:12.5,color:done?d.t3:d.t,textDecoration:done?"line-through":"none"}}>{topic}</div>
                            <div style={{fontSize:9,color:getWeight(sub,topic,jeClass)==="H"?d.danger:getWeight(sub,topic,jeClass)==="M"?d.gold:d.t4,fontWeight:700,background:getWeight(sub,topic,jeClass)==="H"?d.danger+"15":getWeight(sub,topic,jeClass)==="M"?d.gold+"15":d.hover,padding:"1px 6px",borderRadius:3}}>
                              {getWeight(sub,topic,jeClass)==="H"?"High":getWeight(sub,topic,jeClass)==="M"?"Mid":"Low"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button onClick={()=>setStep(1)}
                style={{flex:1,padding:"13px",borderRadius:10,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit"}}>
                continue →
              </button>
              <button onClick={onSkip}
                style={{padding:"13px 20px",borderRadius:10,background:"transparent",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>
                skip
              </button>
            </div>
          </div>
        )}

        {step===1&&(
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,marginBottom:4,letterSpacing:"-.03em"}}>how many hours can you study this week?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:24}}>be honest. we'll plan around your actual availability, not your ideal self.</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
              {[
                {h:5,label:"5h/week",sub:"~1h/day, 5 days"},
                {h:10,label:"10h/week",sub:"~2h/day, 5 days"},
                {h:15,label:"15h/week",sub:"~3h/day, 5 days"},
                {h:20,label:"20h/week",sub:"~4h/day, 5 days"},
                {h:25,label:"25h/week",sub:"serious mode"},
                {h:30,label:"30h+/week",sub:"full-time prep"},
              ].map(opt=>(
                <div key={opt.h} onClick={()=>setWeeklyHrs(opt.h)}
                  style={{padding:"16px",borderRadius:10,cursor:"pointer",textAlign:"center",transition:"all .15s",
                    background:weeklyHrs===opt.h?d.a1+"18":d.card,
                    border:`1.5px solid ${weeklyHrs===opt.h?d.a1:d.b}`}}>
                  <div style={{fontSize:16,fontWeight:700,color:weeklyHrs===opt.h?d.a1:d.t,marginBottom:3}}>{opt.label}</div>
                  <div style={{fontSize:11,color:d.t3}}>{opt.sub}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setStep(0)} style={{padding:"12px 18px",borderRadius:10,background:"transparent",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
              <button disabled={!weeklyHrs} onClick={()=>setStep(2)}
                style={{flex:1,padding:"13px",borderRadius:10,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",opacity:weeklyHrs?1:.4}}>
                continue →
              </button>
            </div>
          </div>
        )}

        {step===2&&(
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,marginBottom:4,letterSpacing:"-.03em"}}>which areas feel weakest?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:20}}>we'll give these more repetition in your roadmap. pick any that apply.</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
              {SUBS.map(sub=>{
                const selected=weakAreas.includes(sub);
                const col=SUBJECT_COLORS[sub]||d.a1;
                return(
                  <div key={sub} onClick={()=>toggleWeak(sub)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:10,cursor:"pointer",transition:"all .15s",
                      background:selected?col+"12":d.card,border:`1.5px solid ${selected?col:d.b}`}}>
                    <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${selected?col:d.b}`,background:selected?col:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#fff",fontSize:10,fontWeight:700}}>{selected&&"✓"}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:d.t}}>{sub}</div>
                      <div style={{fontSize:10,color:d.t3}}>{TOPIC_WEIGHT_RANGES[sub]?.[jeClass]||"—"} of exam</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setStep(1)} style={{padding:"12px 18px",borderRadius:10,background:"transparent",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
              <button onClick={()=>onSave({completedTopics,weeklyHrs,weakAreas})}
                style={{flex:1,padding:"13px",borderRadius:10,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit"}}>
                build my roadmap →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Error boundary — catches render crashes, shows reload instead of black screen ─
class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(e){return{hasError:true,error:e};}
  render(){
    if(!this.state.hasError) return this.props.children;
    return(
      <div style={{position:"fixed",inset:0,background:"#0a0a0f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,fontFamily:"'DM Sans',sans-serif",padding:24}}>
        <div style={{fontSize:32}}>⚠</div>
        <div style={{fontSize:16,fontWeight:700,color:"#f0f0ff"}}>something went wrong</div>
        <div style={{fontSize:12,color:"#7878a8",maxWidth:340,textAlign:"center",lineHeight:1.6}}>{this.state.error?.message||"unexpected error"}</div>
        <button onClick={()=>window.location.reload()} style={{padding:"10px 24px",borderRadius:8,background:"#6c63ff",color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",marginTop:8}}>
          reload
        </button>
      </div>
    );
  }
}

export default function AppWithBoundary(){
  return <ErrorBoundary><App/></ErrorBoundary>;
}

function App(){
  // Tab switch — also closes sidebar on mobile
  function switchTab(newTab){
    setTab(newTab);
    if(window.innerWidth<=900) setSideOpen(false);
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
      // Different user — wipe everything so old account data doesn't bleed
      const ALL_KEYS=["slothr_auth","slothr_sessions","slothr_mocks","slothr_goals","slothr_pyq",
        "slothr_syllabus","slothr_class","slothr_revision","nev_sessions","nev_completed",
        "nev_syllabus","nev_mocks","nev_topic_notes","nev_roadmap_answers","nev_roadmap_done",
        "nev_exam_window","nev_study_days","nev_edu_status","nev_target_hours",
        "nev_exam_setup_done","nev_profile","nev_buddies","nev_setup"];
      ALL_KEYS.forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
      // Reset in-memory state immediately too — don't wait for the async Supabase reload
      setSessions([]);setMocks([]);setGoals([]);setPyqHistory([]);
      setSyllabusStatus({});setJeClass(null);setExamWindow(null);setStudyDays([0,1,2,3,4]);
      setRoadmapAnswers(null);
    }
    localStorage.setItem("slothr_auth",JSON.stringify(stored));
    setAuthSession(stored);
    // Auto-upsert profile so buddy search finds this user immediately
    const u=stored.user;
    if(u?.id&&stored.access_token){
      fetch(`${SB_URL}/rest/v1/profiles`,{
        method:"POST",
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${stored.access_token}`,"Content-Type":"application/json","Prefer":"resolution=ignore-duplicates"},
        body:JSON.stringify({id:u.id,display_name:u.user_metadata?.full_name||u.email?.split("@")[0]||"",is_public:true})
      }).catch(()=>{});
    }
  }
  function handleSignOut(){
    if(authSession?.access_token)SB_AUTH.signOut(authSession.access_token).catch(()=>{});
    setAuthSession(null);
    setSessions([]);setMocks([]);setGoals([]);setPyqHistory([]);
    const ALL_KEYS=["slothr_auth","slothr_sessions","slothr_mocks","slothr_goals","slothr_pyq",
      "slothr_syllabus","slothr_class","slothr_revision","nev_sessions","nev_completed",
      "nev_syllabus","nev_mocks","nev_topic_notes","nev_roadmap_answers","nev_roadmap_done",
      "nev_exam_window","nev_study_days","nev_edu_status","nev_target_hours",
      "nev_exam_setup_done","nev_profile","nev_buddies","nev_setup"];
    try{ALL_KEYS.forEach(k=>localStorage.removeItem(k));}catch(e){}
  }
  // OAuth redirect handler — process silently, no flash
  const [authLoading,setAuthLoading]=useState(false);
  const [oauthProcessing,setOauthProcessing]=useState(
    ()=>typeof window!=="undefined"&&window.location.hash.includes("access_token")
  );
  useEffect(()=>{
    const hash=window.location.hash;
    if(!hash.includes("access_token")){setOauthProcessing(false);return;}
    const p=new URLSearchParams(hash.replace("#","?"));
    const token=p.get("access_token");
    if(!token){setOauthProcessing(false);return;}
    // Clear hash first so back/refresh doesn't reprocess
    window.history.replaceState(null,"",window.location.pathname);
    SB_AUTH.getUser(token).then(u=>{
      if(!u){setOauthProcessing(false);return;}
      const stored={
        access_token:token,
        refresh_token:p.get("refresh_token"),
        expires_at:Date.now()+parseInt(p.get("expires_in")||"3600")*1000,
        user:u,
      };
      handleAuthSuccess(stored);
      setOauthProcessing(false);
    }).catch(()=>setOauthProcessing(false));
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
  const [sideOpen,setSideOpen]=useState(()=>typeof window!=="undefined"&&window.innerWidth>900);
  const [tab,setTab]=useState("overview");
  const [jeClass,setJeClass]=useState(()=>{try{return localStorage.getItem("slothr_class")||null;}catch(e){return null;}});
  // ── Exam setup state ─────────────────────────────────────────────────────
  const [examWindow,setExamWindow]=useState(()=>{try{return localStorage.getItem("nev_exam_window")||null;}catch(e){return null;}});
  const [studyDays,setStudyDays]=useState(()=>{try{const v=localStorage.getItem("nev_study_days");return v?JSON.parse(v):[0,1,2,3,4];}catch(e){return [0,1,2,3,4];}});
  const [eduStatus,setEduStatus]=useState(()=>{try{return localStorage.getItem("nev_edu_status")||null;}catch(e){return null;}}); // "student"|"working"|"graduated"
  const [targetHours,setTargetHours]=useState(()=>{try{const v=localStorage.getItem("nev_target_hours");return v?parseInt(v):null;}catch(e){return null;}});
  const [examSetupDone,setExamSetupDone]=useState(()=>{try{return localStorage.getItem("nev_exam_setup_done")==="1";}catch(e){return false;}});
  useEffect(()=>{try{if(examWindow)localStorage.setItem("nev_exam_window",examWindow);}catch(e){}},[examWindow]);
  useEffect(()=>{try{localStorage.setItem("nev_study_days",JSON.stringify(studyDays));}catch(e){}},[studyDays]);
  useEffect(()=>{try{if(eduStatus)localStorage.setItem("nev_edu_status",eduStatus);}catch(e){}},[eduStatus]);
  useEffect(()=>{try{if(targetHours)localStorage.setItem("nev_target_hours",String(targetHours));}catch(e){}},[targetHours]);
  const [sessions,setSessions]=useState(()=>{try{const c=localStorage.getItem("slothr_sessions");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [mocks,setMocks]=useState(()=>{try{const c=localStorage.getItem("slothr_mocks");return c?JSON.parse(c):[];}catch(e){return [];}});

  // ── Receive completed practice test result ──────────────────────────────────
  function handleTestComplete({mockEntry, pyqEntries}){
    setMocks(prev=>[...prev, mockEntry]);
    setPyqHistory(prev=>[...prev, ...pyqEntries]);
  }

  // Goals
  const [goals,setGoals]=useState(()=>{try{const c=localStorage.getItem("slothr_goals");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [goalInput,setGoalInput]=useState("");
  const [goalSub,setGoalSub]=useState("Ethics");
  const [goalTopic,setGoalTopic]=useState("");
  const [goalType,setGoalType]=useState("study");
  const [goalTarget,setGoalTarget]=useState("");
  const [goalLoading,setGoalLoading]=useState(false);

  // PYQ
  const [pyqHistory,setPyqHistory]=useState(()=>{try{const c=localStorage.getItem("slothr_pyq");return c?JSON.parse(c):[];}catch(e){return [];}});

  // Coach
  const [syllabusStatus,setSyllabusStatus]=useState(()=>{try{const c=localStorage.getItem("slothr_syllabus");return c?JSON.parse(c):{};}catch(e){return {};}});
  // Revision scheduler state
  const [revisionLog,setRevisionLog]=useState(()=>{try{const c=localStorage.getItem("slothr_revision");return c?JSON.parse(c):{};}catch(e){return {};}});
  useEffect(()=>{try{localStorage.setItem("slothr_revision",JSON.stringify(revisionLog));}catch(e){}},[revisionLog]);
  function markStudied(sub,topic){
    const now=today();
    setRevisionLog(prev=>({...prev,[sub+"|"+topic]:{
      lastStudied:now,
      nextRevisions:[
        addDays(now,3),
        addDays(now,7),
        addDays(now,14),
        addDays(now,30),
      ],
      doneRevisions:[],
    }}));
  }
  function markRevisionDone(sub,topic){
    setRevisionLog(prev=>{
      const key=sub+"|"+topic;
      const entry=prev[key];
      if(!entry)return prev;
      const [next,...rest]=entry.nextRevisions;
      return {...prev,[key]:{
        ...entry,
        doneRevisions:[...(entry.doneRevisions||[]),{date:today(),scheduled:next}],
        nextRevisions:rest,
        lastRevised:today(),
      }};
    });
  }
  // ── Mock exam scores ─────────────────────────────────────────────────────
  const [mockScores,setMockScores]=useState(()=>{try{const v=localStorage.getItem("nev_mocks");return v?JSON.parse(v):[];}catch(e){return [];}});
  useEffect(()=>{try{localStorage.setItem("nev_mocks",JSON.stringify(mockScores));}catch(e){}},[mockScores]);
  const [showMockForm,setShowMockForm]=useState(false);
  const [mockForm,setMockForm]=useState({date:today(),provider:"Kaplan",score:"",notes:"",weakTopics:[]});
  // ── Study notes per topic ─────────────────────────────────────────────────
  const [topicNotes,setTopicNotes]=useState(()=>{try{const v=localStorage.getItem("nev_topic_notes");return v?JSON.parse(v):{};}catch(e){return {};}});
  useEffect(()=>{try{localStorage.setItem("nev_topic_notes",JSON.stringify(topicNotes));}catch(e){}},[topicNotes]);
  const [editingNote,setEditingNote]=useState(null); // "sub|topic"
  // ── Study buddy ───────────────────────────────────────────────────────────
  const [buddySearch,setBuddySearch]=useState("");
  const [buddyResults,setBuddyResults]=useState([]);
  const [buddyLoading,setBuddyLoading]=useState(false);
  const [buddyRequests,setBuddyRequests]=useState([]);
  const [myBuddies,setMyBuddies]=useState(()=>{try{const v=localStorage.getItem("nev_buddies");return v?JSON.parse(v):[];}catch(e){return [];}});
  useEffect(()=>{try{localStorage.setItem("nev_buddies",JSON.stringify(myBuddies));}catch(e){}},[myBuddies]);
  const [buddyStats,setBuddyStats]=useState({});
  const [recommendedBuddies,setRecommendedBuddies]=useState([]);
  const [recommendedLoading,setRecommendedLoading]=useState(false);
  useEffect(()=>{
    if(tab==="buddy"){myBuddies.forEach(b=>fetchBuddyStats(b.id));}
  },[tab,myBuddies.length]);
  useEffect(()=>{
    if(tab==="buddy"&&jeClass)fetchRecommendedBuddies();
  },[tab,jeClass,examWindow]);
  // ── Roadmap personalization questionnaire ────────────────────────────────
  const [roadmapAnswers,setRoadmapAnswers]=useState(()=>{try{const v=localStorage.getItem("nev_roadmap_answers");return v?JSON.parse(v):null;}catch(e){return null;}});
  const [showRoadmapQs,setShowRoadmapQs]=useState(false);
  function saveRoadmapAnswers(ans){
    setRoadmapAnswers(ans);
    try{localStorage.setItem("nev_roadmap_answers",JSON.stringify(ans));}catch(e){}
  }
  // ── Planner / Roadmap completion state ───────────────────────────────────
  const [roadmapDone,setRoadmapDone]=useState(()=>{try{const c=localStorage.getItem("nev_roadmap_done");return c?JSON.parse(c):{};}catch(e){return {};}});
  useEffect(()=>{try{localStorage.setItem("nev_roadmap_done",JSON.stringify(roadmapDone));}catch(e){}},[roadmapDone]);
  function toggleRoadmapItem(date,item){
    const key=itemKey(date,item);
    setRoadmapDone(prev=>{
      const next={...prev};
      const willBeDone=!next[key];
      if(next[key]) delete next[key]; else next[key]=true;
      if(authSession?.access_token&&user?.id){
        if(willBeDone) fetch(`${SB_URL}/rest/v1/nev_completed`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,item_key:key,subject:item.subject,topic:item.topic,completed_at:new Date().toISOString()})}).catch(()=>{});
        else fetch(`${SB_URL}/rest/v1/nev_completed?user_id=eq.${user.id}&item_key=eq.${encodeURIComponent(key)}`,{method:"DELETE",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`}}).catch(()=>{});
      }
      return next;
    });
  }
  // ── Roadmap — recomputed whenever level/window/study days change ──────────
  const windowData=(CFA_EXAM_WINDOWS[jeClass]||[]).find(w=>w.id===examWindow);
  const examDate=windowData?.start||null;
  const roadmap=useMemo(()=>{
    if(!jeClass||!examDate) return null;
    return generateRoadmap({level:jeClass,examDate,studyDays,answers:roadmapAnswers});
  },[jeClass,examDate,studyDays,roadmapAnswers]);
  const isRevisionPhase=roadmap?.revisionStart&&today()>=roadmap.revisionStart;
  const roadmapTodayItems=(roadmap?.weeks||[]).flatMap(w=>w.days).find(dd=>dd.date===today())?.items||[];
  const [coachCards,setCoachCards]=useState(null);
  // ── Social state ──────────────────────────────────────────────────────────
  const [feed,setFeed]=useState([]);
  const [feedLoading,setFeedLoading]=useState(false);
  const [profile,setProfile]=useState(null);
  // Username editing — must be top-level hooks, not inside tab render
  const [editingUsername,setEditingUsername]=useState(false);
  const [usernameInput,setUsernameInput]=useState("");
  const [usernameError,setUsernameError]=useState("");
  const [usernameSaving,setUsernameSaving]=useState(false);
  const [profileIsPublic,setProfileIsPublic]=useState(true);
  const [privacySaving,setPrivacySaving]=useState(false);
  const [profileLoading,setProfileLoading]=useState(false);
  const [follows,setFollows]=useState(new Set()); // set of user_ids we follow
  const [events,setEvents]=useState([]);
  const [eventsLoading,setEventsLoading]=useState(false);
  const [joinedEvents,setJoinedEvents]=useState(new Set());
  const [showCreateEvent,setShowCreateEvent]=useState(false);
  const [eventForm,setEventForm]=useState({title:"",description:"",subject:"Physics",type:"marathon",starts_at:"",ends_at:""});
  const [postCapture,setPostCapture]=useState(null); // base64 image from camera
  const [postText,setPostText]=useState("");
  const [postLoading,setPostLoading]=useState(false);
  const [cameraStream,setCameraStream]=useState(null);
  const [showCamera,setShowCamera]=useState(false);
  const [leaderboard,setLeaderboard]=useState([]);
  const [feedTab,setFeedTab]=useState("following");
  const [searchResults,setSearchResults]=useState([]);
  const [openComments,setOpenComments]=useState(null);
  const [viewProfile,setViewProfile]=useState(null); // userId to view
  const videoRef=useRef(null);
  const canvasRef=useRef(null);
  function setSyllabusChapter(sub,topic,status){setSyllabusStatus(prev=>({...prev,[sub+"|"+topic]:status}));}
  const [coachLoading,setCoachLoading]=useState(false);

  // Timer
  const [timerMode,setTimerMode]=useState("stopwatch");
  const [timerOn,setTimerOn]=useState(false);
  const [timerSec,setTimerSec]=useState(0);
  const [countdownSet,setCountdownSet]=useState(25);
  const [customMins,setCustomMins]=useState("");
  const [countdownSec,setCountdownSec]=useState(25*60);
  const [timerSub,setTimerSub]=useState("Ethics");
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
  const SW=sideOpen?220:56;
  const sideTranslate=sideOpen?"0":"-100%";
  const sideW600=sideOpen?"80vw":"0px";
  const sbOverlayDisplay=sideOpen?"block":"none";
  const sbOverlayOp=sideOpen?1:0;
  const sbOverlayPE=sideOpen?"auto":"none";
  const topbarBg=dark?"rgba(14,13,11,.92)":"rgba(247,244,238,.92)";
  const fsOverlayBg=dark?"#0e0d0b":"#f7f4ee";
  const fsDoneBg=dark?"#0d0d0c":"#f8f8f6";
  const sItemPad=sideOpen?"7px 10px":"7px";
  const sItemJust=sideOpen?"flex-start":"center";
  const subColor=SUBJECT_COLORS[timerSub]||d.a1;
  const css=buildCSS(d,dark,sideOpen,SW,subColor,sideTranslate,sideW600,sbOverlayDisplay,sbOverlayOp,sbOverlayPE,topbarBg,fsOverlayBg,fsDoneBg,sItemPad,sItemJust);
  useEffect(()=>{
    let el=document.getElementById("slothr-css");
    if(!el){el=document.createElement("style");el.id="slothr-css";document.head.appendChild(el);}
    el.textContent=css;
  },[css]);
  const classTopics=sub=>TOPICS[sub]?.[jeClass]||TOPICS[sub]?.L1||[];

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
  // Reacquire wake lock when page becomes visible again
  useEffect(()=>{
    const fn=async()=>{if(document.visibilityState==="visible"&&timerOn){await acquireWakeLock();}};
    document.addEventListener("visibilitychange",fn);
    return()=>document.removeEventListener("visibilitychange",fn);
  },[timerOn]);

  // ── Timer tick — Date-based so it works in background ───────────────────
  const timerStartRef=useRef(null);   // wall-clock ms when timer last started
  const timerBaseRef=useRef(0);       // seconds already accumulated before last start
  useEffect(()=>{
    if(timerOn){
      // Record wall-clock start + base
      timerStartRef.current=Date.now();
      timerBaseRef.current=timerMode==="stopwatch"?timerSecRef.current:null;
      const cdBase=timerMode==="countdown"?countdownSec:null;

      timerRef.current=setInterval(()=>{
        const elapsed=Math.floor((Date.now()-timerStartRef.current)/1000);
        if(timerMode==="stopwatch"){
          const next=(timerBaseRef.current||0)+elapsed;
          timerSecRef.current=next;
          setTimerSec(next);
        } else {
          const next=Math.max(0,(cdBase||0)-elapsed);
          setCountdownSec(next);
          if(next<=0){
            clearInterval(timerRef.current);
            setTimerOn(false);
            setTimerDone(true);
            setSessions(p=>[...p,{id:Date.now(),subject:timerSub,topic:timerTopic||"General",duration:countdownSet,date:today(),notes:timerNotes||"Countdown session"}]);
          }
        }
      },500); // 500ms for smoother but still accurate
    } else {
      clearInterval(timerRef.current);
    }
    return()=>clearInterval(timerRef.current);
  },[timerOn,timerMode]);

  // Resync timer when app comes back to foreground
  useEffect(()=>{
    const fn=()=>{
      if(document.visibilityState==="visible"&&timerOn&&timerStartRef.current){
        // Force immediate tick to resync display
        const elapsed=Math.floor((Date.now()-timerStartRef.current)/1000);
        if(timerMode==="stopwatch"){
          const next=(timerBaseRef.current||0)+elapsed;
          timerSecRef.current=next;
          setTimerSec(next);
        }
      }
    };
    document.addEventListener("visibilitychange",fn);
    return()=>document.removeEventListener("visibilitychange",fn);
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
  // Load from Supabase on login — Supabase is always the source of truth,
  // never gated on localStorage (that was the cause of data bleeding between accounts)
  useEffect(()=>{
    if(!authSession?.access_token||!user?.id)return;
    const token=authSession.access_token, uid=user.id;
    SB_AUTH.loadData("user_sessions",uid,token).then(d=>setSessions(d?.length?d.map(r=>r.data||r):[]));
    SB_AUTH.loadData("user_goals",uid,token).then(d=>setGoals(d?.length?d.map(r=>r.data||r):[]));
    SB_AUTH.loadData("user_mocks",uid,token).then(d=>setMocks(d?.length?d.map(r=>r.data||r):[]));
    SB_AUTH.loadData("user_pyq",uid,token).then(d=>setPyqHistory(d?.length?d.map(r=>r.data||r):[]));
    fetch(`${SB_URL}/rest/v1/user_prefs?user_id=eq.${uid}&select=*`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${token}`}})
      .then(r=>r.json())
      .then(d=>{
        const row=d?.[0];
        if(!row)return;
        if(row.je_class){setJeClass(row.je_class);try{localStorage.setItem("slothr_class",row.je_class);}catch(e){}}
        if(row.exam_window){setExamWindow(row.exam_window);try{localStorage.setItem("nev_exam_window",row.exam_window);}catch(e){}}
        if(row.study_days){setStudyDays(row.study_days);try{localStorage.setItem("nev_study_days",JSON.stringify(row.study_days));}catch(e){}}
        if(row.target_hours){setTargetHours(row.target_hours);try{localStorage.setItem("nev_target_hours",String(row.target_hours));}catch(e){}}
        if(row.je_class&&row.exam_window){
          // Setup is complete — mark done so we don't show the setup screen again
          setExamSetupDone(true);
          try{localStorage.setItem("nev_exam_setup_done","1");}catch(e){}
        }
      }).catch(()=>{});
  },[authSession?.access_token,user?.id]);
  useEffect(()=>{
    setGoals(prev=>prev.map(g=>{
      if(g.date!==today()) return g;
      if(g.type==="study"){const done=sessions.filter(s=>s.date===today()&&s.subject===g.subject&&(!g.topic||s.topic===g.topic)).reduce((a,s)=>a+s.duration,0);return{...g,achieved:done>=(g.target||60)};}
      if(g.type==="pyq"){const done=pyqHistory.filter(p=>p.date===today()&&p.subject===g.subject&&(!g.topic||p.topic===g.topic)).length;return{...g,achieved:done>=(g.target||10)};}
      return g;
    }));
  },[sessions,pyqHistory]);
  // These must be before any early return
  const [showSharePrompt,setShowSharePrompt]=useState(false);
  const [lastSession,setLastSession]=useState(null);
  const [openCommentPostId,setOpenCommentPostId]=useState(null);
  const [comments,setComments]=useState([]);
  const [commentText,setCommentText]=useState("");
  const [partnerResults,setPartnerResults]=useState([]);
  const [partnerLoading,setPartnerLoading]=useState(false);
  const [myPartner,setMyPartner]=useState(null);
  const [userSearch,setUserSearch]=useState("");
  // Refs — must be declared before any early return
  // Profile/leaderboard loader — must be before early returns
  useEffect(()=>{
    if(tab==="profile"&&user?.id){
      fetchProfile(user.id).then(p=>{
        setProfile(p);
        if(p)setProfileIsPublic(p.is_public!==false); // default true if unset
      });
      fetchLeaderboard();
    }
  },[tab]);
  // Auth gate — after ALL hooks
  // Show a quiet spinner while OAuth token is being processed (eliminates the login-page flash)
  if(oauthProcessing) return(
    <div style={{position:"fixed",inset:0,background:"#0a0a0f",display:"flex",alignItems:"center",justifyContent:"center",gap:12,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{width:20,height:20,borderRadius:"50%",border:"2px solid #6c63ff",borderTopColor:"transparent",animation:"nevspin 0.8s linear infinite"}}/>
      <div style={{fontSize:13,color:"#7878a8"}}>signing you in...</div>
      <style>{"@keyframes nevspin{to{transform:rotate(360deg)}}"}</style>
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
    const elapsed=timerStartRef.current?Math.floor((Date.now()-timerStartRef.current)/1000):0;
    const rawSec=(timerBaseRef.current||0)+elapsed;
    timerSecRef.current=rawSec;
    const m=Math.max(1,Math.round(rawSec/60));
    // Only save if at least 30 seconds elapsed — prevents 0-minute ghost sessions
    if(rawSec>=30){
      const entry={id:Date.now(),subject:timerSub,topic:timerTopic||"General",duration:m,date:today(),notes:timerNotes||"Timer session"};
      setSessions(p=>[...p,entry]);
      if(authSession?.access_token&&user?.id){
        // Save session
        fetch(`${SB_URL}/rest/v1/user_sessions`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({user_id:user.id,data:entry})}).catch(()=>{});
        // Auto-post session to feed
        const postContent=timerNotes||`studied ${timerSub}${timerTopic&&timerTopic!=="General"?" · "+timerTopic:""}`;
        const postMeta={subject:timerSub,topic:timerTopic||"General",duration:m,streak,date:today()};
        // Check if postCapture has a photo
        const doPost=async()=>{
          let image_url=null;
          if(postCapture){
            try{
              const blob=await(await fetch(postCapture)).blob();
              const fname=user.id+"/"+Date.now()+".jpg";
              const up=await fetch(`${SB_URL}/storage/v1/object/post-images/${fname}`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"image/jpeg","x-upsert":"true"},body:blob});
              if(up.ok)image_url=`${SB_URL}/storage/v1/object/public/post-images/${fname}`;
            }catch(e){}
            setPostCapture(null);
          }
          fetch(`${SB_URL}/rest/v1/posts`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({user_id:user.id,type:"session",content:postContent,image_url,metadata:postMeta,is_public:true})}).catch(()=>{});
        };
        doPost();
      }
    }
    setTimerSec(0);
    timerSecRef.current=0;
  }
  function resetTimer(){setTimerOn(false);setTimerSec(0);timerSecRef.current=0;setCountdownSec(countdownSet*60);setTimerDone(false);}
  function applyCustom(){const m=parseInt(customMins);if(m>0&&m<=600){setCountdownSet(m);setCountdownSec(m*60);setCustomMins("");};}

  async function callAI(sys,usr,json=false){
    const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${OR_KEY}`,"HTTP-Referer":"https://nevilete.com","X-Title":"Nevilete"},
      body:JSON.stringify({model:"anthropic/claude-sonnet-4-5",max_tokens:1500,messages:[{role:"system",content:sys},{role:"user",content:usr}]})
    });
    if(!r.ok){const e=await r.text();throw new Error("AI unavailable: "+e);}
    const data=await r.json();
    const txt=data.choices?.[0]?.message?.content||"";
    if(json) return JSON.parse(txt.replace(/```json|```/g,"").trim());
    return txt;
  }
  async function togglePrivacy(){
    if(!user?.id)return;
    setPrivacySaving(true);
    const next=!profileIsPublic;
    try{
      await fetch(`${SB_URL}/rest/v1/profiles`,{
        method:"POST",
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},
        body:JSON.stringify({id:user.id,is_public:next})
      });
      setProfileIsPublic(next);
      setProfile(p=>({...(p||{}),is_public:next}));
    }catch(e){}
    setPrivacySaving(false);
  }
  // ── Social API helpers ────────────────────────────────────────────────────
  async function searchUsers(){
    if(!userSearch.trim())return;
    const q=userSearch.replace("@","").toLowerCase().trim();
    const r=await fetch(SB_URL+"/rest/v1/profiles?username=ilike."+encodeURIComponent("%"+q+"%")+"&select=id,username,display_name,avatar_url,je_class&limit=10&is_public=eq.true",{
      headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}
    });
    const d=await r.json();
    if(Array.isArray(d))setSearchResults(d.filter(u=>u.id!==user?.id));
  }
  // ── Study buddy functions ─────────────────────────────────────────────────
  async function searchBuddy(){
    if(!buddySearch.trim())return;
    setBuddyLoading(true);
    const q=buddySearch.replace("@","").toLowerCase().trim();
    try{
      // Search by exact username first, then partial
      const exactR=await fetch(SB_URL+"/rest/v1/profiles?username=eq."+encodeURIComponent(q)+"&select=id,username,display_name,avatar_url,je_class",{
        headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}
      });
      const exactD=await exactR.json();
      if(Array.isArray(exactD)&&exactD.length>0){
        setBuddyResults(exactD.filter(u=>u.id!==user?.id&&!myBuddies.find(b=>b.id===u.id)));
        setBuddyLoading(false);return;
      }
      // Fallback: partial match
      const r=await fetch(SB_URL+"/rest/v1/profiles?username=ilike."+encodeURIComponent("%"+q+"%")+"&select=id,username,display_name,avatar_url,je_class&limit=10",{
        headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}
      });
      const d=await r.json();
      if(Array.isArray(d))setBuddyResults(d.filter(u=>u.id!==user?.id&&!myBuddies.find(b=>b.id===u.id)));
    }catch(e){console.error("Buddy search error:",e);}
    setBuddyLoading(false);
  }
  function addBuddy(u){
    setMyBuddies(prev=>prev.find(b=>b.id===u.id)?prev:[...prev,u]);
    setBuddyResults(prev=>prev.filter(r=>r.id!==u.id));
  }
  function removeBuddy(id){
    setMyBuddies(prev=>prev.filter(b=>b.id!==id));
  }
  // Returns weekly + total minutes for a buddy (general stats only, no session detail)
  async function fetchBuddyStats(buddyId){
    try{
      const ws=weekStartOf(today());
      const r=await fetch(SB_URL+"/rest/v1/user_sessions?user_id=eq."+buddyId+"&select=data",{
        headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}
      });
      const rows=await r.json();
      if(!Array.isArray(rows))return;
      const sessionsData=rows.map(r=>r.data||r);
      const weekMins=sessionsData.filter(s=>s.date>=ws).reduce((a,s)=>a+(s.duration||0),0);
      const totalMins=sessionsData.reduce((a,s)=>a+(s.duration||0),0);
      const lastDate=sessionsData.length?[...sessionsData].sort((a,b)=>b.date.localeCompare(a.date))[0].date:null;
      setBuddyStats(prev=>({...prev,[buddyId]:{weekMins,totalMins,lastDate,sessionCount:sessionsData.length}}));
    }catch(e){}
  }
  async function fetchRecommendedBuddies(){
    if(!jeClass||!user?.id)return;
    setRecommendedLoading(true);
    try{
      // Match by same level, and prefer same exam window if set
      // Don't filter by is_public — new users haven't set it yet. Show all same-level candidates.
      let url=SB_URL+"/rest/v1/profiles?je_class=eq."+jeClass+"&id=neq."+user.id+"&select=id,username,display_name,avatar_url,je_class,exam_window&limit=20";
      const r=await fetch(url,{headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}});
      const d=await r.json();
      if(Array.isArray(d)){
        const existing=new Set(myBuddies.map(b=>b.id));
        const filtered=d.filter(u=>!existing.has(u.id));
        // Sort: same exam window first
        filtered.sort((a,b)=>{
          const aMatch=a.exam_window===examWindow?0:1;
          const bMatch=b.exam_window===examWindow?0:1;
          return aMatch-bMatch;
        });
        setRecommendedBuddies(filtered.slice(0,6));
      }
    }catch(e){}
    setRecommendedLoading(false);
  }
  async function fetchProfile(uid){
    const r=await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=*`,{
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
    });
    const d=await r.json();
    return d?.[0]||null;
  }
  async function fetchFeed(type="following"){
    if(!user?.id)return;
    setFeedLoading(true);
    try{
      let url;
      if(type==="following"){
        // Posts from people we follow + our own
        url=`${SB_URL}/rest/v1/posts?select=*,profiles!posts_user_id_fkey(username,display_name,avatar_url)&is_public=eq.true&order=created_at.desc&limit=50`;
      } else {
        url=`${SB_URL}/rest/v1/posts?select=*,profiles!posts_user_id_fkey(username,display_name,avatar_url)&is_public=eq.true&order=created_at.desc&limit=50`;
      }
      const r=await fetch(url,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}});
      const d=await r.json();
      setFeed(Array.isArray(d)?d:[]);
    }catch(e){}
    setFeedLoading(false);
  }
  async function fetchFollows(){
    if(!user?.id)return;
    const r=await fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${user.id}&select=following_id`,{
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
    });
    const d=await r.json();
    if(Array.isArray(d))setFollows(new Set(d.map(x=>x.following_id)));
  }
  async function toggleFollow(targetId){
    if(!user?.id)return;
    const following=follows.has(targetId);
    if(following){
      await fetch(`${SB_URL}/rest/v1/follows?follower_id=eq.${user.id}&following_id=eq.${targetId}`,{
        method:"DELETE",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
      });
      setFollows(prev=>{const s=new Set(prev);s.delete(targetId);return s;});
    } else {
      await fetch(`${SB_URL}/rest/v1/follows`,{
        method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`,"Content-Type":"application/json"},
        body:JSON.stringify({follower_id:user.id,following_id:targetId})
      });
      setFollows(prev=>new Set([...prev,targetId]));
    }
  }
  async function likePost(postId,liked){
    if(!user?.id)return;
    if(liked){
      await fetch(`${SB_URL}/rest/v1/post_likes?post_id=eq.${postId}&user_id=eq.${user.id}`,{
        method:"DELETE",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/post_likes`,{
        method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`,"Content-Type":"application/json"},
        body:JSON.stringify({post_id:postId,user_id:user.id})
      });
    }
    setFeed(prev=>prev.map(p=>p.id===postId?{...p,like_count:liked?Math.max(0,p.like_count-1):p.like_count+1,_liked:!liked}:p));
  }
  // Posts auto-created when timer stops
  async function fetchEvents(){
    setEventsLoading(true);
    const r=await fetch(`${SB_URL}/rest/v1/events?select=*,profiles!events_host_id_fkey(username,display_name)&is_public=eq.true&order=starts_at.asc&limit=20`,{
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
    });
    const d=await r.json();
    if(Array.isArray(d))setEvents(d);
    // Fetch joined events
    if(user?.id){
      const jr=await fetch(`${SB_URL}/rest/v1/event_members?user_id=eq.${user.id}&select=event_id`,{
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
      });
      const jd=await jr.json();
      if(Array.isArray(jd))setJoinedEvents(new Set(jd.map(x=>x.event_id)));
    }
    setEventsLoading(false);
  }
  async function joinEvent(eventId){
    if(!user?.id)return;
    const joined=joinedEvents.has(eventId);
    if(joined){
      await fetch(`${SB_URL}/rest/v1/event_members?event_id=eq.${eventId}&user_id=eq.${user.id}`,{
        method:"DELETE",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
      });
      setJoinedEvents(prev=>{const s=new Set(prev);s.delete(eventId);return s;});
    } else {
      await fetch(`${SB_URL}/rest/v1/event_members`,{
        method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`,"Content-Type":"application/json"},
        body:JSON.stringify({event_id:eventId,user_id:user.id})
      });
      setJoinedEvents(prev=>new Set([...prev,eventId]));
    }
    setEvents(prev=>prev.map(e=>e.id===eventId?{...e,member_count:joined?e.member_count-1:e.member_count+1}:e));
  }
  async function createEvent(){
    if(!eventForm.title||!eventForm.starts_at||!eventForm.ends_at)return;
    await fetch(`${SB_URL}/rest/v1/events`,{
      method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`,"Content-Type":"application/json"},
      body:JSON.stringify({...eventForm,host_id:user.id})
    });
    setShowCreateEvent(false);setEventForm({title:"",description:"",subject:"Physics",type:"marathon",starts_at:"",ends_at:""});
    fetchEvents();
  }
  async function openCamera(){
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      setCameraStream(stream);setShowCamera(true);
      setTimeout(()=>{if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play();}},100);
    }catch(e){showToast("camera access denied. check browser settings.");}
  }
  function capturePhoto(){
    if(!videoRef.current||!canvasRef.current)return;
    const v=videoRef.current,c=canvasRef.current;
    c.width=v.videoWidth;c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    setPostCapture(c.toDataURL("image/jpeg",0.85));
    closeCamera();
  }
  function closeCamera(){
    cameraStream?.getTracks().forEach(t=>t.stop());
    setCameraStream(null);setShowCamera(false);
  }
  async function fetchLeaderboard(){
    const r=await fetch(`${SB_URL}/rest/v1/weekly_leaderboard`,{
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
    });
    const d=await r.json();
    if(Array.isArray(d))setLeaderboard(d.slice(0,50));
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
      const cards=await callAI(`You are an elite CFA exam coach. Return ONLY valid JSON. No markdown.
{"cards":[{"type":"effort_trap","title":"Effort vs Score Gap","icon":"⚠","color":"danger","insight":"2-3 sharp sentences","topics":["t1","t2"],"action":"1 sentence"},{"type":"strengths","title":"Your Strengths","icon":"💪","color":"success","insight":"2-3 sentences","topics":["t1"],"action":"1 sentence"},{"type":"critical_gaps","title":"Critical Gaps","icon":"🎯","color":"warning","insight":"2-3 sentences","topics":["t1","t2"],"action":"1 sentence"},{"type":"time_analysis","title":"Time Analysis","icon":"⏱","color":"info","insight":"2-3 sentences","recommendation":"1 sentence"},{"type":"pyq_analysis","title":"PYQ Performance","icon":"📝","color":"info","insight":"2-3 sentences","action":"1 sentence"},{"type":"weekly_focus","title":"This Week's Focus","icon":"📅","color":"primary","insight":"2 sentences","plan":["Mon-Tue","Wed-Thu","Fri-Sun"]}]}`,
        `CFA Level:${jeClass}. Study:${ss}. Mocks:${ms}. Topics>2h:${ef||"none"}. PYQs:${ps}. Streak:${streak}d. Be sharp and specific.`,true);
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
            (getWeight(sub,t,jeClass)||"M")==="H"
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
          weight: getWeight(t.subject,t.topic,jeClass)||"M",
          studied: sessions.some(s=>s.subject===t.subject&&s.topic===t.topic)
        }))
        .filter(t=>t.acc<60&&t.total>=2)
        .sort((a,b)=>{
          // H-weight poor topics first, then by worst accuracy
          const wOrder={"H":0,"M":1,"L":2};const wdiff=(wOrder[b.weight]||1)-(wOrder[a.weight]||1);
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
            .map(([t])=>`${s.sub}-${t}(mock:${s.avg}/100,${getWeight(s.sub,t,jeClass)||"M"}-weight)`);
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

  // ── CSS ───────────────────────────────────────────────────────────────────
  // ─── Onboarding ───────────────────────────────────────────────────────────

  // ── Exam Setup flow — runs once after level is picked ────────────────────
  // ExamSetupDone is false if: brand new user, OR returning user with stale JEE class (dropper/11th/12th)
  const needsSetup = !examSetupDone || !jeClass || !CLASSES.find(c=>c.id===jeClass);
  if(needsSetup) return(
    <ExamSetupScreen
      d={d}
      initialLevel={CLASSES.find(c=>c.id===jeClass)?jeClass:null}
      onComplete={(setup)=>{
        setJeClass(setup.level);
        setExamWindow(setup.examWindow);
        setStudyDays(setup.studyDays);
        setEduStatus(setup.eduStatus);
        setTargetHours(setup.targetHours);
        setExamSetupDone(true);
        try{
          localStorage.setItem("slothr_class",setup.level);
          localStorage.setItem("nev_exam_window",setup.examWindow);
          localStorage.setItem("nev_study_days",JSON.stringify(setup.studyDays));
          localStorage.setItem("nev_edu_status",setup.eduStatus||"");
          localStorage.setItem("nev_target_hours",String(setup.targetHours));
          localStorage.setItem("nev_exam_setup_done","1");
        }catch(e){}
        if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,cfa_level:setup.level,exam_window:setup.examWindow,study_days:setup.studyDays,edu_status:setup.eduStatus,target_hours:setup.targetHours})}).catch(()=>{});
      }}
    />
  );

  const classLabel=CLASSES.find(c=>c.id===jeClass)?.label||'CFA';

  // ── Fullscreen render ─────────────────────────────────────────────────────
  const renderFS=()=>{
    const isCD=timerMode==="countdown";
    const FS_R=120,FS_C=2*Math.PI*FS_R;
    return(
      <div className="fs-overlay">  <button className="fs-exit" onClick={()=>setFullscreen(false)}>✕ back  <span style={{opacity:.4,fontSize:9}}>ESC</span></button>
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
                  <circle cx="150" cy="150" r={FS_R} fill="none" stroke={subColor+"18"} strokeWidth="10"/>
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
          <button className={"mode-opt"+(timerMode==="stopwatch"?" active":"")} onClick={()=>{if(!timerOn){setTimerMode("stopwatch");resetTimer();}}}>⏱ Stopwatch</button>
          <button className={"mode-opt"+(timerMode==="countdown"?" active":"")} onClick={()=>{if(!timerOn){setTimerMode("countdown");resetTimer();}}}>⏳ Countdown</button>
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
              <circle cx="100" cy="100" r={RING} fill="none" stroke={subColor+"12"} strokeWidth="7"/>
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
        <div style={{marginTop:7,display:"flex",gap:7,alignItems:"center"}}>
          <button onClick={openCamera} style={{flex:1,padding:"8px",borderRadius:3,background:d.hover,border:`1px solid ${d.b}`,color:d.t3,cursor:"pointer",fontFamily:"inherit",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            📷 {postCapture?"photo ready ✓":"attach photo"}
          </button>
          {postCapture&&<button onClick={()=>setPostCapture(null)} style={{padding:"8px 10px",borderRadius:3,background:"transparent",border:`1px solid ${d.b}`,color:d.t3,cursor:"pointer",fontFamily:"inherit",fontSize:11}}>×</button>}
        </div>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return(
    <>
      {/* ── Ad Modals ── */}

      {fullscreen&&renderFS()}
      <div className="layout" style={{visibility:fullscreen?"hidden":"visible"}}>
      {/* ── Sticky Banner Ad ── */}

        <div className="sb-overlay" onClick={()=>setSideOpen(false)}/>
        <aside className="sidebar">
          {/* Logo */}
          <div className="s-logo">
            <button className="s-toggle" onClick={()=>setSideOpen(p=>!p)}>
              {sideOpen?"←":"→"}
            </button>
            <div className="s-brand">
              nevile<span style={{color:d.a1}}>te</span>
            </div>
          </div>

          {/* Today card */}
          <div className="s-today" style={{margin:"0 10px 4px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:11,fontWeight:600,color:d.t2}}>{todayTime>0?fmt(todayTime)+" today":"start studying"}</span>
              <span style={{fontSize:11,color:d.a1,fontWeight:700}}>🔥 {streak}d</span>
            </div>
            <div style={{height:3,background:d.b,borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",width:Math.min((todayTime/360)*100,100)+"%",background:"linear-gradient(90deg,"+d.a1+","+d.a3+")",borderRadius:2,transition:"width .8s"}}/>
            </div>
          </div>

          <nav className="s-nav">
            {/* Study tools */}
            {sideOpen&&<div style={{fontSize:9,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:d.t4,padding:"8px 12px 4px"}}>Study</div>}
            {["overview","rank","goals","planner","syllabus","revision","mocks","sessions","coach","streaks"].map(id=>{
              const t=TABS.find(x=>x.id===id);
              if(!t)return null;
              return(
                <div key={t.id}
                  className={"s-item"+(tab===t.id?" active":"")}
                  onClick={()=>switchTab(t.id)}
                  title={!sideOpen?t.label:""}>
                  <span className="s-icon">{t.icon}</span>
                  <span className="s-label">{t.label}</span>
                  {tab===t.id&&sideOpen&&<div style={{marginLeft:"auto",width:4,height:4,borderRadius:"50%",background:d.a1}}/>}
                </div>
              );
            })}

            <div className="s-divider"/>

            {/* Social */}
            {sideOpen&&<div style={{fontSize:9,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:d.t4,padding:"4px 12px 4px"}}>Community</div>}
            {["buddy","report","profile"].map(id=>{
              const t=TABS.find(x=>x.id===id);
              if(!t)return null;
              return(
                <div key={t.id}
                  className={"s-item"+(tab===t.id?" active":"")}
                  onClick={()=>switchTab(t.id)}
                  title={!sideOpen?t.label:""}>
                  <span className="s-icon">{t.icon}</span>
                  <span className="s-label">{t.label}</span>
                  {tab===t.id&&sideOpen&&<div style={{marginLeft:"auto",width:4,height:4,borderRadius:"50%",background:d.a1}}/>}
                </div>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="s-footer">
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 4px",borderRadius:10,cursor:"pointer"}}
              onClick={()=>switchTab("profile")}>
              {user?.avatar
                ?<img src={user.avatar} style={{width:32,height:32,borderRadius:10,objectFit:"cover",flexShrink:0}} alt=""/>
                :<div className="s-av">{(user?.name||"S")[0].toUpperCase()}</div>
              }
              <div className="s-uinfo">
                <div style={{fontSize:12,fontWeight:600,color:d.t,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:120}}>{user?.name||"Student"}</div>
                <div style={{fontSize:10,color:d.t3,marginTop:1}}>@{profile?.username||"..."}</div>
              </div>
              {sideOpen&&(
                <button onClick={e=>{e.stopPropagation();handleSignOut();}}
                  style={{marginLeft:"auto",background:"none",border:"none",color:d.t4,cursor:"pointer",fontSize:16,padding:"4px",flexShrink:0,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center"}}
                  title="sign out">
                  ⏻
                </button>
              )}
            </div>
            {sideOpen&&(
              <div style={{display:"flex",gap:6,marginTop:8}}>
                <button onClick={()=>setDark(p=>!p)}
                  style={{flex:1,padding:"7px",borderRadius:8,background:d.hover,border:"none",color:d.t3,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                  {dark?"☀ Light":"◑ Dark"}
                </button>
                <button onClick={()=>setJeClass(null)}
                  style={{flex:1,padding:"7px",borderRadius:8,background:d.hover,border:"none",color:d.t3,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
                  ↺ Class
                </button>
              </div>
            )}
          </div>
        </aside>

        <div className="content">
          {tab!=="pyq"&&<div className="topbar">
            {/* Always-visible Slothr logo */}
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,flex:1}}>
              <button className="mob-btn" onClick={()=>setSideOpen(p=>!p)} aria-label="menu">☰</button>
              <div style={{minWidth:0}}>
                <div className="ptitle">{TABS.find(t=>t.id===tab)?.label}</div>
                <div className="psub">
                  {tab==="overview"&&`${new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"})}${examDate?" · "+Math.max(0,Math.ceil((new Date(examDate)-new Date())/86400000))+"d left":""}. tick tock.`}
                  {tab==="coach"&&"your CFA exam co-pilot. i know things about you."}
                  {tab==="goals"&&(todayGoals.length===0?"no goals. bold strategy.":todayGoals.filter(g=>g.achieved).length===todayGoals.length?`all ${todayGoals.length} done.`:`${todayGoals.filter(g=>g.achieved).length}/${todayGoals.length} done.`)}
                  {tab==="sessions"&&`${sessions.length} sessions · ${fmt(totalTime)} total. not bad.`}
                  {tab==="streaks"&&`${streak} day streak${currentMilestone?" · "+currentMilestone.icon+" "+currentMilestone.label:""}`}
                  {tab==="syllabus"&&"track every chapter. i know which ones you're avoiding."}
                  {tab==="revision"&&"spaced repetition. i'll remind you before you forget."}
                  {tab==="rank"&&"are you ready to pass. be honest."}
                  {tab==="planner"&&"your full roadmap, auto-built around your exam date."}
                  {tab==="mocks"&&"log every mock. track every score. see the trend."}
                  {tab==="buddy"&&"find someone studying the same level. suffer together."}
                  {tab==="partner"&&"two candidates, one deadline. accountability works."}
                  {tab==="report"&&"every sunday, the truth about your week."}
                  {tab==="profile"&&`@${profile?.username||"..."}`}
                </div>
              </div>
            </div>
            <div className="tbr">
              <button className="icon-btn" onClick={()=>setDark(p=>!p)}>{dark?"☀":"◑"}</button>
              <button className="ghost-sm" onClick={()=>setJeClass(null)}>switch class</button>
            </div>
          </div>}



          <div className="inner">

            {/* ── OVERVIEW ── */}
            {tab==="overview"&&(()=>{
              const daysLeft=examDate?Math.max(0,Math.ceil((new Date(examDate)-new Date())/86400000)):null;
              const totalHrs=Math.round(sessions.reduce((a,s)=>a+(s.duration||0),0)/60*10)/10;
              const targetHrs=targetHours||300;
              const pct=Math.min(100,Math.round((totalHrs/targetHrs)*100));
              const wkMins=sessions.filter(s=>s.date>=weekStart).reduce((a,s)=>a+(s.duration||0),0);
              const todayMins=sessions.filter(s=>s.date===today()).reduce((a,s)=>a+(s.duration||0),0);

              // Today's items from roadmap
              const todayRoadmap=roadmapTodayItems;
              const isStudyDay=(studyDays||[]).includes(weekdayIndex(today()));

              // Nearest upcoming topics from roadmap (next few days) for context
              const upcoming=(roadmap?.weeks||[]).flatMap(w=>w.days)
                .filter(dd=>dd.date>today()).slice(0,2)
                .flatMap(dd=>dd.items.slice(0,2).map(it=>({...it,date:dd.date})));

              // Readiness score (simple weighted)
              const SUBS=Object.keys(TOPICS).filter(sub=>classTopics(sub).length>0);
              const totalChaps=SUBS.reduce((a,sub)=>a+classTopics(sub).length,0);
              const doneChaps=SUBS.reduce((a,sub)=>a+classTopics(sub).filter(t=>syllabusStatus[sub+"|"+t]==="done").length,0);
              const covPct=totalChaps>0?Math.round((doneChaps/totalChaps)*100):0;
              const readiness=Math.round(Math.min(100,(pct*0.4)+(covPct*0.4)+(Math.min(streak,30)/30*20)));
              const readColor=readiness>=70?d.a2:readiness>=40?d.gold:d.danger;
              const readLabel=readiness>=70?"On Track":readiness>=40?"Needs Work":"At Risk";

              return(
                <div className="pin">
                  {/* ── Countdown banner ── */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:16}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:d.t4,marginBottom:4}}>
                        {windowData?windowData.label:"Exam Window"}
                      </div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:32,color:d.t,letterSpacing:"-.03em",lineHeight:1}}>
                        {daysLeft!==null?<>{daysLeft} <span style={{fontSize:16,color:d.t3}}>days left</span></>:"set your exam date"}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:20,alignItems:"center"}}>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:22,fontWeight:700,color:readColor,fontFamily:"'DM Serif Display',serif"}}>{readiness}</div>
                        <div style={{fontSize:9,color:d.t3,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>readiness</div>
                        <div style={{fontSize:9,fontWeight:700,color:readColor}}>{readLabel}</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:22,fontWeight:700,color:d.a1,fontFamily:"'DM Serif Display',serif"}}>{streak}d</div>
                        <div style={{fontSize:9,color:d.t3,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>streak</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:22,fontWeight:700,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{totalHrs}h</div>
                        <div style={{fontSize:9,color:d.t3,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>logged</div>
                        <div style={{fontSize:9,color:d.t4}}>of {targetHrs}h</div>
                      </div>
                    </div>
                  </div>

                  {/* ── Questionnaire modal ── */}
                  {showRoadmapQs&&(
                    <RoadmapQuestionnaire
                      d={d} jeClass={jeClass}
                      onSave={(ans)=>{saveRoadmapAnswers(ans);setShowRoadmapQs(false);}}
                      onSkip={()=>{saveRoadmapAnswers({skipped:true});setShowRoadmapQs(false);}}
                    />
                  )}

                  {/* ── Today's study plan ── */}
                  <div style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:d.t,letterSpacing:"-.02em"}}>
                        {isRevisionPhase?"Revision mode — today":"What to study today"}
                      </div>
                      <div style={{fontSize:11,color:d.t3}}>
                        {todayMins>0?fmt(todayMins)+" logged today":"nothing logged yet"}
                      </div>
                    </div>

                    {/* Personalise CTA when no questionnaire answers yet */}
                  {!roadmapAnswers&&!showRoadmapQs&&todayRoadmap.length>0&&(
                    <div style={{padding:"14px 18px",borderRadius:10,background:d.a1+"10",border:`1px solid ${d.a1}25`,marginBottom:14,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{fontSize:13,fontWeight:600,color:d.t,marginBottom:3}}>personalise your roadmap</div>
                        <div style={{fontSize:12,color:d.t3}}>tell us what you've already covered and where you're weakest — we'll adjust what appears here.</div>
                      </div>
                      <button onClick={()=>setShowRoadmapQs(true)}
                        style={{padding:"9px 18px",borderRadius:8,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,flexShrink:0}}>
                        answer 3 questions →
                      </button>
                    </div>
                  )}

                  {!isStudyDay&&!isRevisionPhase&&(
                      <div style={{padding:"12px 16px",borderRadius:10,background:d.gold+"10",border:`1px solid ${d.gold}25`,fontSize:12.5,color:d.t2,marginBottom:12}}>
                        📅 today isn't one of your scheduled study days — but any session still counts.
                      </div>
                    )}

                    {todayRoadmap.length===0&&!isRevisionPhase&&(
                      <div style={{padding:"24px",textAlign:"center",background:d.card,border:`1px solid ${d.b}`,borderRadius:12}}>
                        <div style={{fontSize:22,marginBottom:8}}>✓</div>
                        <div style={{fontSize:14,fontWeight:600,color:d.t,marginBottom:4}}>nothing scheduled today</div>
                        <div style={{fontSize:12,color:d.t3}}>check the planner for what's coming up, or log a free study session.</div>
                      </div>
                    )}

                    {todayRoadmap.map((item,i)=>{
                      const key=itemKey(today(),item);
                      const done=roadmapDone[key];
                      const col=SUBJECT_COLORS[item.subject]||d.a1;
                      return(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:done?d.hover:d.card,border:`1px solid ${done?d.b:col+"30"}`,borderLeft:`3px solid ${done?d.b:col}`,borderRadius:10,marginBottom:8,transition:"all .2s",opacity:done?.6:1}}>
                          <div onClick={()=>toggleRoadmapItem(today(),item)}
                            style={{width:22,height:22,borderRadius:6,border:`2px solid ${done?d.a2:d.b}`,background:done?d.a2:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,color:"#fff",fontSize:12,fontWeight:700,transition:"all .15s"}}>
                            {done&&"✓"}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13.5,fontWeight:600,color:done?d.t3:d.t,textDecoration:done?"line-through":"none",marginBottom:3}}>{item.topic}</div>
                            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                              <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:col+"18",color:col,fontWeight:700}}>{item.subject}</span>
                              <span style={{fontSize:10,color:d.t4}}>{item.weight==="H"?"● high weight":item.weight==="M"?"● medium weight":"● lower weight"}</span>
                              {item.totalPasses>1&&<span style={{fontSize:10,color:d.t4}}>pass {item.pass}/{item.totalPasses}</span>}
                            </div>
                          </div>
                          {!done&&(
                            <button onClick={()=>{startTimer({...item,_date:today()});}} disabled={timerOn}
                              style={{padding:"7px 14px",borderRadius:7,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",flexShrink:0,opacity:timerOn?.4:1}}>
                              ▶ start
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {isRevisionPhase&&(
                      <div>
                        <div style={{fontSize:12,color:d.t3,marginBottom:12,fontStyle:"italic"}}>you're in the final revision window. focus on these high-weight topics:</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
                          {(roadmap?.revisionTopics||[]).slice(0,8).map((t,i)=>(
                            <div key={i} style={{padding:"10px 12px",background:d.card,border:`1px solid ${d.b}`,borderLeft:`3px solid ${SUBJECT_COLORS[t.subject]||d.a1}`,borderRadius:8}}>
                              <div style={{fontSize:12.5,fontWeight:600,color:d.t}}>{t.topic}</div>
                              <div style={{fontSize:10,color:d.t3,marginTop:2}}>{t.subject}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Quick stats row ── */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:20}}>
                    {[
                      {l:"This Week",v:fmt(wkMins),c:d.a1},
                      {l:"Syllabus",v:covPct+"%",c:covPct>=70?d.a2:d.gold},
                      {l:"Target",v:pct+"%",c:pct>=70?d.a2:d.gold},
                      {l:"Sessions",v:sessions.length,c:d.t2},
                    ].map(s=>(
                      <div key={s.l} style={{textAlign:"center",padding:"14px 8px",background:d.card,border:`1px solid ${d.b}`,borderRadius:10}}>
                        <div style={{fontSize:20,fontWeight:700,color:s.c,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{s.v}</div>
                        <div style={{fontSize:9,color:d.t3,marginTop:4,textTransform:"uppercase",letterSpacing:".05em"}}>{s.l}</div>
                      </div>
                    ))}
                  </div>

                  {/* ── Coming up ── */}
                  {upcoming.length>0&&(
                    <div style={{padding:"14px 18px",background:d.card,border:`1px solid ${d.b}`,borderRadius:12}}>
                      <div style={{fontSize:11,fontWeight:700,color:d.t3,letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Coming up next</div>
                      {upcoming.map((item,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:i<upcoming.length-1?`1px solid ${d.b}`:"none"}}>
                          <div style={{width:6,height:6,borderRadius:"50%",background:SUBJECT_COLORS[item.subject]||d.a1,flexShrink:0}}/>
                          <div style={{flex:1,fontSize:12,color:d.t2}}>{item.topic}</div>
                          <div style={{fontSize:10,color:d.t4}}>{item.date}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── JEE COACH ── */}
            {tab==="coach"&&(
              <div className="pin">
                <div style={{marginBottom:24}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:d.t,letterSpacing:"-.02em",marginBottom:4}}>Analytics</div>
                  <div style={{fontSize:12,color:d.t3}}>your study data, decoded.</div>
                </div>

                {/* ── Hours by subject ── */}
                {(() => {
                  const totalMins=sessions.reduce((a,s)=>a+(s.duration||0),0);
                  const subjectData=Object.keys(SUBJECT_COLORS).map(sub=>({
                    sub,
                    mins:sessions.filter(s=>s.subject===sub).reduce((a,s)=>a+(s.duration||0),0),
                    color:SUBJECT_COLORS[sub],
                    weight:CFA_WEIGHTS[sub]?.[jeClass]||"M",
                    range:TOPIC_WEIGHT_RANGES[sub]?.[jeClass]||"—",
                  })).filter(s=>s.mins>0).sort((a,b)=>b.mins-a.mins);
                  const maxMins=subjectData[0]?.mins||1;
                  const wkMins=sessions.filter(s=>s.date>=weekStart).reduce((a,s)=>a+(s.duration||0),0);
                  const avgSession=sessions.length?Math.round(totalMins/sessions.length):0;
                  // Weekly trend
                  const weeks=[];
                  for(let i=3;i>=0;i--){
                    const ws=addDays(weekStartOf(today()),-i*7);
                    const we=addDays(ws,6);
                    const wMins=sessions.filter(s=>s.date>=ws&&s.date<=we).reduce((a,s)=>a+(s.duration||0),0);
                    weeks.push({label:`W${4-i}`,mins:wMins});
                  }
                  const maxWkMins=Math.max(...weeks.map(w=>w.mins),1);
                  // Predicted completion
                  const targetHrs2=targetHours||300;
                  const daysStudied=new Set(sessions.map(s=>s.date)).size;
                  const avgHrsPerStudyDay=daysStudied>0?(totalMins/60)/daysStudied:0;
                  const studyDaysPerWeek=(studyDays||[0,1,2,3,4]).length;
                  const hrsPerWeek=avgHrsPerStudyDay*studyDaysPerWeek;
                  const hrsLeft=Math.max(0,targetHrs2-totalMins/60);
                  const weeksToFinish=hrsPerWeek>0?hrsLeft/hrsPerWeek:null;
                  const predictedFinish=weeksToFinish?addDays(today(),Math.round(weeksToFinish*7)):null;
                  const daysToExam=examDate?Math.max(0,daysBetween(today(),examDate)):null;
                  const daysToFinish=predictedFinish?daysBetween(today(),predictedFinish):null;
                  const finishBeforeExam=daysToFinish!==null&&daysToExam!==null?daysToExam-daysToFinish:null;

                  return(<div>
                    {/* ── Key stats ── */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:20}}>
                      {[
                        {l:"Total Hours",v:Math.round(totalMins/60*10)/10+"h",c:d.a1},
                        {l:"This Week",v:Math.round(wkMins/60*10)/10+"h",c:d.a2},
                        {l:"Avg Session",v:fmt(avgSession),c:d.t2},
                        {l:"Sessions",v:sessions.length,c:d.t2},
                      ].map(s=>(
                        <div key={s.l} style={{textAlign:"center",padding:"14px 8px",background:d.card,border:`1px solid ${d.b}`,borderRadius:10}}>
                          <div style={{fontSize:22,fontWeight:700,color:s.c,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{s.v}</div>
                          <div style={{fontSize:9,color:d.t3,marginTop:4,textTransform:"uppercase",letterSpacing:".05em"}}>{s.l}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── Prediction ── */}
                    {predictedFinish&&(
                      <div style={{padding:"14px 18px",borderRadius:10,background:finishBeforeExam>0?d.a2+"10":d.danger+"10",border:`1px solid ${finishBeforeExam>0?d.a2:d.danger}30`,marginBottom:20,fontSize:13,color:d.t2,lineHeight:1.7}}>
                        {finishBeforeExam>0
                          ?`📈 at your current pace (${Math.round(hrsPerWeek*10)/10}h/week) you'll complete your ${targetHrs2}h target ${finishBeforeExam} days before the exam. keep it up.`
                          :`⚠ at your current pace you'll finish ${Math.abs(finishBeforeExam)} days AFTER your exam. you need to study ${Math.round((hrsLeft/Math.max(1,daysToExam/7))*10)/10}h/week to stay on track.`}
                      </div>
                    )}

                    {/* ── Weekly trend ── */}
                    <div style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:12,padding:"18px",marginBottom:20}}>
                      <div style={{fontSize:13,fontWeight:700,color:d.t,marginBottom:14}}>Weekly study trend</div>
                      <div style={{display:"flex",gap:8,alignItems:"flex-end",height:80}}>
                        {weeks.map((w,i)=>(
                          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                            <div style={{width:"100%",background:i===3?d.a1:d.a1+"50",borderRadius:"4px 4px 0 0",height:Math.max(4,(w.mins/maxWkMins)*70)+"px",transition:"height .5s"}}/>
                            <div style={{fontSize:9,color:d.t3}}>{w.label}</div>
                            <div style={{fontSize:9,color:d.t4}}>{Math.round(w.mins/60*10)/10}h</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Hours by subject ── */}
                    {subjectData.length>0&&(
                      <div style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:12,padding:"18px",marginBottom:20}}>
                        <div style={{fontSize:13,fontWeight:700,color:d.t,marginBottom:14}}>Hours by subject</div>
                        {subjectData.map(s=>(
                          <div key={s.sub} style={{marginBottom:12}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                              <div style={{display:"flex",alignItems:"center",gap:7}}>
                                <div style={{width:8,height:8,borderRadius:2,background:s.color}}/>
                                <span style={{fontSize:12.5,fontWeight:600,color:d.t}}>{s.sub}</span>
                                <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:s.color+"18",color:s.color,fontWeight:700}}>{s.range}</span>
                              </div>
                              <span style={{fontSize:11,color:d.t3}}>{Math.round(s.mins/60*10)/10}h</span>
                            </div>
                            <div style={{height:5,background:d.b,borderRadius:3,overflow:"hidden"}}>
                              <div style={{height:"100%",width:(s.mins/maxMins*100)+"%",background:s.color,borderRadius:3,transition:"width .5s"}}/>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── High weight coverage ── */}
                    {(() => {
                      const SUBS=Object.keys(TOPICS).filter(sub=>classTopics(sub).length>0);
                      const highWt=SUBS.flatMap(sub=>classTopics(sub).filter(t=>getWeight(sub,t,jeClass)==="H").map(t=>({sub,t,done:sessions.some(s=>s.subject===sub&&s.topic===t)})));
                      const done=highWt.filter(x=>x.done).length;
                      const pct=highWt.length?Math.round(done/highWt.length*100):0;
                      const notDone=highWt.filter(x=>!x.done).slice(0,5);
                      return(
                        <div style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:12,padding:"18px",marginBottom:20}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                            <div style={{fontSize:13,fontWeight:700,color:d.t}}>High-weight topic coverage</div>
                            <div style={{fontSize:13,fontWeight:700,color:pct>=70?d.a2:d.gold}}>{pct}%</div>
                          </div>
                          <div style={{height:6,background:d.b,borderRadius:3,overflow:"hidden",marginBottom:12}}>
                            <div style={{height:"100%",width:pct+"%",background:pct>=70?d.a2:d.gold,borderRadius:3,transition:"width .6s"}}/>
                          </div>
                          {notDone.length>0&&<div>
                            <div style={{fontSize:11,color:d.t3,marginBottom:8}}>high-weight topics not yet studied:</div>
                            {notDone.map((x,i)=>(
                              <div key={i} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:`1px solid ${d.b}44`,fontSize:12,color:d.t2}}>
                                <span style={{color:SUBJECT_COLORS[x.sub]||d.a1,fontWeight:600,minWidth:80}}>{x.sub}</span>
                                <span>{x.t}</span>
                              </div>
                            ))}
                          </div>}
                        </div>
                      );
                    })()}

                    {sessions.length===0&&(
                      <div style={{textAlign:"center",padding:"40px 24px",color:d.t3,fontSize:13,fontStyle:"italic"}}>
                        log study sessions to see your analytics.
                      </div>
                    )}
                  </div>);
                })()}
                {!coachCards&&!coachLoading&&false&&(<div/>)}
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
                      <div key={i} className={"coach-card "+card.color}>
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
                        const hGaps=Object.keys(TOPICS).flatMap(sub=>classTopics(sub).filter(t=>!sessions.some(s=>s.subject===sub&&s.topic===t)&&(getWeight(sub,t,jeClass)||"M")==="H")).length;
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
                      <div key={g.id} className={"goal-item"+g.achieved?" achieved":""}>
                        <div className={"goal-check"+g.achieved?" done":""} onClick={()=>setGoals(p=>p.map(x=>x.id===g.id?{...x,achieved:!x.achieved}:x))}>{g.achieved?"✓":""}</div>
                        <div className="f1">
                          <div className="rowb">
                            <div className={"goal-text"+g.achieved?" done":""}>{g.text}</div>
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
              const SUBS=Object.keys(TOPICS).filter(sub=>classTopics(sub).length>0);
              const STATUS_OPTS=[
                {v:"not_started",l:"Not Started",icon:"—",c:d.t4,bg:"transparent"},
                {v:"in_progress",l:"In Progress",icon:"▶",c:d.a3,bg:d.a3+"15"},
                {v:"done",l:"Done",icon:"✓",c:d.a2,bg:d.a2+"15"},
                {v:"need_revision",l:"Needs Revision",icon:"↺",c:d.a1,bg:d.a1+"15"},
              ];
              const WT_ORDER={"H":0,"M":1,"L":2};
              const allChapters=sub=>classTopics(sub);
              const sorted=sub=>[...allChapters(sub)].sort((a,b)=>(WT_ORDER[getWeight(sub,a,jeClass)||"M"]||1)-(WT_ORDER[getWeight(sub,b,jeClass)||"M"]||1));
              const chHrs=(sub,t)=>sessions.filter(s=>s.subject===sub&&s.topic===t).reduce((a,s)=>a+(s.duration||0),0);
              const chAcc=(sub,t)=>{const qs=pyqHistory.filter(p=>p.subject===sub&&p.topic===t);return qs.length?Math.round(qs.filter(p=>p.correct).length/qs.length*100):null;};
              const total=SUBS.reduce((a,sub)=>a+allChapters(sub).length,0);
              const done=Object.values(syllabusStatus).filter(v=>v==="done").length;
              const prog=Object.values(syllabusStatus).filter(v=>v==="in_progress").length;
              const rev=Object.values(syllabusStatus).filter(v=>v==="need_revision").length;
              const pct=total>0?Math.round((done/total)*100):0;
              const windowData=(CFA_EXAM_WINDOWS[jeClass]||[]).find(w=>w.id===examWindow);
              const examDaysLeft=windowData?Math.max(0,Math.ceil((new Date(windowData.start)-new Date())/86400000)):null;
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
                          <div style={{width:`${total?Math.round((done/total)*100):0}%`,background:d.a2,transition:"width .5s"}}/>
                          <div style={{width:`${total?Math.round((prog/total)*100):0}%`,background:d.a3}}/>
                          <div style={{width:`${total?Math.round((rev/total)*100):0}%`,background:d.a1}}/>
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
                        <div style={{fontSize:10,color:d.t3}}>{windowData?windowData.label:"Exam not set"}</div>
                        <div style={{fontSize:16,fontWeight:700,color:d.t}}>{examDaysLeft!==null?examDaysLeft+"d left":"—"}</div>
                      </div>
                    </div>
                  </div>

                  {/* ── High-yield chapters not yet studied (Mathongo-style) ── */}
                  {(() => {
                    const candidates=[];
                    SUBS.forEach(sub=>{
                      classTopics(sub).forEach(topic=>{
                        const prob=getTopicProbability(sub,topic);
                        const status=syllabusStatus[sub+"|"+topic]||"not_started";
                        if(prob>=4&&status!=="done"){
                          candidates.push({sub,topic,prob,status});
                        }
                      });
                    });
                    candidates.sort((a,b)=>b.prob-a.prob);
                    if(candidates.length===0)return null;
                    return(
                      <div className="card cp mb16" style={{borderColor:d.danger+"30"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                          <span style={{fontSize:18}}>🔴</span>
                          <span style={{fontSize:13,fontWeight:700,color:d.t}}>Study These First — They're Definitely on the Exam</span>
                        </div>
                        <div style={{fontSize:11,color:d.t3,marginBottom:12}}>{candidates.length} topics almost always show up on the exam. you haven't finished them yet.</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>
                          {candidates.slice(0,8).map((c,i)=>{
                            const prob=getProbabilityLabel(c.prob);
                            const col=SUBJECT_COLORS[c.sub]||d.a1;
                            return(
                              <div key={i} style={{padding:"10px 12px",background:d.hover,borderLeft:`3px solid ${col}`,borderRadius:6}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                                  <span style={{fontSize:13}}>{prob.emoji}</span>
                                  <div style={{fontSize:12,fontWeight:600,color:d.t,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.topic}</div>
                                </div>
                                <span style={{fontSize:9,color:col,fontWeight:700}}>{c.sub}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {SUBS.map(sub=>{
                    const chapters=sorted(sub);
                    const subDone=chapters.filter(t=>syllabusStatus[sub+"|"+t]==="done").length;
                    const subPct=chapters.length?Math.round((subDone/chapters.length)*100):0;
                    const subColor=SUBJECT_COLORS[sub]||d.a1;
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
                          const wtCh=chapters.filter(t=>(getWeight(sub,t,jeClass)||"M")===wt);
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
                                const probScore=getTopicProbability(sub,topic);
                                const prob=getProbabilityLabel(probScore);
                                return(
                                  <div key={topic} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",background:status==="done"?`${d.a2}05`:status==="in_progress"?`${d.a3}05`:status==="need_revision"?`${d.a1}05`:"transparent",borderBottom:`1px solid ${d.b}44`,transition:"background .12s"}}>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontSize:12,fontWeight:500,color:status==="done"?d.t3:d.t,textDecoration:status==="done"?"line-through":"none",textDecorationColor:d.t4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{topic}</div>
                                      <div style={{display:"flex",gap:6,marginTop:3,alignItems:"center"}}>
                                        <span title={prob.label} style={{fontSize:8.5,fontWeight:700,color:prob.color,background:prob.color+"15",padding:"1px 6px",borderRadius:2,display:"flex",alignItems:"center",gap:3}}>
                                          <span>{prob.emoji}</span>{prob.short}
                                        </span>
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



            {/* ── FEED ── */}
            {tab==="feed"&&(
              <div className="pin">
                {/* Camera modal */}
                {showCamera&&(
                  <div style={{position:"fixed",inset:0,zIndex:200,background:"#000",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <div style={{fontSize:13,color:"rgba(255,255,255,.6)",marginBottom:12,letterSpacing:".06em"}}>frame your study space</div>
                    <video ref={videoRef} style={{width:"100%",maxWidth:480,borderRadius:8}} playsInline muted autoPlay/>
                    <canvas ref={canvasRef} style={{display:"none"}}/>
                    <div style={{display:"flex",gap:12,marginTop:20}}>
                      <button onClick={capturePhoto} style={{padding:"14px 32px",borderRadius:40,background:"#fff",color:"#111",border:"none",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>📸 capture</button>
                      <button onClick={closeCamera} style={{padding:"14px 24px",borderRadius:40,background:"transparent",color:"#fff",border:"1px solid rgba(255,255,255,.3)",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>cancel</button>
                    </div>
                  </div>
                )}

                {/* User search */}
                <div className="card cp" style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:10}}>Find People</div>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp" placeholder="search by @username"
                      value={userSearch} onChange={e=>setUserSearch(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&searchUsers()}
                      style={{flex:1}}/>
                    <button onClick={searchUsers}
                      style={{padding:"9px 16px",borderRadius:4,background:d.t,color:d.bg,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      search
                    </button>
                  </div>
                  {searchResults.length>0&&(
                    <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
                      {searchResults.map(u=>(
                        <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0"}}>
                          <div style={{width:36,height:36,borderRadius:"50%",background:d.a1,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:13,flexShrink:0,overflow:"hidden"}}>
                            {u.avatar_url?<img src={u.avatar_url} style={{width:36,height:36,borderRadius:"50%",objectFit:"cover"}} alt=""/>:(u.display_name||"?")[0].toUpperCase()}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:600,color:d.t}}>{u.display_name||u.username}</div>
                            <div style={{fontSize:11,color:d.t3}}>@{u.username} · {u.je_class}</div>
                          </div>
                          <button onClick={()=>toggleFollow(u.id)}
                            style={{padding:"6px 14px",borderRadius:4,background:follows.has(u.id)?d.hover:d.a1,color:follows.has(u.id)?d.t3:"#fff",border:`1px solid ${follows.has(u.id)?d.b:d.a1}`,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>
                            {follows.has(u.id)?"following":"+ follow"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Feed tabs */}
                <div style={{display:"flex",gap:4,marginBottom:16}}>
                  {[["following","Following"],["discover","Discover"]].map(([v,l])=>(
                    <button key={v} onClick={()=>{setFeedTab(v);fetchFeed(v);}}
                      style={{padding:"7px 18px",borderRadius:6,border:`1px solid ${feedTab===v?d.a1:d.b}`,background:feedTab===v?d.a1+"12":"transparent",color:feedTab===v?d.a1:d.t3,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}>
                      {l}
                    </button>
                  ))}
                </div>

                {feedLoading&&[1,2,3].map(i=>(
                  <div key={i} className="card cp" style={{marginBottom:12}}>
                    <div className="shim" style={{width:"40%",height:12}}/>
                    <div className="shim" style={{width:"80%",height:10}}/>
                  </div>
                ))}

                {!feedLoading&&feed.length===0&&(
                  <div className="card empty">
                    <div style={{fontSize:28,marginBottom:10}}>◉</div>
                    <div className="et">{feedTab==="following"?"follow people to see their sessions.":"no sessions shared yet."}</div>
                    <div className="es">search @usernames above to find study partners</div>
                  </div>
                )}

                {feed.map(post=>{
                  const p=post.profiles||{};
                  const meta=post.metadata||{};
                  const liked=post._liked||false;

                  const timeAgo=t=>{const s=Math.floor((Date.now()-new Date(t))/1000);if(s<60)return s+"s";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d";};
                  async function loadComments(pid){
                    const r=await fetch(SB_URL+"/rest/v1/post_comments?post_id=eq."+(pid||post.id)+"&select=*,profiles!post_comments_user_id_fkey(username,display_name,avatar_url)&order=created_at.asc",{headers:{"apikey":SB_ANON,"Authorization":"Bearer "+authSession?.access_token}});
                    const d2=await r.json();
                    if(Array.isArray(d2))setComments(d2);
                  }
                  async function submitComment(){
                    if(!commentText.trim())return;
                    await fetch(SB_URL+"/rest/v1/post_comments",{method:"POST",headers:{"apikey":SB_ANON,"Authorization":"Bearer "+authSession?.access_token,"Content-Type":"application/json"},body:JSON.stringify({post_id:post.id,user_id:user.id,content:commentText})});
                    setCommentText("");
                    loadComments();
                  }
                  return(
                    <div key={post.id} className="card" style={{marginBottom:12,overflow:"hidden"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px 10px"}}>
                        <div style={{width:38,height:38,borderRadius:"50%",background:d.a1,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",flexShrink:0,fontSize:14,overflow:"hidden"}}>
                          {p.avatar_url?<img src={p.avatar_url} style={{width:38,height:38,borderRadius:"50%",objectFit:"cover"}} alt=""/>:(p.display_name||"?")[0].toUpperCase()}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:d.t}}>{p.display_name||p.username}</div>
                          <div style={{fontSize:11,color:d.t3}}>@{p.username} · {timeAgo(post.created_at)}</div>
                        </div>
                        {post.user_id!==user?.id&&(
                          <button onClick={()=>toggleFollow(post.user_id)}
                            style={{padding:"5px 12px",borderRadius:4,background:follows.has(post.user_id)?d.hover:d.a1,color:follows.has(post.user_id)?d.t3:"#fff",border:`1px solid ${follows.has(post.user_id)?d.b:d.a1}`,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>
                            {follows.has(post.user_id)?"following":"+ follow"}
                          </button>
                        )}
                      </div>

                      {/* Session stats - Strava style */}
                      {meta.duration&&(
                        <div style={{padding:"0 16px 12px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(80px,1fr))",gap:10}}>
                          {[
                            {l:"Duration",v:fmt(meta.duration)},
                            meta.subject&&{l:"Subject",v:meta.subject},
                            meta.topic&&{l:"Topic",v:meta.topic.slice(0,16)},
                            meta.streak&&{l:"Streak",v:meta.streak+"d 🔥"},
                          ].filter(Boolean).map(s=>(
                            <div key={s.l} style={{background:d.hover,borderRadius:6,padding:"8px 10px",textAlign:"center",border:`1px solid ${d.b}`}}>
                              <div style={{fontSize:14,fontWeight:700,color:d.t,lineHeight:1}}>{s.v}</div>
                              <div style={{fontSize:9,color:d.t3,marginTop:3,textTransform:"uppercase",letterSpacing:".05em"}}>{s.l}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {post.image_url&&(
                        <div style={{width:"100%",maxHeight:320,overflow:"hidden"}}>
                          <img src={post.image_url} style={{width:"100%",objectFit:"cover",maxHeight:320,display:"block"}} alt="study session"/>
                        </div>
                      )}

                      {post.content&&<div style={{padding:"10px 16px",fontSize:13.5,color:d.t,lineHeight:1.7,fontStyle:"italic"}}>{post.content}</div>}

                      <div style={{display:"flex",gap:4,padding:"10px 12px",borderTop:`1px solid ${d.b}`}}>
                        <button onClick={()=>likePost(post.id,liked)}
                          style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:6,background:"transparent",border:`1px solid ${liked?d.danger+"60":d.b}`,color:liked?d.danger:d.t3,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                          {liked?"♥":"♡"} {post.like_count||0}
                        </button>
                        <button onClick={()=>{const pid=post.id;setOpenCommentPostId(openCommentPostId===pid?null:pid);if(openCommentPostId!==pid)loadComments(pid);}}
                          style={{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:6,background:"transparent",border:`1px solid ${d.b}`,color:d.t3,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                          ◌ {post.comment_count||0}
                        </button>
                      </div>

                      {openCommentPostId===post.id&&(
                        <div style={{borderTop:`1px solid ${d.b}`,padding:"12px 16px"}}>
                          {comments.map(c=>(
                            <div key={c.id} style={{display:"flex",gap:8,marginBottom:10}}>
                              <div style={{width:28,height:28,borderRadius:"50%",background:d.a3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",flexShrink:0}}>
                                {(c.profiles?.display_name||"?")[0].toUpperCase()}
                              </div>
                              <div style={{flex:1,background:d.hover,borderRadius:8,padding:"7px 12px"}}>
                                <div style={{fontSize:11,fontWeight:600,color:d.t,marginBottom:2}}>@{c.profiles?.username}</div>
                                <div style={{fontSize:12.5,color:d.t2,lineHeight:1.5}}>{c.content}</div>
                              </div>
                            </div>
                          ))}
                          <div style={{display:"flex",gap:8,marginTop:8}}>
                            <input className="inp" placeholder="add a comment..." value={commentText}
                              onChange={e=>setCommentText(e.target.value)}
                              onKeyDown={e=>e.key==="Enter"&&submitComment()}
                              style={{flex:1,padding:"8px 12px",fontSize:12}}/>
                            <button onClick={submitComment}
                              style={{padding:"8px 14px",borderRadius:4,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                              post
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

                        {/* ── EVENTS ── */}
            {tab==="events"&&(
              <div className="pin">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                  <div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,letterSpacing:"-.02em"}}>Events</div>
                    <div style={{fontSize:12,color:d.t3,fontStyle:"italic",marginTop:2}}>compete. suffer. grow.</div>
                  </div>
                  <button onClick={()=>setShowCreateEvent(p=>!p)}
                    style={{padding:"8px 18px",borderRadius:6,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                    + Host Event
                  </button>
                </div>

                {/* Create event form */}
                {showCreateEvent&&(
                  <div className="card cp" style={{marginBottom:20}}>
                    <div style={{fontSize:13,fontWeight:700,color:d.t,marginBottom:14}}>Host a New Event</div>
                    <div className="field"><label className="fl">Title</label>
                      <input className="inp" placeholder="e.g. Physics PYQ Marathon" value={eventForm.title} onChange={e=>setEventForm(p=>({...p,title:e.target.value}))}/>
                    </div>
                    <div className="field"><label className="fl">Description</label>
                      <input className="inp" placeholder="what's the challenge?" value={eventForm.description} onChange={e=>setEventForm(p=>({...p,description:e.target.value}))}/>
                    </div>
                    <div className="g2" style={{gap:10,marginBottom:10}}>
                      <div className="field">
                        <label className="fl">Subject</label>
                        <Select value={eventForm.subject} onChange={v=>setEventForm(p=>({...p,subject:v}))} options={["Physics","Chemistry","Mathematics","All"]} d={d}/>
                      </div>
                      <div className="field">
                        <label className="fl">Type</label>
                        <Select value={eventForm.type} onChange={v=>setEventForm(p=>({...p,type:v}))} options={["marathon","challenge","sprint"]} d={d}/>
                      </div>
                    </div>
                    <div className="g2" style={{gap:10,marginBottom:14}}>
                      <div className="field"><label className="fl">Starts At</label>
                        <input className="inp" type="datetime-local" value={eventForm.starts_at} onChange={e=>setEventForm(p=>({...p,starts_at:e.target.value}))}/>
                      </div>
                      <div className="field"><label className="fl">Ends At</label>
                        <input className="inp" type="datetime-local" value={eventForm.ends_at} onChange={e=>setEventForm(p=>({...p,ends_at:e.target.value}))}/>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={createEvent} style={{padding:"9px 20px",borderRadius:6,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>Create Event</button>
                      <button onClick={()=>setShowCreateEvent(false)} style={{padding:"9px 16px",borderRadius:6,background:"transparent",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>cancel</button>
                    </div>
                  </div>
                )}

                {eventsLoading&&[1,2].map(i=><div key={i} className="card cp" style={{marginBottom:12}}><div className="shim" style={{width:"60%"}}/><div className="shim" style={{width:"40%"}}/></div>)}

                {!eventsLoading&&events.length===0&&(
                  <div className="card empty">
                    <div style={{fontSize:28,marginBottom:10}}>⚡</div>
                    <div className="et">no events yet.</div>
                    <div className="es">host the first one. be that person.</div>
                  </div>
                )}

                {events.map(ev=>{
                  const joined=joinedEvents.has(ev.id);
                  const now=new Date();
                  const start=new Date(ev.starts_at);
                  const end=new Date(ev.ends_at);
                  const isLive=now>=start&&now<=end;
                  const isUpcoming=now<start;
                  const isPast=now>end;
                  const subColor=SUBJECT_COLORS[ev.subject]||d.a3;
                  const typeEmoji={marathon:"🏃",challenge:"⚡",sprint:"🎯"}[ev.type]||"◎";
                  return(
                    <div key={ev.id} className="card" style={{marginBottom:12,overflow:"hidden",border:`1px solid ${isLive?d.a1+"60":d.b}`,borderTop:`3px solid ${isLive?d.a1:isPast?d.t4:subColor}`}}>
                      <div style={{padding:"14px 16px"}}>
                        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:8}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,flexWrap:"wrap"}}>
                              <span style={{fontSize:14}}>{typeEmoji}</span>
                              <span style={{fontSize:14,fontWeight:700,color:d.t}}>{ev.title}</span>
                              {isLive&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:`${d.a1}20`,color:d.a1,fontWeight:700,letterSpacing:".06em"}}>LIVE</span>}
                              {isUpcoming&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:`${subColor}15`,color:subColor,fontWeight:700}}>UPCOMING</span>}
                              {isPast&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:d.hover,color:d.t4,fontWeight:700}}>ENDED</span>}
                            </div>
                            {ev.description&&<div style={{fontSize:12,color:d.t3,marginBottom:6,lineHeight:1.5}}>{ev.description}</div>}
                            <div style={{display:"flex",gap:10,fontSize:11,color:d.t3,flexWrap:"wrap"}}>
                              <span>by @{ev.profiles?.username||"unknown"}</span>
                              <span>·</span>
                              <span style={{color:subColor}}>{ev.subject}</span>
                              <span>·</span>
                              <span>👥 {ev.member_count} joined</span>
                            </div>
                          </div>
                          {!isPast&&(
                            <button onClick={()=>joinEvent(ev.id)}
                              style={{padding:"8px 16px",borderRadius:6,flexShrink:0,
                                background:joined?d.hover:d.a1,color:joined?d.t3:"#fff",
                                border:`1px solid ${joined?d.b:d.a1}`,cursor:"pointer",
                                fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                              {joined?"joined ✓":"join"}
                            </button>
                          )}
                        </div>
                        <div style={{fontSize:11,color:d.t4}}>
                          {start.toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                          {" → "}
                          {end.toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── PROFILE ── */}
            {/* ── STUDY BUDDY ── */}
            {tab==="buddy"&&(
              <div className="pin">
                <div style={{marginBottom:20}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,letterSpacing:"-.02em",marginBottom:4}}>study buddy</div>
                  <div style={{fontSize:12,color:d.t3}}>add friends by username. see how much they're studying — nothing more, nothing less.</div>
                </div>

                {/* Recommended buddies — matched by level + exam window */}
                {recommendedBuddies.length>0&&(
                  <div className="card cp" style={{marginBottom:20}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontSize:14}}>✨</span>
                      <div style={{fontSize:12,fontWeight:700,color:d.t}}>Recommended for you</div>
                    </div>
                    <div style={{fontSize:11,color:d.t3,marginBottom:14}}>
                      other {CLASSES.find(c=>c.id===jeClass)?.label||jeClass} candidates{examWindow?", same exam window where possible":""}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {recommendedBuddies.map(u=>{
                        const sameWindow=u.exam_window===examWindow&&examWindow;
                        return(
                          <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0"}}>
                            <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:13,flexShrink:0,overflow:"hidden"}}>
                              {u.avatar_url?<img src={u.avatar_url} style={{width:36,height:36,borderRadius:"50%",objectFit:"cover"}}/>:(u.display_name||u.username||"?")[0].toUpperCase()}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:600,color:d.t}}>{u.display_name||u.username}</div>
                              <div style={{fontSize:11,color:d.t3}}>
                                @{u.username}{sameWindow&&<span style={{color:d.a2,fontWeight:600}}> · same exam window</span>}
                              </div>
                            </div>
                            <button onClick={()=>{addBuddy(u);setRecommendedBuddies(prev=>prev.filter(r=>r.id!==u.id));}}
                              style={{padding:"6px 14px",borderRadius:6,background:d.a2,color:"#06140f",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                              + add
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {recommendedLoading&&recommendedBuddies.length===0&&(
                  <div style={{textAlign:"center",padding:"16px",fontSize:11,color:d.t3,fontStyle:"italic"}}>finding people studying the same level...</div>
                )}

                {/* Search */}
                <div className="card cp" style={{marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:10}}>Add a friend</div>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp" placeholder="@username" value={buddySearch}
                      onChange={e=>setBuddySearch(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&searchBuddy()}
                      style={{flex:1}}/>
                    <button onClick={searchBuddy} disabled={buddyLoading}
                      style={{padding:"9px 18px",borderRadius:6,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",opacity:buddyLoading?.6:1}}>
                      {buddyLoading?"...":"search"}
                    </button>
                  </div>

                  {buddyResults.length>0&&(
                    <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
                      {buddyResults.map(u=>(
                        <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0"}}>
                          <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:13,flexShrink:0,overflow:"hidden"}}>
                            {u.avatar_url?<img src={u.avatar_url} style={{width:36,height:36,borderRadius:"50%",objectFit:"cover"}}/>:(u.display_name||u.username||"?")[0].toUpperCase()}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:600,color:d.t}}>{u.display_name||u.username}</div>
                            <div style={{fontSize:11,color:d.t3}}>@{u.username} · {CLASSES.find(c=>c.id===u.je_class)?.label?.replace("CFA ","")||u.je_class||"—"}</div>
                          </div>
                          <button onClick={()=>addBuddy(u)}
                            style={{padding:"6px 14px",borderRadius:6,background:d.a2,color:"#06140f",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                            + add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {buddyResults.length===0&&buddySearch&&!buddyLoading&&(
                    <div style={{fontSize:11,color:d.t3,marginTop:10,fontStyle:"italic"}}>no one found with that username.</div>
                  )}
                </div>

                {/* My buddies */}
                <div style={{fontSize:12,fontWeight:700,color:d.t3,letterSpacing:".08em",textTransform:"uppercase",marginBottom:12}}>
                  Your Study Buddies {myBuddies.length>0&&`(${myBuddies.length})`}
                </div>

                {myBuddies.length===0&&(
                  <div className="card empty">
                    <div style={{fontSize:28,marginBottom:10}}>🤝</div>
                    <div className="et">no study buddies yet</div>
                    <div className="es">search for a friend's username above and add them.</div>
                  </div>
                )}

                {myBuddies.map(b=>{
                  const stats=buddyStats[b.id];
                  const weekHrs=stats?Math.round((stats.weekMins/60)*10)/10:null;
                  const totalHrs=stats?Math.round((stats.totalMins/60)*10)/10:null;
                  const daysSinceLast=stats?.lastDate?daysBetween(stats.lastDate,today()):null;
                  const isActiveToday=stats?.lastDate===today();
                  return(
                    <div key={b.id} className="card" style={{marginBottom:10,padding:"16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12}}>
                        <div style={{width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:16,flexShrink:0,overflow:"hidden",position:"relative"}}>
                          {b.avatar_url?<img src={b.avatar_url} style={{width:44,height:44,borderRadius:"50%",objectFit:"cover"}}/>:(b.display_name||b.username||"?")[0].toUpperCase()}
                          {isActiveToday&&<div style={{position:"absolute",bottom:0,right:0,width:12,height:12,borderRadius:"50%",background:d.a2,border:`2px solid ${d.card}`}}/>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:600,color:d.t}}>{b.display_name||b.username}</div>
                          <div style={{fontSize:11,color:d.t3}}>@{b.username} · {CLASSES.find(c=>c.id===b.je_class)?.label?.replace("CFA ","")||b.je_class||"—"}</div>
                        </div>
                        <button onClick={()=>removeBuddy(b.id)}
                          style={{background:"none",border:"none",color:d.t4,cursor:"pointer",fontSize:16,padding:4}} title="remove">×</button>
                      </div>
                      {stats?(
                        <div style={{display:"flex",gap:8,marginTop:14}}>
                          <div style={{flex:1,textAlign:"center",padding:"10px 6px",background:d.hover,borderRadius:8}}>
                            <div style={{fontSize:16,fontWeight:700,color:d.a1,fontFamily:"'DM Serif Display',serif"}}>{weekHrs}h</div>
                            <div style={{fontSize:8.5,color:d.t3,marginTop:2,textTransform:"uppercase"}}>This Week</div>
                          </div>
                          <div style={{flex:1,textAlign:"center",padding:"10px 6px",background:d.hover,borderRadius:8}}>
                            <div style={{fontSize:16,fontWeight:700,color:d.t2,fontFamily:"'DM Serif Display',serif"}}>{totalHrs}h</div>
                            <div style={{fontSize:8.5,color:d.t3,marginTop:2,textTransform:"uppercase"}}>Total</div>
                          </div>
                          <div style={{flex:1,textAlign:"center",padding:"10px 6px",background:d.hover,borderRadius:8}}>
                            <div style={{fontSize:16,fontWeight:700,color:isActiveToday?d.a2:d.t3,fontFamily:"'DM Serif Display',serif"}}>
                              {isActiveToday?"Today":daysSinceLast!==null?daysSinceLast+"d ago":"—"}
                            </div>
                            <div style={{fontSize:8.5,color:d.t3,marginTop:2,textTransform:"uppercase"}}>Last Studied</div>
                          </div>
                        </div>
                      ):(
                        <div style={{fontSize:11,color:d.t3,marginTop:10,fontStyle:"italic"}}>loading their stats...</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tab==="profile"&&(()=>{
              const saveUsername=async()=>{
                const clean=usernameInput.trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
                if(clean.length<3){setUsernameError("at least 3 characters");return;}
                if(clean.length>20){setUsernameError("max 20 characters");return;}
                setUsernameSaving(true);setUsernameError("");
                try{
                  // Check availability
                  const checkR=await fetch(`${SB_URL}/rest/v1/profiles?username=eq.${clean}&id=neq.${user.id}&select=id`,{
                    headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`}
                  });
                  const existing=await checkR.json();
                  if(existing?.length){setUsernameError("that username is taken");setUsernameSaving(false);return;}
                  await fetch(`${SB_URL}/rest/v1/profiles`,{
                    method:"POST",
                    headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},
                    body:JSON.stringify({id:user.id,username:clean,display_name:user?.name,je_class:jeClass,exam_window:examWindow,is_public:true})
                  });
                  setProfile(p=>({...(p||{}),username:clean}));
                  setEditingUsername(false);
                }catch(e){setUsernameError("couldn't save, try again");}
                setUsernameSaving(false);
              };
              const classBadge=CLASSES.find(c=>c.id===jeClass)?.label||jeClass||"Level not set";
              return(
              <div className="pin">
                {/* Profile card */}
                <div className="card cp" style={{marginBottom:20,textAlign:"center",padding:"28px 24px"}}>
                  <div style={{width:64,height:64,borderRadius:"50%",background:d.a1,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:24,margin:"0 auto 14px",overflow:"hidden"}}>
                    {user?.avatar?<img src={user.avatar} style={{width:64,height:64,borderRadius:"50%",objectFit:"cover"}}/>:(user?.name||"S")[0].toUpperCase()}
                  </div>
                  <div style={{fontSize:18,fontWeight:700,color:d.t,marginBottom:6}}>{user?.name||"Student"}</div>

                  {/* Username — editable like Instagram */}
                  {!editingUsername?(
                    <div onClick={()=>{setUsernameInput(profile?.username||"");setEditingUsername(true);}}
                      style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",marginBottom:4,padding:"3px 10px",borderRadius:6,background:d.hover}}>
                      <span style={{fontSize:13,color:d.t2}}>@{profile?.username||"set a username"}</span>
                      <span style={{fontSize:10,color:d.t4}}>✏️</span>
                    </div>
                  ):(
                    <div style={{maxWidth:240,margin:"0 auto 8px"}}>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{fontSize:13,color:d.t3}}>@</span>
                        <input autoFocus value={usernameInput}
                          onChange={e=>{setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""));setUsernameError("");}}
                          onKeyDown={e=>e.key==="Enter"&&saveUsername()}
                          style={{flex:1,padding:"6px 10px",borderRadius:6,background:d.hover,border:`1px solid ${usernameError?d.danger:d.b}`,color:d.t,fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                      </div>
                      {usernameError&&<div style={{fontSize:10,color:d.danger,marginTop:4}}>{usernameError}</div>}
                      <div style={{display:"flex",gap:6,marginTop:8,justifyContent:"center"}}>
                        <button onClick={saveUsername} disabled={usernameSaving}
                          style={{padding:"6px 14px",borderRadius:6,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",opacity:usernameSaving?.6:1}}>
                          {usernameSaving?"saving...":"save"}
                        </button>
                        <button onClick={()=>{setEditingUsername(false);setUsernameError("");}}
                          style={{padding:"6px 14px",borderRadius:6,background:"none",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
                          cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {profile?.bio&&<div style={{fontSize:12,color:d.t2,marginBottom:12,fontStyle:"italic"}}>{profile.bio}</div>}
                  <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap",marginTop:8}}>
                    <span style={{fontSize:11,padding:"3px 12px",borderRadius:4,background:`${d.a1}12`,border:`1px solid ${d.a1}30`,color:d.a1,fontWeight:600}}>{classBadge}</span>
                    <span style={{fontSize:11,padding:"3px 12px",borderRadius:4,background:d.hover,border:`1px solid ${d.b}`,color:d.t3}}>🔥 {streak}d streak</span>
                    <span style={{fontSize:11,padding:"3px 12px",borderRadius:4,background:d.hover,border:`1px solid ${d.b}`,color:d.t3}}>⏱ {fmt(totalTime)} total</span>
                  </div>
                </div>

                {/* Privacy toggle */}
                <div className="card cp" style={{marginBottom:20,padding:"16px 18px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:d.t,marginBottom:2}}>
                        {profileIsPublic?"🌍 Public Profile":"🔒 Private Profile"}
                      </div>
                      <div style={{fontSize:11,color:d.t3}}>
                        {profileIsPublic?"others can find you by username and add you as a study buddy":"hidden from search — only people who already added you can see your stats"}
                      </div>
                    </div>
                    <button onClick={togglePrivacy} disabled={privacySaving}
                      style={{width:46,height:26,borderRadius:13,border:"none",cursor:"pointer",flexShrink:0,position:"relative",
                        background:profileIsPublic?d.a2:d.b,transition:"background .2s",opacity:privacySaving?.6:1}}>
                      <div style={{width:20,height:20,borderRadius:"50%",background:"#fff",position:"absolute",top:3,
                        left:profileIsPublic?23:3,transition:"left .2s"}}/>
                    </button>
                  </div>
                </div>

                {/* Exam Setup card — editable */}
                <div className="card cp" style={{marginBottom:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div className="cl">Exam Setup</div>
                    <button onClick={()=>{
                        try{localStorage.removeItem("nev_exam_setup_done");}catch(e){}
                        setExamSetupDone(false);
                      }}
                      style={{fontSize:11,color:d.a1,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                      edit →
                    </button>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${d.b}`}}>
                      <span style={{fontSize:12,color:d.t3}}>Target Window</span>
                      <span style={{fontSize:12,fontWeight:600,color:d.t}}>
                        {(CFA_EXAM_WINDOWS[jeClass]||[]).find(w=>w.id===examWindow)?.label||"not set"}
                      </span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${d.b}`}}>
                      <span style={{fontSize:12,color:d.t3}}>Study Days</span>
                      <span style={{fontSize:12,fontWeight:600,color:d.t}}>
                        {studyDays&&studyDays.length?studyDays.map(i=>["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]).join(", "):"not set"}
                      </span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${d.b}`}}>
                      <span style={{fontSize:12,color:d.t3}}>Status</span>
                      <span style={{fontSize:12,fontWeight:600,color:d.t}}>
                        {{student:"Full-time student",working:"Working professional",graduated:"Graduated"}[eduStatus]||"not set"}
                      </span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0"}}>
                      <span style={{fontSize:12,color:d.t3}}>Study Target</span>
                      <span style={{fontSize:12,fontWeight:600,color:d.t}}>{targetHours||CFA_RECOMMENDED_HOURS[jeClass]||300} hours</span>
                    </div>
                  </div>
                </div>

                {/* Weekly leaderboard */}
                <div className="card cp" style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div className="cl">Weekly Leaderboard</div>
                    <div style={{fontSize:10,color:d.t3}}>top 50 · resets Monday</div>
                  </div>
                  {leaderboard.length===0&&<div style={{textAlign:"center",padding:"20px 0",fontSize:12,color:d.t3,fontStyle:"italic"}}>loading leaderboard...</div>}
                  {leaderboard.slice(0,20).map((entry,i)=>{
                    const isMe=entry.id===user?.id;
                    const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
                    return(
                      <div key={entry.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 4px",borderBottom:`1px solid ${d.b}44`,background:isMe?`${d.a1}06`:"transparent"}}>
                        <div style={{width:26,textAlign:"center",fontWeight:700,fontSize:i<3?16:12,color:i<3?d.gold:d.t4,flexShrink:0}}>
                          {medal||`${i+1}`}
                        </div>
                        <div style={{width:32,height:32,borderRadius:"50%",background:d.a3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0,overflow:"hidden"}}>
                          {entry.avatar_url?<img src={entry.avatar_url} style={{width:32,height:32,borderRadius:"50%",objectFit:"cover"}}/>:(entry.display_name||"?")[0].toUpperCase()}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12.5,fontWeight:isMe?700:500,color:isMe?d.a1:d.t,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {entry.display_name||entry.username}{isMe?" (you)":""}
                          </div>
                          <div style={{fontSize:10,color:d.t3}}>@{entry.username} · {CLASSES.find(c=>c.id===entry.je_class)?.label?.replace("CFA ","")||entry.je_class}</div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:d.t}}>{fmt(entry.week_minutes)}</div>
                          <div style={{fontSize:9,color:d.t3}}>this week</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Your stats */}
                <div className="card cp">
                  <div className="cl" style={{marginBottom:14}}>Your Stats</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:10}}>
                    {[
                      {l:"Total Hours",v:fmt(totalTime),c:d.a1},
                      {l:"This Week",v:fmt(weekTime),c:d.a2},
                      {l:"Streak",v:`${streak}d`,c:d.a3},
                      {l:"Study Days",v:new Set(sessions.map(s=>s.date)).size,c:d.gold},
                    ].map(s=>(
                      <div key={s.l} style={{textAlign:"center",padding:"14px 8px",background:d.hover,borderRadius:6,border:`1px solid ${d.b}`}}>
                        <div style={{fontSize:22,fontWeight:700,color:s.c,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{s.v}</div>
                        <div style={{fontSize:9,color:d.t3,marginTop:4,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              );
            })()}

            {/* ── REVISION ── */}
            {tab==="revision"&&(()=>{
              const SUBS=Object.keys(TOPICS).filter(sub=>classTopics(sub).length>0);
              // Build due list
              const allDue=[];
              const allUpcoming=[];
              const allNeverScheduled=[];
              SUBS.forEach(sub=>{
                const chapters=classTopics(sub);
                chapters.forEach(topic=>{
                  const key=sub+"|"+topic;
                  const entry=revisionLog[key];
                  const wt=getWeight(sub,topic,jeClass)||"M";
                  const hrs=sessions.filter(s=>s.subject===sub&&s.topic===topic).reduce((a,s)=>a+(s.duration||0),0);
                  if(!entry){
                    if(hrs>0) allNeverScheduled.push({sub,topic,wt,hrs});
                  } else if(entry.nextRevisions?.length>0){
                    const next=entry.nextRevisions[0];
                    const item={sub,topic,wt,next,entry,hrs};
                    if(isOverdue(next)||isDueToday(next)) allDue.push(item);
                    else if(isDueSoon(next)) allUpcoming.push(item);
                  }
                });
              });
              // Sort overdue by weightage then overdue-ness
              const wtO={"H":0,"M":1,"L":2};
              allDue.sort((a,b)=>wtO[a.wt]-wtO[b.wt]||daysBetween(b.next,today())-daysBetween(a.next,today()));
              allUpcoming.sort((a,b)=>a.next.localeCompare(b.next));
              allNeverScheduled.sort((a,b)=>wtO[a.wt]-wtO[b.wt]||b.hrs-a.hrs);
              const totalDue=allDue.length;
              return(
                <div className="pin">
                  {/* Header stats */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:24}}>
                    {[
                      {l:"Due Today",v:allDue.length,c:allDue.length>0?d.danger:d.a2,hint:allDue.length===0?"you're up to date 🎉":"don't skip these"},
                      {l:"Due Soon",v:allUpcoming.length,c:d.gold,hint:"next 2 days"},
                      {l:"Scheduled",v:Object.keys(revisionLog).length,c:d.a3,hint:"chapters tracked"},
                      {l:"Chapters Studied",v:allNeverScheduled.length+Object.keys(revisionLog).length,c:d.t3,hint:"studied at least once"},
                    ].map(s=>(
                      <div key={s.l} className="card cp" style={{textAlign:"center",padding:"16px 12px"}}>
                        <div style={{fontSize:36,fontWeight:700,fontFamily:"'DM Serif Display',serif",color:s.c,lineHeight:1}}>{s.v}</div>
                        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:d.t3,marginTop:4}}>{s.l}</div>
                        <div style={{fontSize:10,color:d.t4,marginTop:2,fontStyle:"italic"}}>{s.hint}</div>
                      </div>
                    ))}
                  </div>

                  {/* Due now */}
                  {allDue.length>0&&(
                    <div style={{marginBottom:24}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                        <div style={{fontSize:13,fontWeight:700,color:d.danger}}>⚠ Due for Revision</div>
                        <div style={{flex:1,height:1,background:d.b}}/>
                        <div style={{fontSize:10,color:d.t3}}>{allDue.length} chapter{allDue.length!==1?"s":""}</div>
                      </div>
                      {allDue.map(({sub,topic,wt,next,entry,hrs})=>{
                        const overdueDays=daysBetween(next,today());
                        const subColor=SUBJECT_COLORS[sub];
                        const wtColor=wt==="H"?d.danger:wt==="M"?d.gold:d.t4;
                        return(
                          <div key={sub+topic} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",marginBottom:6,background:d.card,border:`1px solid ${d.danger}30`,borderLeft:`3px solid ${d.danger}`,borderRadius:4}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                                <span style={{fontSize:13,fontWeight:600,color:d.t}}>{topic}</span>
                                <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:`${subColor}18`,color:subColor,fontWeight:700}}>{sub}</span>
                                <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:`${wtColor}18`,color:wtColor,fontWeight:700}}>{wt}</span>
                              </div>
                              <div style={{fontSize:11,color:d.t3}}>
                                {overdueDays===0?"due today":overdueDays>0?`${overdueDays}d overdue`:"due today"} · last studied {entry.lastStudied} · {fmt(hrs)} total
                              </div>
                            </div>
                            <button onClick={()=>markRevisionDone(sub,topic)}
                              style={{padding:"7px 14px",borderRadius:4,background:d.a2,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                              ✓ done
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Due soon */}
                  {allUpcoming.length>0&&(
                    <div style={{marginBottom:24}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                        <div style={{fontSize:13,fontWeight:700,color:d.gold}}>⏳ Coming Up</div>
                        <div style={{flex:1,height:1,background:d.b}}/>
                      </div>
                      {allUpcoming.map(({sub,topic,wt,next,hrs})=>{
                        const daysLeft=daysBetween(today(),next);
                        const subColor=SUBJECT_COLORS[sub];
                        return(
                          <div key={sub+topic} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",marginBottom:4,background:d.card,border:`1px solid ${d.b}`,borderLeft:`3px solid ${d.gold}`,borderRadius:4}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                                <span style={{fontSize:12.5,fontWeight:500,color:d.t}}>{topic}</span>
                                <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:`${subColor}18`,color:subColor,fontWeight:700}}>{sub}</span>
                              </div>
                              <div style={{fontSize:10,color:d.t3,marginTop:2}}>in {daysLeft} day{daysLeft!==1?"s":""} · {next}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Never scheduled — chapters studied but not in revision system */}
                  {allNeverScheduled.length>0&&(
                    <div style={{marginBottom:24}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                        <div style={{fontSize:13,fontWeight:700,color:d.t2}}>+ Add to Revision Schedule</div>
                        <div style={{flex:1,height:1,background:d.b}}/>
                        <div style={{fontSize:10,color:d.t3}}>studied but not tracked</div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>
                        {allNeverScheduled.slice(0,12).map(({sub,topic,wt,hrs})=>{
                          const subColor=SUBJECT_COLORS[sub];
                          const wtColor=wt==="H"?d.danger:wt==="M"?d.gold:d.t4;
                          return(
                            <div key={sub+topic} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:d.card,border:`1px solid ${d.b}`,borderRadius:4,cursor:"pointer"}}
                              onClick={()=>markStudied(sub,topic)}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:12,fontWeight:500,color:d.t,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{topic}</div>
                                <div style={{display:"flex",gap:5,marginTop:3}}>
                                  <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:`${subColor}18`,color:subColor,fontWeight:700}}>{sub.slice(0,4)}</span>
                                  <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:`${wtColor}18`,color:wtColor,fontWeight:700}}>{wt}</span>
                                  <span style={{fontSize:9,color:d.t3}}>{fmt(hrs)}</span>
                                </div>
                              </div>
                              <span style={{fontSize:16,color:d.t3}}>+</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {Object.keys(revisionLog).length===0&&allNeverScheduled.length===0&&(
                    <div className="card empty">
                      <div style={{fontSize:28,marginBottom:10}}>↺</div>
                      <div className="et">nothing to revise yet.</div>
                      <div className="es">study a chapter, then add it here. i'll tell you when to review it.</div>
                    </div>
                  )}
                </div>
              );
            })()}


            {/* ── RANK PREDICTOR ── */}
            {tab==="rank"&&(()=>{
              const SUBS=Object.keys(TOPICS);
              const totalChapters=SUBS.reduce((a,sub)=>a+classTopics(sub).length,0);
              const studiedChapters=new Set(sessions.map(s=>s.subject+"|"+s.topic)).size;
              const coveragePct=totalChapters>0?Math.round((studiedChapters/totalChapters)*100):0;
              const avgDailyHrs=sessions.length>0?(totalTime/Math.max(1,new Set(sessions.map(s=>s.date)).size)/60):0;
              const pyqAcc=pyqHistory.length?Math.round(pyqHistory.filter(p=>p.correct).length/pyqHistory.length*100):null;
              const highWtDone=SUBS.reduce((a,sub)=>a+classTopics(sub).filter(t=>getWeight(sub,t,jeClass)==="H"&&sessions.some(s=>s.subject===sub&&s.topic===t)).length,0);
              const highWtTotal=SUBS.reduce((a,sub)=>a+classTopics(sub).filter(t=>getWeight(sub,t,jeClass)==="H").length,0);
              const highWtPct=highWtTotal>0?Math.round((highWtDone/highWtTotal)*100):0;

              // ── Real exam window + pacing ──────────────────────────────────────
              const windowData=(CFA_EXAM_WINDOWS[jeClass]||[]).find(w=>w.id===examWindow);
              const examDate=windowData?windowData.start:null;
              const daysLeft=examDate?Math.max(0,Math.ceil((new Date(examDate)-new Date())/86400000)):null;
              const recommendedHrs=targetHours||CFA_RECOMMENDED_HOURS[jeClass]||300;
              const hoursLoggedSoFar=totalTime/60;
              const hoursRemaining=Math.max(0,recommendedHrs-hoursLoggedSoFar);
              const weeksLeft=daysLeft?Math.max(0.5,daysLeft/7):null;
              const neededWeeklyHrs=weeksLeft?Math.round((hoursRemaining/weeksLeft)*10)/10:null;
              const currentWeeklyHrs=Math.round((weekTime/60)*10)/10;
              const onPace=neededWeeklyHrs!==null?currentWeeklyHrs>=neededWeeklyHrs*0.85:null;
              const hoursPct=Math.min(100,Math.round((hoursLoggedSoFar/recommendedHrs)*100));

              // Score each factor 0-100
              const factors={
                hoursProgress:{score:hoursPct,weight:25,label:"Hours Logged",hint:Math.round(hoursLoggedSoFar)+" / "+recommendedHrs+"h target"},
                coverage:{score:coveragePct,weight:20,label:"Syllabus Coverage",hint:studiedChapters+"/"+totalChapters+" topics"},
                consistency:{score:Math.min(100,Math.round((streak/60)*100)),weight:20,label:"Consistency (Streak)",hint:streak+" day streak"},
                pacing:{score:onPace===null?50:(onPace?100:Math.max(20,Math.round((currentWeeklyHrs/Math.max(neededWeeklyHrs,1))*100))),weight:20,label:"On Pace for Exam",hint:neededWeeklyHrs!==null?currentWeeklyHrs+"h/wk vs "+neededWeeklyHrs+"h/wk needed":"set exam date for pacing"},
                highWeight:{score:highWtPct,weight:15,label:"High-Weight Topics",hint:highWtDone+"/"+highWtTotal+" done"},
              };
              const totalScore=Object.values(factors).reduce((a,f)=>a+(f.score*f.weight/100),0);
              const overallPct=Math.round(totalScore);

              const getRankRange=pct=>{
                if(pct>=85)return{range:"Ready to Pass",color:d.a2,label:"above the minimum passing score"};
                if(pct>=70)return{range:"On Track",color:d.a2,label:"tracking well for exam day"};
                if(pct>=55)return{range:"Getting There",color:d.gold,label:"needs focused effort"};
                if(pct>=40)return{range:"Needs Work",color:d.gold,label:"significant gaps remain"};
                if(pct>=25)return{range:"At Risk",color:d.a1,label:"major revision required"};
                return{range:"Not Ready",color:d.danger,label:"more preparation needed"};
              };
              const rankData=getRankRange(overallPct);

              // What moves the needle most
              const improvements=Object.entries(factors)
                .filter(([,f])=>f.score<80)
                .sort((a,b)=>b[1].weight-a[1].weight)
                .slice(0,3)
                .map(([k,f])=>({
                  key:k, label:f.label,
                  gap:80-f.score,
                  impact:"+"+Math.round((80-f.score)*f.weight/100)+" pts",
                  action:{
                    hoursProgress:"you need roughly "+Math.round(hoursRemaining)+" more hours before "+(windowData?windowData.label:"your exam"),
                    coverage:"study at least 1 new topic every 2-3 days",
                    consistency:"don't break your streak. even 30 min counts",
                    pacing:neededWeeklyHrs?("aim for "+neededWeeklyHrs+"h/week — you're at "+currentWeeklyHrs+"h"):"set your exam window in profile to get a real pacing target",
                    highWeight:"prioritise Ethics, FRA, Equity and Fixed Income — heaviest weighted",
                  }[k]
                }));

              const uniqueDays=new Set(sessions.map(s=>s.date)).size;
              const hasEnoughData=uniqueDays>=7;

              return(
                <div className="pin">
                  {!hasEnoughData&&(
                    <div className="card cp" style={{textAlign:"center",padding:"40px 24px",marginBottom:20}}>
                      <div style={{fontSize:40,marginBottom:16}}>🦥</div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,marginBottom:8}}>readiness score unlocks in {7-uniqueDays} day{7-uniqueDays!==1?"s":""}</div>
                      <div style={{fontSize:13,color:d.t3,marginBottom:20,lineHeight:1.7,maxWidth:320,margin:"0 auto 20px"}}>log study sessions for 7 days and i'll tell you exactly where you stand. showing you 50,000+ on day one helps no one.</div>
                      <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                        {[{l:"Days Logged",v:uniqueDays,t:"/ 7",c:d.a1},{l:"Total Hours",v:fmt(totalTime),t:"",c:d.a2},{l:"Streak",v:streak+"d",t:"",c:d.a3}].map(s=>(
                          <div key={s.l} style={{padding:"14px 18px",borderRadius:6,background:d.hover,border:`1px solid ${d.b}`,textAlign:"center",minWidth:90}}>
                            <div style={{fontSize:22,fontWeight:700,color:s.c,fontFamily:"'DM Serif Display',serif"}}>{s.v}<span style={{fontSize:12,color:d.t3}}>{s.t}</span></div>
                            <div style={{fontSize:10,color:d.t3,marginTop:3,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasEnoughData&&<>

                  {/* Main rank card */}
                  <div className="card cp" style={{textAlign:"center",marginBottom:20,padding:"32px 24px",position:"relative",overflow:"hidden"}}>
                    <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse at 50% 0%,${rankData.color}08,transparent 70%)`,pointerEvents:"none"}}/>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:d.t3,marginBottom:12}}>CFA Exam Readiness</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:52,fontWeight:400,color:rankData.color,lineHeight:1,letterSpacing:"-.02em",marginBottom:8}}>
                      {rankData.range}
                    </div>
                    <div style={{fontSize:13,color:d.t3,marginBottom:20,fontStyle:"italic"}}>{rankData.label} · based on your current trajectory</div>
                    {/* Score ring */}
                    <div style={{display:"inline-flex",alignItems:"center",gap:16,padding:"12px 24px",borderRadius:40,background:d.hover,border:`1px solid ${d.b}`}}>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:28,fontWeight:700,color:rankData.color,fontFamily:"'DM Serif Display',serif"}}>{overallPct}</div>
                        <div style={{fontSize:9,color:d.t3,letterSpacing:".06em",textTransform:"uppercase"}}>Prep Score</div>
                      </div>
                      <div style={{width:1,height:36,background:d.b}}/>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:28,fontWeight:700,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{daysLeft!==null?daysLeft:"—"}</div>
                        <div style={{fontSize:9,color:d.t3,letterSpacing:".06em",textTransform:"uppercase"}}>Days Left</div>
                      </div>
                    </div>
                  </div>

                  {/* Pacing card — shows real exam window data */}
                  {windowData?(
                    <div className="card cp" style={{marginBottom:20}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                        <div className="cl">Your Pace</div>
                        <span style={{fontSize:11,padding:"3px 10px",borderRadius:4,background:onPace?d.a2+"15":d.danger+"15",color:onPace?d.a2:d.danger,fontWeight:700}}>
                          {onPace?"on pace":"behind pace"}
                        </span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:12,marginBottom:14}}>
                        <div style={{textAlign:"center",padding:"12px 8px",background:d.hover,borderRadius:8}}>
                          <div style={{fontSize:18,fontWeight:700,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{windowData.label}</div>
                          <div style={{fontSize:9,color:d.t3,marginTop:3,textTransform:"uppercase",letterSpacing:".05em"}}>Target Window</div>
                        </div>
                        <div style={{textAlign:"center",padding:"12px 8px",background:d.hover,borderRadius:8}}>
                          <div style={{fontSize:18,fontWeight:700,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{currentWeeklyHrs}h</div>
                          <div style={{fontSize:9,color:d.t3,marginTop:3,textTransform:"uppercase",letterSpacing:".05em"}}>This Week</div>
                        </div>
                        <div style={{textAlign:"center",padding:"12px 8px",background:d.hover,borderRadius:8}}>
                          <div style={{fontSize:18,fontWeight:700,color:onPace?d.a2:d.gold,fontFamily:"'DM Serif Display',serif"}}>{neededWeeklyHrs}h</div>
                          <div style={{fontSize:9,color:d.t3,marginTop:3,textTransform:"uppercase",letterSpacing:".05em"}}>Needed/Week</div>
                        </div>
                        <div style={{textAlign:"center",padding:"12px 8px",background:d.hover,borderRadius:8}}>
                          <div style={{fontSize:18,fontWeight:700,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{Math.round(hoursRemaining)}h</div>
                          <div style={{fontSize:9,color:d.t3,marginTop:3,textTransform:"uppercase",letterSpacing:".05em"}}>Hours Left</div>
                        </div>
                      </div>
                      <div style={{fontSize:12,color:d.t3,lineHeight:1.6,fontStyle:"italic"}}>
                        {onPace
                          ?"you're putting in enough hours weekly to hit your "+recommendedHrs+"h target before "+windowData.label+". keep this pace."
                          :"at your current pace you'll fall short of "+recommendedHrs+"h before "+windowData.label+". you need "+neededWeeklyHrs+"h/week, you're averaging "+currentWeeklyHrs+"h."}
                      </div>
                    </div>
                  ):(
                    <div className="card cp" style={{marginBottom:20,textAlign:"center",padding:"20px"}}>
                      <div style={{fontSize:13,color:d.t2,marginBottom:10}}>you haven't set a target exam window yet</div>
                      <button onClick={()=>switchTab("profile")}
                        style={{padding:"8px 18px",borderRadius:6,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                        set exam window in profile
                      </button>
                    </div>
                  )}

                  {/* Factor breakdown */}
                  <div className="card cp" style={{marginBottom:20}}>
                    <div className="cl" style={{marginBottom:16}}>Score Breakdown</div>
                    {Object.entries(factors).map(([key,f])=>(
                      <div key={key} style={{marginBottom:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                          <div>
                            <span style={{fontSize:12.5,fontWeight:500,color:d.t}}>{f.label}</span>
                            <span style={{fontSize:10,color:d.t3,marginLeft:8,fontStyle:"italic"}}>{f.hint}</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:11,color:d.t3}}>{f.weight}% weight</span>
                            <span style={{fontSize:13,fontWeight:700,color:f.score>=70?d.a2:f.score>=50?d.gold:d.danger,minWidth:32,textAlign:"right"}}>{f.score}</span>
                          </div>
                        </div>
                        <div style={{height:6,background:d.b,borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${f.score}%`,background:f.score>=70?d.a2:f.score>=50?d.gold:d.danger,borderRadius:3,transition:"width .6s ease"}}/>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* What moves the needle */}
                  {improvements.length>0&&(
                    <div className="card cp" style={{marginBottom:20}}>
                      <div className="cl" style={{marginBottom:12}}>What Moves Your Rank Most</div>
                      {improvements.map((imp,i)=>(
                        <div key={imp.key} style={{display:"flex",gap:12,padding:"12px 14px",marginBottom:6,borderRadius:4,background:d.hover,border:`1px solid ${d.b}`}}>
                          <div style={{width:24,height:24,borderRadius:"50%",background:`${d.a1}20`,border:`1px solid ${d.a1}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:d.a1,flexShrink:0}}>{i+1}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                              <span style={{fontSize:12,fontWeight:600,color:d.t}}>{imp.label}</span>
                              <span style={{fontSize:11,fontWeight:700,color:d.a2,background:`${d.a2}15`,padding:"1px 7px",borderRadius:3}}>{imp.impact}</span>
                            </div>
                            <div style={{fontSize:11,color:d.t3,lineHeight:1.5}}>{imp.action}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{fontSize:11,color:d.t4,textAlign:"center",fontStyle:"italic",lineHeight:1.6}}>
                    Rank estimate is based on your study patterns, consistency, and coverage relative to CFA passers (top 50%). It updates as you log more sessions.
                  </div>
                  </>}
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
                        <div key={b.days} className={"milestone-row"+reached?" reached":""}>
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
                          return <div key={ds} title={ds+": "+fmt(mins)||"No study"} style={{width:9,height:9,borderRadius:2,background:mins>0?d.a2:d.b,opacity:mins>0?op:.4,border:ds===today()?`1.5px solid ${d.a1}`:"none"}}/>;
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

            {/* ── PLANNER ── */}
            {tab==="planner"&&(()=>{
              if(!roadmap) return(
                <div className="pin">
                  <div style={{textAlign:"center",padding:"60px 24px"}}>
                    <div style={{fontSize:32,marginBottom:12}}>📅</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:d.t,marginBottom:8}}>no roadmap yet</div>
                    <div style={{fontSize:13,color:d.t3,marginBottom:20}}>your exam window isn't set. go to profile → edit exam setup.</div>
                    <button onClick={()=>switchTab("profile")} style={{padding:"10px 22px",borderRadius:8,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700}}>set exam window →</button>
                  </div>
                </div>
              );
              return(
                <div className="pin">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
                    <div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,letterSpacing:"-.02em",marginBottom:4}}>your roadmap</div>
                      <div style={{fontSize:12,color:d.t3}}>{roadmap.totalDays} days · {roadmap.weeks?.length||0} study weeks · last {roadmap.revisionDays} days = revision</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {[
                        {l:"Total Topics",v:roadmap.totalSessions},
                        {l:"Study Days",v:roadmap.studyDates?.length||0},
                        {l:"Per Day",v:roadmap.perDaySessions},
                      ].map(s=>(
                        <div key={s.l} style={{textAlign:"center",padding:"10px 16px",background:d.card,border:`1px solid ${d.b}`,borderRadius:10}}>
                          <div style={{fontSize:18,fontWeight:700,color:d.a1,fontFamily:"'DM Serif Display',serif"}}>{s.v}</div>
                          <div style={{fontSize:9,color:d.t3,textTransform:"uppercase",letterSpacing:".05em",marginTop:2}}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(roadmap.weeks||[]).map(week=>{
                    const weekTopics=[...new Set(week.days.flatMap(dd=>dd.items.map(it=>it.subject)))];
                    const weekDone=week.days.flatMap(dd=>dd.items).filter(it=>roadmapDone[itemKey(week.days[0]?.date||today(),it)]);
                    return(
                      <div key={week.weekNum} style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:14,overflow:"hidden"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:d.hover,borderBottom:`1px solid ${d.b}`,flexWrap:"wrap",gap:8}}>
                          <div style={{fontSize:13,fontWeight:700,color:d.t}}>Week {week.weekNum}</div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {weekTopics.map(s=><span key={s} style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:(SUBJECT_COLORS[s]||d.a1)+"18",color:SUBJECT_COLORS[s]||d.a1,fontWeight:700}}>{s}</span>)}
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:1,background:d.b}}>
                          {week.days.map(dd=>(
                            <div key={dd.date} style={{background:d.card,padding:"10px 10px",minHeight:80}}>
                              <div style={{fontSize:10,fontWeight:700,color:d.t3,marginBottom:6}}>{dayName(dd.date)} <span style={{color:d.t4}}>{dd.date.slice(5)}</span></div>
                              {dd.items.map((item,i)=>{
                                const key=itemKey(dd.date,item);
                                const done=roadmapDone[key];
                                return(
                                  <div key={i} onClick={()=>toggleRoadmapItem(dd.date,item)}
                                    style={{fontSize:10,color:done?d.t4:d.t2,padding:"3px 6px",marginBottom:2,background:done?d.hover:(SUBJECT_COLORS[item.subject]||d.a1)+"10",borderRadius:4,borderLeft:`2px solid ${SUBJECT_COLORS[item.subject]||d.a1}`,cursor:"pointer",lineHeight:1.3,textDecoration:done?"line-through":"none"}}>
                                    {item.topic}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {roadmap.revisionDays>0&&(
                    <div style={{background:d.card,border:`1px solid ${d.gold}40`,borderRadius:12,overflow:"hidden",marginBottom:14}}>
                      <div style={{padding:"12px 16px",background:d.hover,borderBottom:`1px solid ${d.b}`}}>
                        <div style={{fontSize:13,fontWeight:700,color:d.gold}}>Final Revision · last {roadmap.revisionDays} days</div>
                        <div style={{fontSize:11,color:d.t3,marginTop:2}}>starting {roadmap.revisionStart}</div>
                      </div>
                      <div style={{padding:"14px 16px",fontSize:12.5,color:d.t2,lineHeight:1.7}}>
                        every day is free for revision. prioritise Ethics, Fixed Income, Equity and FRA — these carry the most marks. use your syllabus tab to find where you're weakest.
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── ACCOUNTABILITY PARTNER ── */}
            {tab==="partner"&&(()=>{


              async function findPartners(){
                setPartnerLoading(true);
                try{
                  const r=await fetch(`${SB_URL}/rest/v1/profiles?cfa_level=eq.${jeClass}&id=neq.${user?.id}&select=id,username,display_name,avatar_url,cfa_level&limit=20`,
                    {headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token||""}`}});
                  const d2=await r.json();
                  if(Array.isArray(d2))setPartnerResults(d2);
                }catch(e){}
                setPartnerLoading(false);
              }

              return(
                <div className="pin">
                  <div style={{marginBottom:24}}>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,letterSpacing:"-.02em",marginBottom:4}}>accountability partner</div>
                    <div style={{fontSize:13,color:d.t3}}>matched to candidates preparing for {jeClass?`CFA ${jeClass}`:"the same exam"}. two people, one deadline.</div>
                  </div>

                  {!myPartner&&(
                    <div className="card" style={{padding:20,marginBottom:20,textAlign:"center"}}>
                      <div style={{fontSize:28,marginBottom:12}}>🤝</div>
                      <div style={{fontSize:14,fontWeight:600,color:d.t,marginBottom:6}}>find a study partner</div>
                      <div style={{fontSize:12,color:d.t3,marginBottom:16}}>we match you with candidates studying the same level and targeting a similar exam window.</div>
                      <button onClick={findPartners} disabled={partnerLoading}
                        style={{padding:"10px 24px",borderRadius:8,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,opacity:partnerLoading?.6:1}}>
                        {partnerLoading?"searching...":"find partners"}
                      </button>
                    </div>
                  )}

                  {partnerResults.length>0&&(
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:d.t3,letterSpacing:".08em",textTransform:"uppercase",marginBottom:12}}>candidates matching your level</div>
                      {partnerResults.map(p=>(
                        <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:d.card,border:`1px solid ${d.b}`,borderRadius:10,marginBottom:8}}>
                          <div style={{width:40,height:40,borderRadius:12,background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:15,flexShrink:0}}>
                            {(p.display_name||p.username||"?")[0].toUpperCase()}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:d.t}}>{p.display_name||p.username}</div>
                            <div style={{fontSize:11,color:d.t3}}>@{p.username} · CFA {p.cfa_level}</div>
                          </div>
                          <button onClick={()=>setMyPartner(p)}
                            style={{padding:"7px 16px",borderRadius:8,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                            partner up
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {myPartner&&(
                    <div className="card" style={{padding:20}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                        <div style={{width:48,height:48,borderRadius:14,background:`linear-gradient(135deg,${d.a2},${d.a1})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:18}}>
                          {(myPartner.display_name||myPartner.username||"?")[0].toUpperCase()}
                        </div>
                        <div>
                          <div style={{fontSize:14,fontWeight:700,color:d.t}}>{myPartner.display_name||myPartner.username}</div>
                          <div style={{fontSize:11,color:d.a2}}>your accountability partner ✓</div>
                        </div>
                        <button onClick={()=>setMyPartner(null)} style={{marginLeft:"auto",background:"none",border:"none",color:d.t4,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>remove</button>
                      </div>
                      <div style={{fontSize:12.5,color:d.t2,lineHeight:1.7,fontStyle:"italic"}}>
                        check in with your partner regularly. tell them what you studied. ask them what they covered. accountability is 40% of success.
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── WEEKLY REPORT ── */}
            {tab==="report"&&(()=>{
              const thisWeekStart=weekStartOf(today());
              const lastWeekStart=addDays(thisWeekStart,-7);
              const thisWeekSess=sessions.filter(s=>s.date>=thisWeekStart&&s.date<=today());
              const lastWeekSess=sessions.filter(s=>s.date>=lastWeekStart&&s.date<thisWeekStart);
              const thisWeekMins=thisWeekSess.reduce((a,s)=>a+(s.duration||0),0);
              const lastWeekMins=lastWeekSess.reduce((a,s)=>a+(s.duration||0),0);
              const thisWeekHrs=Math.round(thisWeekMins/60*10)/10;
              const lastWeekHrs=Math.round(lastWeekMins/60*10)/10;
              const weeklyTarget=studyDays?.length?(studyDays.length*(targetHours||300)/((roadmap?.totalDays||100)/7)):0;
              const weeklyTargetHrs=Math.round(weeklyTarget/60*10)/10;
              const behindHrs=Math.max(0,Math.round((weeklyTarget-thisWeekMins)/60*10)/10);
              const trend=thisWeekMins>lastWeekMins?"up":thisWeekMins<lastWeekMins?"down":"flat";
              const totalHrsLogged=Math.round(sessions.reduce((a,s)=>a+(s.duration||0),0)/60*10)/10;
              const pct=Math.min(100,Math.round((totalHrsLogged/(targetHours||300))*100));
              const bySubject=Object.keys(TOPICS).map(sub=>{
                const mins=sessions.filter(s=>s.subject===sub).reduce((a,s)=>a+(s.duration||0),0);
                return {sub,mins,hrs:Math.round(mins/60*10)/10};
              }).filter(s=>s.mins>0).sort((a,b)=>b.mins-a.mins);
              const daysLeft=examDate?Math.max(0,Math.ceil((new Date(examDate)-new Date())/86400000)):null;
              const completionDate=examDate&&sessions.length>4?(()=>{
                const avgWeeklyMins=totalHrsLogged*60/(Math.max(1,daysBetween(sessions[0]?.date||today(),today()))/7);
                const minsLeft=Math.max(0,(targetHours||300)*60-totalHrsLogged*60);
                const weeksLeft=avgWeeklyMins>0?minsLeft/avgWeeklyMins:null;
                if(!weeksLeft)return null;
                return addDays(today(),Math.round(weeksLeft*7));
              })():null;
              const finishBeforeExam=completionDate&&examDate?daysBetween(completionDate,examDate):null;

              return(
                <div className="pin">
                  <div style={{marginBottom:20}}>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,letterSpacing:"-.02em",marginBottom:4}}>weekly report</div>
                    <div style={{fontSize:12,color:d.t3}}>week of {thisWeekStart} — generated for you, every Sunday.</div>
                  </div>

                  {/* The headline */}
                  <div style={{padding:"20px 22px",background:d.card,border:`1px solid ${d.b}`,borderRadius:14,marginBottom:16}}>
                    <div style={{fontSize:13,fontWeight:700,color:d.t3,letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>this week</div>
                    <div style={{fontFamily:"'DM Serif Display',serif",fontSize:36,color:trend==="up"?d.a2:trend==="down"?d.danger:d.t,letterSpacing:"-.04em",marginBottom:4}}>{thisWeekHrs}h studied</div>
                    {lastWeekHrs>0&&<div style={{fontSize:12.5,color:d.t3,marginBottom:10}}>
                      {trend==="up"?`↑ up from ${lastWeekHrs}h last week`:trend==="down"?`↓ down from ${lastWeekHrs}h last week`:`same as last week (${lastWeekHrs}h)`}
                    </div>}
                    {behindHrs>0&&<div style={{fontSize:12.5,color:d.gold,fontStyle:"italic"}}>you are {behindHrs}h behind your weekly target of {weeklyTargetHrs}h.</div>}
                    {behindHrs===0&&thisWeekHrs>0&&<div style={{fontSize:12.5,color:d.a2,fontStyle:"italic"}}>you hit your weekly target. good.</div>}
                  </div>

                  {/* Stats grid */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:16}}>
                    {[
                      {l:"Total Hours",v:totalHrsLogged+"h",c:d.a1},
                      {l:"Target",v:(targetHours||300)+"h",c:d.t3},
                      {l:"Completion",v:pct+"%",c:pct>=80?d.a2:pct>=50?d.gold:d.danger},
                      {l:"Days Left",v:daysLeft!==null?daysLeft+"d":"—",c:d.gold},
                    ].map(s=>(
                      <div key={s.l} style={{textAlign:"center",padding:"14px 8px",background:d.card,border:`1px solid ${d.b}`,borderRadius:10}}>
                        <div style={{fontSize:20,fontWeight:700,color:s.c,fontFamily:"'DM Serif Display',serif"}}>{s.v}</div>
                        <div style={{fontSize:9,color:d.t3,marginTop:4,textTransform:"uppercase",letterSpacing:".05em"}}>{s.l}</div>
                      </div>
                    ))}
                  </div>

                  {/* Predicted completion */}
                  {completionDate&&(
                    <div style={{padding:"14px 18px",borderRadius:10,background:finishBeforeExam>0?d.a2+"10":d.danger+"10",border:`1px solid ${finishBeforeExam>0?d.a2:d.danger}30`,marginBottom:16,fontSize:13,lineHeight:1.7,color:d.t2}}>
                      {finishBeforeExam>0
                        ?`at your current pace you'll finish ${finishBeforeExam} days before the exam. that's revision time. keep it up.`
                        :`at your current pace you'll finish ${Math.abs(finishBeforeExam)} days AFTER your exam. you need to pick up the pace.`}
                    </div>
                  )}

                  {/* By subject */}
                  {bySubject.length>0&&(
                    <div style={{padding:"16px 20px",background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:16}}>
                      <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:14}}>Hours by subject</div>
                      {bySubject.map(s=>{
                        const maxHrs=bySubject[0].hrs;
                        const col=SUBJECT_COLORS[s.sub]||d.a1;
                        return(
                          <div key={s.sub} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                              <span style={{fontSize:12,color:d.t}}>{s.sub}</span>
                              <span style={{fontSize:11,fontWeight:600,color:col}}>{s.hrs}h</span>
                            </div>
                            <div style={{height:5,background:d.b,borderRadius:3,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${(s.hrs/maxHrs)*100}%`,background:col,borderRadius:3}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {sessions.length<3&&(
                    <div style={{textAlign:"center",padding:"24px",color:d.t3,fontSize:13,fontStyle:"italic"}}>
                      log at least 3 sessions for a meaningful report.
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        </div>
      </div>
    </>
  );
}

