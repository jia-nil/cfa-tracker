import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

const SB_URL  = import.meta.env.VITE_SUPABASE_URL;
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
    localStorage.removeItem("nev_auth");
  },
  async getUser(accessToken) {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${accessToken}`},
    });
    if(!r.ok) return null;
    return await r.json();
  },
  async loadData(table, userId, accessToken) {
    try{
      const r = await fetch(
        `${SB_URL}/rest/v1/${table}?user_id=eq.${userId}&select=*&order=created_at.asc`,
        {headers:{"apikey":SB_ANON,"Authorization":`Bearer ${accessToken}`}}
      );
      if(!r.ok) return null; // null = fetch failed, distinct from a genuinely empty [] result
      return await r.json();
    }catch(e){
      return null;
    }
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
// Single source of truth for "how much time is actually committed per day". Rounds UP to the
// nearest 30 min (1.4h -> 1.5h) so a fractional target is never silently under-delivered — used
// by the scheduler (generateRoadmap/packSessionsIntoDates) AND every place that displays the
// daily commitment (onboarding, today's target), so the number shown always matches what
// actually gets scheduled instead of the two drifting apart.
const roundedDailyMins=h=>Math.max(30,Math.ceil(((h||2)*60)/30)*30);
const roundedDailyHours=h=>roundedDailyMins(h)/60;
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const dayName=dateStr=>new Date(dateStr+'T00:00:00').toLocaleDateString('en-US',{weekday:'short'});;
function addDays(dateStr,n){const d=new Date(dateStr+'T00:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function daysBetween(a,b){return Math.round((new Date(b)-new Date(a))/86400000);}
function isOverdue(dateStr){return dateStr<today();}
function isDueToday(dateStr){return dateStr===today();}
function isDueSoon(dateStr){const d=daysBetween(today(),dateStr);return d>=0&&d<=2;}
function calcStreak(sessions){
  const days=[...new Set(sessions.map(s=>typeof s==="string"?s:s.date))].sort().reverse();
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
// Packs a pool of {durationMins,...} session blocks into a list of dates, filling each date up
// to its real time budget (hours/day) instead of a flat item-count cap. This is what makes a
// heavy topic correctly spread across multiple days instead of being crammed into one.
//
// No hard "max N topics if under X hours" rule — that was too rigid and had a real bug: because
// sessionPool interleaves subjects (one block per subject per round, for spaced variety across
// the whole plan), a fixed cap could get "stuck" — e.g. a 1.5h day hits its 2-topic cap after only
// 1h, and the next pool item is always a 3rd new topic that keeps getting deferred forever, so the
// day shows 1h scheduled instead of the full 1.5h.
//
// Instead: for each day, keep pulling from the pool until the budget is full. Prefer the next
// block of a topic ALREADY started today over a brand-new topic. This naturally keeps most days
// on one or two topics (few topics have enough remaining blocks to need more), guarantees the
// full daily budget always gets used, and needs no hardcoded thresholds.
function packSessionsIntoDates(sessionPool,dates,dailyHours){
  // Same rounding as the session-sizing step (shared roundedDailyMins helper): commit to the
  // daily target rounded UP to the nearest half hour, so this budget always lines up exactly
  // with SESSION_BLOCK_MINS (30 or 60) and every day fills to the same, predictable total with
  // nothing left over.
  const dailyBudgetMins=roundedDailyMins(dailyHours);
  // Cap how long any ONE topic can run continuously within a single day. Without this, a big
  // daily budget (e.g. 5h/day) collapses into "one topic, all 5 hours" whenever that topic has
  // enough remaining passes to cover it — which is worse for retention than mixing topics. 120
  // min is the top of the focused-session sweet spot (roughly 1-2h per topic per day); small
  // daily budgets (<=120min) never hit this cap anyway, so short-day behaviour is unchanged.
  const MAX_TOPIC_MINS_PER_DAY=120;
  const assignments=dates.map(dt=>({date:dt,items:[],usedMins:0,topicMins:new Map()}));
  if(assignments.length===0) return assignments;
  const pool=sessionPool.slice(); // mutable working copy; we splice items out as they're placed
  for(const slot of assignments){
    if(pool.length===0) break;
    while(pool.length>0){
      // Prefer continuing a topic already started today — but only while it's under today's
      // per-topic cap. Once a topic hits the cap it's excluded from BOTH branches below, so a
      // maxed-out topic can no longer be re-picked today even as a "new" pick, and the pack
      // naturally rotates on to a different topic instead.
      let idx=pool.findIndex(it=>{
        const used=slot.topicMins.get(it.subject+"|"+it.topic);
        return used!=null&&used<MAX_TOPIC_MINS_PER_DAY;
      });
      if(idx===-1){
        idx=pool.findIndex(it=>{
          const used=slot.topicMins.get(it.subject+"|"+it.topic);
          return used==null||used<MAX_TOPIC_MINS_PER_DAY;
        });
      }
      if(idx===-1) break; // everything left in the pool is capped for today — move to next day
      const item=pool[idx];
      const fitsBudget=slot.usedMins+item.durationMins<=dailyBudgetMins||slot.items.length===0;
      if(!fitsBudget) break; // day is full (or already holds one oversized item) — move to next day
      slot.items.push(item);
      slot.usedMins+=item.durationMins;
      const k=item.subject+"|"+item.topic;
      slot.topicMins.set(k,(slot.topicMins.get(k)||0)+item.durationMins);
      pool.splice(idx,1);
    }
  }
  // Genuine shortfall: more content than the study window can hold even at full capacity every
  // single day. The daily-hours budget is a hard ceiling the user explicitly set — we do NOT dump
  // the remainder onto days regardless of budget (that used to produce a "0.5h/day" plan showing
  // 7h on a single day). Instead the overflow is simply left unscheduled; sessionPool is ordered
  // highest-priority-first (H-weight topics, earlier passes), so what gets dropped is the lowest-
  // priority tail. The caller surfaces this as `droppedSessions` so the UI can warn the user their
  // timeline doesn't fit even the leaner plan, rather than silently overloading random days.
  assignments.unscheduledCount=pool.length;
  return assignments;
}
function generateRoadmap({level,examDate,studyDays,answers,startDate,remainingTopics,performance,dailyHours,focusMode}){
  // performance: live signal computed from actual mock scores / PYQ accuracy / syllabus status —
  // {weakSubjects:Set<subject>, weakTopics:Set<"sub|topic">, strongTopics:Set<"sub|topic">, doneTopics:Set<"sub|topic">}
  // This is what makes the plan personalised instead of one-size-fits-all: two students on the
  // same level get different pass-counts per topic based on how THEY are actually performing.
  let topics=remainingTopics||allTopicsForLevel(level);
  if(topics.length===0||!examDate) return {weeks:[],totalDays:0};
  // "important" focus mode: the user told us during onboarding they can't commit the hours
  // actually required to cover the full syllabus, so scope down to H/M-weight (highest-yield)
  // topics only instead of silently overflowing or cramming everything in regardless of fit.
  if(focusMode==="important"){
    topics=topics.filter(t=>t.weight==="H"||t.weight==="M");
  }
  // Filter out topics user already completed in questionnaire (only on first generation)
  if(!remainingTopics&&answers&&!answers.skipped&&answers.completedTopics){
    topics=topics.filter(t=>!answers.completedTopics[t.subject+"|"+t.topic]);
  }
  // Drop topics that are BOTH marked done AND confirmed strong (good PYQ/mock signal) — fully
  // mastered content should stop eating roadmap slots. Just "done" alone (untested) keeps one
  // light consolidation pass rather than vanishing.
  if(!remainingTopics&&performance?.doneTopics){
    topics=topics.filter(t=>{
      const key=t.subject+"|"+t.topic;
      return !(performance.doneTopics.has(key)&&performance.strongTopics?.has(key));
    });
  }
  const weakSet=new Set([...(answers?.weakAreas||[]),...(performance?.weakSubjects||[])]);
  const weakTopicSet=performance?.weakTopics||new Set();
  const strongTopicSet=performance?.strongTopics||new Set();
  const doneTopicSet=performance?.doneTopics||new Set();
  const from=startDate||today();
  const totalDaysToExam=Math.max(1,daysBetween(from,examDate));
  const studyDates=[];
  for(let i=0;i<totalDaysToExam;i++){
    const dt=addDays(from,i);
    if((studyDays||[]).includes(weekdayIndex(dt))) studyDates.push(dt);
  }
  if(studyDates.length===0) return {weeks:[],totalDays:totalDaysToExam,noStudyDays:true};

  // ── Time-based session sizing ──────────────────────────────────────────
  // Each topic's session count is now derived from real study-hour budgets — a topic's fair
  // share of its SUBJECT's candidate-survey hour range (not just exam weight %), split
  // proportionally by weight among that subject's topics, then chunked into 60-min focus
  // blocks. This replaces the old flat "H=3 passes, M=2, L=1" scheme, which had no connection
  // to how long a topic actually takes (e.g. Fin. Reporting alone realistically needs 50-70
  // hours — that can't be represented as "3 sessions").
  // Block size adapts to the user's actual daily budget — a 0.5h/day plan should chunk work
  // into 30-min sessions, not force a full 60-min block onto a day that only has 30 min in it
  // (which used to silently blow the daily budget on the very first item every day, and made
  // topics rack up passes far faster than the user's real pace).
  // Round the daily commitment UP to the nearest half hour (1.4h/day -> a real 90min/day, not a
  // silently-capped 60min/day) so the plan never quietly under-schedules a fractional target.
  // Any resulting slight overshoot in pace just means the syllabus finishes a little early,
  // leaving genuine rest days before the exam — the safe direction to round, vs. permanently
  // losing the same chunk of time every day forever (which is what put a real user 60h behind).
  const dailyCommitMins=roundedDailyMins(dailyHours);
  // Block size must divide evenly into the rounded daily commitment so every day hits that exact
  // total with a consistent, predictable shape — no "1h some days, 2h other days" variability,
  // no leftover minutes to lose. Use clean 60-min sessions when the day is a whole number of
  // hours (2h/day -> two 60-min sessions); otherwise drop to clean 30-min sessions so the day's
  // total still lands exactly on target (1.5h/day -> three 30-min sessions, not one lossy 60-min
  // one with 30min quietly dropped).
  const SESSION_BLOCK_MINS=(dailyCommitMins%60===0)?60:30;
  const weightPoints={H:3,M:2,L:1};
  let sessionPool;
  if(remainingTopics){
    // Redistribution (backlog catch-up / windowed rebalance): these are already fully-formed
    // session instances from the original generation — just repack them into new dates,
    // don't recompute pass numbers or they'll no longer correctly reflect "is this the last
    // pass of this topic", which is what marks a topic done in the syllabus.
    sessionPool=topics;
  }else{
    const bySubject={};
    topics.forEach(t=>{
      if(!bySubject[t.subject]) bySubject[t.subject]=[];
      bySubject[t.subject].push(t);
    });
    const subjectPools={};
    Object.entries(bySubject).forEach(([subject,subTopics])=>{
      let subjectHours=subjectHoursFor(level,subject);
      if(weakSet.has(subject)) subjectHours*=1.2; // weak subject — budget more time
      const totalPoints=subTopics.reduce((a,t)=>a+(weightPoints[t.weight]||1),0)||1;
      subjectPools[subject]=[];
      subTopics.forEach(t=>{
        const key=t.subject+"|"+t.topic;
        let topicHours=subjectHours*((weightPoints[t.weight]||1)/totalPoints);
        if(weakTopicSet.has(key)) topicHours*=1.3;
        if(strongTopicSet.has(key)) topicHours*=0.5;
        else if(doneTopicSet.has(key)) topicHours*=0.6;
        const blocks=Math.max(1,Math.round((topicHours*60)/SESSION_BLOCK_MINS));
        // Denominator shown to the user MUST equal what's actually scheduled (blocks*durationMins),
        // not a separately-rounded estimate of the raw topicHours — otherwise the two numbers answer
        // different questions and the "X of Y" fraction can never reach its own total (e.g. raw
        // topicHours=8.7 rounds to a "9h" label but only 8.5h of 30-min blocks actually get
        // scheduled, so the last session reads "8.5 of 9" and never catches up).
        const scheduledTopicHours=Math.round((blocks*SESSION_BLOCK_MINS/60)*10)/10;
        for(let p=0;p<blocks;p++){
          subjectPools[subject].push({...t,pass:p+1,totalPasses:blocks,durationMins:SESSION_BLOCK_MINS,topicHours:scheduledTopicHours});
        }
      });
    });
    // Interleave across subjects (one block per subject per round) instead of one giant block per
    // subject — spaced/interleaved practice beats grinding one subject for weeks straight.
    sessionPool=[];
    const subjectNames=Object.keys(subjectPools);
    let anyLeft=true;
    while(anyLeft){
      anyLeft=false;
      subjectNames.forEach(subject=>{
        if(subjectPools[subject].length>0){
          sessionPool.push(subjectPools[subject].shift());
          anyLeft=true;
        }
      });
    }
  }

  // ── Time-based day packing ────────────────────────────────────────────
  // Pack blocks into each study day up to that day's actual time budget (hours/day from
  // onboarding), instead of a flat item-count cap — this is what makes heavy topics correctly
  // spread across MULTIPLE days rather than being impossibly crammed into one.
  const assignments=packSessionsIntoDates(sessionPool,studyDates,dailyHours);
  const weeksMap={};
  const calendarWeekStart=weekStartOf(from); // the Monday of the week the plan starts in
  assignments.forEach(a=>{
    const wIdx=Math.floor(daysBetween(calendarWeekStart,a.date)/7);
    if(!weeksMap[wIdx]) weeksMap[wIdx]=[];
    weeksMap[wIdx].push(a);
  });
  const weeks=Object.keys(weeksMap).sort((a,b)=>a-b).map(k=>({weekNum:parseInt(k)+1,days:weeksMap[k]}));
  const revisionTopics=topics.filter(t=>t.weight==="H"||t.weight==="M");
  const scheduledCount=sessionPool.length-(assignments.unscheduledCount||0);
  const perDaySessions=Math.max(1,Math.round(scheduledCount/studyDates.length));
  // Only count what actually made it onto the calendar — a session that got dropped for lack of
  // room shouldn't inflate the "planned hours" total shown to the user.
  const scheduledMins=assignments.reduce((a,day)=>a+day.items.reduce((b,it)=>b+(it.durationMins||0),0),0);
  const totalPlannedHours=Math.round(scheduledMins/6)/10;
  const droppedSessions=assignments.unscheduledCount||0;
  const droppedHours=droppedSessions>0?Math.round(sessionPool.slice(scheduledCount).reduce((a,s)=>a+(s.durationMins||0),0)/6)/10:0;
  // Trailing empty study days = genuine revision time. Rounding the daily commitment UP (see
  // roundedDailyMins) means the fixed pool of topic-hours now gets consumed a bit faster than
  // the raw pace, so it's normal and expected for the syllabus to run out before the exam date —
  // those leftover days are real, earned revision/rest time, not a scheduling gap, so tag them
  // rather than leaving them as blank, unlabeled cells.
  let revisionDays=0;
  for(let i=assignments.length-1;i>=0;i--){
    if(assignments[i].items.length===0) revisionDays++;
    else break;
  }
  const revisionStart=revisionDays>0?assignments[assignments.length-revisionDays].date:null;
  // Mark every assignment so the calendar grid can label empty cells without recomputing this
  // itself: "revision" for the trailing block (syllabus finished, time to review), "rest" for
  // any rarer empty day earlier in the plan (e.g. a day every topic conflict skipped).
  assignments.forEach(a=>{
    if(a.items.length===0) a.dayType=(revisionStart&&a.date>=revisionStart)?"revision":"rest";
  });
  return {weeks,totalDays:totalDaysToExam,studyDates,revisionTopics,totalSessions:scheduledCount,perDaySessions,totalPlannedHours,droppedSessions,droppedHours,revisionDays,revisionStart};
}
function itemKey(date,item){return date+"|"+item.subject+"|"+item.topic+"|"+item.pass;}

// Adaptive roadmap: figure out what's overdue and redistribute forward
function computeAdaptiveRoadmap({roadmap,roadmapDone,level,examDate,studyDays,answers}){
  if(!roadmap||!examDate)return null;
  // Find all items that were scheduled for past dates but NOT marked done
  const overdue=[];
  const seenTopics=new Set(); // avoid duplicating topics
  (roadmap.weeks||[]).forEach(w=>{
    w.days.forEach(dd=>{
      if(dd.date<today()){
        dd.items.forEach(item=>{
          const key=itemKey(dd.date,item);
          if(!roadmapDone[key]){
            const topicKey=item.subject+"|"+item.topic+"|"+item.pass;
            if(!seenTopics.has(topicKey)){
              seenTopics.add(topicKey);
              overdue.push({...item,_wasScheduled:dd.date});
            }
          }
        });
      }
    });
  });

  // Future items already scheduled (don't duplicate them)
  const futureScheduled=new Set();
  (roadmap.weeks||[]).forEach(w=>{
    w.days.forEach(dd=>{
      if(dd.date>=today()){
        dd.items.forEach(item=>{
          futureScheduled.add(item.subject+"|"+item.topic+"|"+item.pass);
        });
      }
    });
  });

  // Only redistribute overdue items NOT already in future schedule
  const toRedistribute=overdue.filter(item=>{
    return !futureScheduled.has(item.subject+"|"+item.topic+"|"+item.pass);
  });

  if(toRedistribute.length===0)return {roadmap,overdueCount:0,redistributed:0};

  // Generate new roadmap from today with the remaining topics prepended
  const futureItems=(roadmap.weeks||[]).flatMap(w=>w.days)
    .filter(dd=>dd.date>=today())
    .flatMap(dd=>dd.items);

  // Merge: overdue first (highest priority), then future
  const allRemaining=[...toRedistribute,...futureItems];
  const newRoadmap=generateRoadmap({
    level,examDate,studyDays,answers,
    startDate:today(),
    remainingTopics:allRemaining,
  });

  return{roadmap:newRoadmap,overdueCount:overdue.length,redistributed:toRedistribute.length};
}

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

// ── Manually add a topic to today's roadmap ────────────────────────────────
function ManualTopicAdder({d,jeClass,onAdd}){
  const [open,setOpen]=useState(false);
  const [sub,setSub]=useState("");
  const [topic,setTopic]=useState("");
  const SUBS=Object.keys(TOPICS).filter(s=>(TOPICS[s][jeClass]||[]).length>0);
  const topics=sub?(TOPICS[sub][jeClass]||[]):[];
  if(!open) return(
    <button onClick={()=>setOpen(true)}
      style={{width:"100%",padding:"11px",borderRadius:10,background:"transparent",border:`1.5px dashed ${d.b}`,color:d.t3,cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",marginTop:4}}>
      + add a topic manually
    </button>
  );
  return(
    <div style={{padding:"12px 14px",background:d.card,border:`1px solid ${d.b}`,borderRadius:10,marginTop:4,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <Select d={d} value={sub} onChange={v=>{setSub(v);setTopic("");}} placeholder="subject" options={SUBS.map(s=>({value:s,label:s}))}/>
      <Select d={d} value={topic} onChange={setTopic} placeholder="topic" disabled={!sub} options={topics.map(t=>({value:t,label:t}))}/>
      <button disabled={!sub||!topic} onClick={()=>{onAdd(sub,topic);setSub("");setTopic("");setOpen(false);}}
        style={{padding:"7px 14px",borderRadius:7,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",opacity:!sub||!topic?.4:1}}>
        add
      </button>
      <button onClick={()=>setOpen(false)}
        style={{padding:"7px 12px",borderRadius:7,background:"transparent",border:`1px solid ${d.b}`,color:d.t3,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
        cancel
      </button>
    </div>
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
const CFA_RECOMMENDED_HOURS = {L1:300, L2:300, L3:300}; // per CFA Institute's own guidance: "successful candidates report spending over 300 hours on average preparing for each level" (cfainstitute.org)

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

// Real candidate-reported study-hour ranges per subject — exam WEIGHT (% of questions) and
// STUDY TIME needed are not the same thing (e.g. Fin. Reporting is only 13-17% of the L1 exam
// but eats 50-70 hours because of its sheer volume/complexity). This is what the roadmap's pass
// counts were missing entirely — a topic's session count now reflects real hours needed, not
// just a flat H/M/L multiplier. Midpoints of each range are used as the working budget.
// Subject-level hour budgets for L1, scaled so they sum to the 300h target (CFA Institute's
// published guidance) while preserving the same relative split between subjects.
const SUBJECT_HOURS = {
  L1: {
    "Fin. Reporting":50, "Fixed Income":43.75, Equity:39.6, Quantitative:37.5,
    Ethics:33.3, "Corp. Issuers":25, "Portfolio Mgmt":20.85, Economics:20.85,
    "Alt. Investments":14.6, Derivatives:14.6,
  },
};
// L2/L3 don't have the same precise candidate-survey hour breakdowns available, so approximate
// using that level's official exam-weight midpoint applied to its total recommended hours.
function subjectHoursFor(level,subject){
  if(SUBJECT_HOURS[level]?.[subject]!=null) return SUBJECT_HOURS[level][subject];
  const range=TOPIC_WEIGHT_RANGES[subject]?.[level];
  const total=CFA_RECOMMENDED_HOURS[level]||300;
  if(!range||range==="0%") return total*0.03; // negligible/retired-at-this-level subject
  const nums=range.replace(/%/g,"").split("-").map(Number);
  const mid=((nums[0]||0)+(nums[1]??nums[0]??0))/2/100;
  return Math.round(total*mid);
}

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
  {id:"help",label:"Help & Feedback",icon:"💬"},
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

  // Google sign-in redirects back here with ?error=...&error_code=...&error_description=...
  // when Supabase's OAuth flow fails (most commonly bad_oauth_state — the state cookie
  // wasn't there when Google called back, usually from third-party-cookie blocking, an
  // in-app browser like Instagram/Twitter's, or waiting too long on Google's consent screen).
  // Left unhandled this just sits there as raw query params with no explanation, so surface
  // it as a normal, retryable error instead.
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const errCode=params.get("error_code");
    if(!errCode)return;
    window.history.replaceState(null,"",window.location.pathname);
    if(errCode==="bad_oauth_state"){
      setError("that sign-in link expired or your browser blocked it — try continue with Google again. (if you're in an app like Instagram or Twitter, open this in Chrome/Safari first.)");
    }else{
      setError(params.get("error_description")?.replace(/\+/g," ")||"sign-in didn't go through — please try again.");
    }
  },[]);

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
      localStorage.setItem("nev_auth", JSON.stringify(stored));
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
      background:"#09212D", display:"flex", alignItems:"center",
      justifyContent:"center", padding:"20px 16px", boxSizing:"border-box",
      fontFamily:"'DM Sans',sans-serif", overflowY:"auto",
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
      <div style={{width:"100%", maxWidth:380, margin:"auto"}}>
        <div style={{textAlign:"center", marginBottom:32}}>
          <img src="/logo.png" alt="Nevilete" style={{width:64,height:64,borderRadius:16,marginBottom:10,objectFit:"cover"}}/>
          <div style={{fontSize:26, fontWeight:900, letterSpacing:"-.06em", color:"#F2E6BF", fontFamily:"'DM Serif Display',serif"}}>
            nevile<span style={{color:"#5AA3AD"}}>te</span>
          </div>
          <div style={{fontSize:12, color:"#7A93A0", marginTop:4}}>your CFA exam co-pilot.</div>
        </div>
        <button onClick={()=>window.location.href=`${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.origin)}`}
          style={{width:"100%", padding:"12px", borderRadius:8, background:"#fff", color:"#132A36",
            border:"none", fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:14,
            display:"flex", alignItems:"center", justifyContent:"center", gap:10,
            fontFamily:"inherit", boxSizing:"border-box"}}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/></svg>
          continue with Google
        </button>
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:14}}>
          <div style={{flex:1, height:1, background:"rgba(255,255,255,.08)"}}/>
          <span style={{fontSize:11, color:"#4E6975"}}>or</span>
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
        {error&&<div style={{fontSize:12, color:error.includes("created")?"#4d9e78":"#e08a6a",
          marginBottom:12, textAlign:"center", lineHeight:1.5}}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading}
          style={{width:"100%", padding:"12px", borderRadius:8, background:"#5AA3AD",
            color:"#09212D", border:"none", fontSize:14, fontWeight:700,
            cursor:loading?"not-allowed":"pointer", opacity:loading?.6:1,
            fontFamily:"inherit", boxSizing:"border-box"}}>
          {loading?"...":(mode==="login"?"log in":"sign up")}
        </button>
        <div style={{textAlign:"center", marginTop:14, fontSize:12, color:"#7A93A0"}}>
          {mode==="login"?"no account? ":"have one? "}
          <span style={{color:"#5AA3AD", cursor:"pointer"}}
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
c.push(".layout{display:block;min-height:100vh;min-height:100dvh;width:100%;background:"+d.bg+";}");
c.push(".sidebar{width:"+SW+"px;min-height:100vh;min-height:100dvh;background:"+d.sb+";border-right:1px solid "+d.b+";position:fixed;top:0;left:0;display:flex;flex-direction:column;z-index:50;overflow:hidden;transition:transform .28s cubic-bezier(.16,1,.3,1),width .28s cubic-bezier(.16,1,.3,1);}");
c.push(".content{margin-left:"+SW+"px;min-height:100vh;min-height:100dvh;overflow-x:hidden;box-sizing:border-box;width:calc(100vw - "+SW+"px);}");
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
c.push(".stopic{font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.snotes{font-size:11px;color:"+d.t3+";flex:1.5;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}");
c.push(".sdur{font-size:10.5px;color:"+d.t3+";background:"+d.hover+";padding:2px 8px;border-radius:20px;flex-shrink:0;border:1px solid "+d.b+";}.sdate{font-size:10px;color:"+d.t4+";flex-shrink:0;}");
c.push("@media(max-width:600px){.snotes,.sdate{display:none;}.ssub{width:50px;font-size:9px;}}");

// ── Mobile overflow fixes ────────────────────────────────────────────────
// The classic cause of "have to scroll left-right" in a flex/grid-heavy app: grid and flex
// children default to min-width:auto, meaning their CONTENT's natural width (long numbers,
// unbroken labels) can silently force the row wider than its container, even though ancestors
// like .inner already have overflow-x:hidden — that only clips it after the fact, it doesn't
// stop the layout from being pushed wide in the first place on some browsers/situations.
c.push(".g2>*,.g3>*,.g4>*,.rowb>*,.row>*,.coach-grid>*{min-width:0;}");
c.push("table{max-width:100%;}");
c.push("img,svg{max-width:100%;height:auto;}");
c.push("@media(max-width:480px){"+
  ".fs-ring-wrap{width:min(78vw,260px);height:min(78vw,260px);}"+
  ".fs-time{font-size:clamp(40px,13vw,72px);}"+
  ".fs-topic{font-size:12px;}"+
  ".fs-actions{flex-wrap:wrap;justify-content:center;}"+
  ".fs-btn{padding:11px 18px;font-size:12px;}"+
  ".ring-wrap{width:min(50vw,160px);height:min(50vw,160px);}"+
  ".ring-time{font-size:clamp(22px,7vw,36px);}"+
  ".streak-num{font-size:clamp(36px,12vw,54px);}"+
  ".stat-num{font-size:clamp(20px,6vw,30px)!important;}"+
"}");
return c.join("\n");
}

// ── ExamSetupScreen — fully self-contained 4-step setup ──────────────────────
function ExamSetupScreen({d,initialLevel,onComplete,existingUsername,user,authSession,SB_URL,SB_ANON}){
  const [step,setStep]=useState(()=>{
    if(existingUsername) return initialLevel?3:2;
    return 1;
  });
  const [level,setLevel]=useState(initialLevel||null);
  const [examWindow,setExamWindow]=useState(null);
  const [studyDays,setStudyDays]=useState([0,1,2,3,4]);
  const [dailyHours,setDailyHours]=useState(2);
  const [commitStep,setCommitStep]=useState(0); // 0=pick days, 1=calculated commitment, 2=reduced-scope hours picker
  const [username,setUsername]=useState(existingUsername||"");
  const [usernameError,setUsernameError]=useState("");
  const [usernameSaving,setUsernameSaving]=useState(false);
  const DAY_NAMES=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const windows=(CFA_EXAM_WINDOWS[level]||[]).filter(w=>new Date(w.start)>new Date());
  const recommended=(level&&CFA_RECOMMENDED_HOURS[level])||300;
  const classLabel=(level&&CLASSES.find(c=>c.id===level)?.label)||"";
  function toggleDay(i){setStudyDays(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i].sort());}
  const card={display:"flex",alignItems:"center",gap:12,padding:"14px 16px",border:"1.5px solid "+d.b,borderRadius:12,cursor:"pointer",marginBottom:8,background:d.card,transition:"all .15s"};
  const totalSteps=4;
  async function continueFromUsername(){
    const clean=username.trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
    if(clean.length<3){setUsernameError("at least 3 characters");return;}
    if(clean.length>20){setUsernameError("max 20 characters");return;}
    setUsernameSaving(true);setUsernameError("");
    try{
      if(SB_URL&&user?.id){
        const checkR=await fetch(`${SB_URL}/rest/v1/profiles?username=eq.${clean}&id=neq.${user.id}&select=id`,{
          headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token||""}`}
        });
        if(checkR.ok){
          const existing=await checkR.json();
          if(Array.isArray(existing)&&existing.length){setUsernameError("that username is taken");setUsernameSaving(false);return;}
        }
        await fetch(`${SB_URL}/rest/v1/profiles`,{
          method:"POST",
          headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token||""}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},
          body:JSON.stringify({id:user.id,username:clean,display_name:user?.name,is_public:true})
        }).catch(()=>{});
      }
      setUsername(clean);
      setUsernameSaving(false);
      setStep(2);
    }catch(e){setUsernameError("couldn't save — try again");setUsernameSaving(false);}
  }
  return(
    <div style={{position:"fixed",inset:0,zIndex:9999,background:d.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px",boxSizing:"border-box",overflowY:"auto",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');"}</style>
      <div style={{width:"100%",maxWidth:420,margin:"auto"}}>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,letterSpacing:"-.04em",marginBottom:4}}>nevile<span style={{color:d.a1}}>te</span></div>
        <div style={{fontSize:12,color:d.t3,marginBottom:20}}>step {step} of {totalSteps}</div>
        <div style={{display:"flex",gap:4,marginBottom:28}}>
          {[1,2,3,4].map(s=><div key={s} style={{height:3,flex:1,borderRadius:2,background:s<=step?d.a1:d.b,transition:"background .2s"}}/>)}
        </div>

        {/* Step 1 — Username */}
        {step===1&&(
          <div>
            <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>what should we call you?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:22}}>this is how study buddies and the leaderboard will see you. lowercase letters, numbers, underscores only.</div>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:14,color:d.t3}}>@</span>
              <input autoFocus value={username}
                onChange={e=>{setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""));setUsernameError("");}}
                onKeyDown={e=>e.key==="Enter"&&continueFromUsername()}
                placeholder="yourname"
                style={{flex:1,padding:"12px 14px",borderRadius:10,background:d.card,border:`1.5px solid ${usernameError?d.danger:d.b}`,color:d.t,fontSize:15,fontFamily:"inherit",outline:"none"}}/>
            </div>
            {usernameError&&<div style={{fontSize:11,color:d.danger,marginBottom:14}}>{usernameError}</div>}
            <button disabled={username.trim().length<3||usernameSaving} onClick={continueFromUsername}
              style={{width:"100%",padding:"13px",borderRadius:12,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",opacity:username.trim().length<3||usernameSaving?0.4:1,marginTop:14}}>
              {usernameSaving?"checking...":"continue →"}
            </button>
          </div>
        )}

        {/* Step 2 — Level */}
        {step===2&&(
          <div>
            <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>which level are you taking?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:22}}>your roadmap is built around this level's real curriculum and weighting.</div>
            {CLASSES.map(c=>(
              <div key={c.id} style={card}
                onMouseOver={e=>e.currentTarget.style.borderColor=d.a1}
                onMouseOut={e=>e.currentTarget.style.borderColor=d.b}
                onClick={()=>{setLevel(c.id);setExamWindow(null);setStep(3);}}>
                <div style={{width:36,height:36,borderRadius:9,background:d.a1+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:d.a1,flexShrink:0}}>{c.icon}</div>
                <div>
                  <div style={{fontSize:13.5,fontWeight:600,color:d.t}}>{c.label}</div>
                  <div style={{fontSize:11,color:d.t3,marginTop:1}}>
                    {c.id==="L1"?"foundational — ethics, quant, equity, fixed income":c.id==="L2"?"application — valuation, analysis depth":"portfolio management heavy — constructed response"}
                  </div>
                </div>
              </div>
            ))}
            <button onClick={()=>setStep(1)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",marginTop:10,fontFamily:"inherit"}}>← back</button>
          </div>
        )}

        {/* Step 3 — Exam window */}
        {step===3&&(
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
                  onClick={()=>{setExamWindow(w.id);setStep(4);}}>
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
            <button onClick={()=>setStep(2)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",marginTop:10,fontFamily:"inherit"}}>← back</button>
          </div>
        )}

        {/* Step 4 — Study days, then a calculated commitment check */}
        {step===4&&(()=>{
          const examDateObj=windows.find(w=>w.id===examWindow)?.start;
          const daysUntilExam=examDateObj?Math.max(1,Math.ceil((new Date(examDateObj)-new Date())/86400000)):null;
          let studyDatesCount=0;
          if(examDateObj&&studyDays.length>0){
            for(let i=0;i<daysUntilExam;i++){
              const dt=new Date();dt.setDate(dt.getDate()+i);
              const jsDay=(dt.getDay()+6)%7; // Mon=0..Sun=6
              if(studyDays.includes(jsDay)) studyDatesCount++;
            }
          }
          const requiredPerDayRaw=studyDatesCount>0?Math.round((recommended/studyDatesCount)*10)/10:null;
          // Round UP to the nearest half hour — this must match roundedDailyHours() exactly, since
          // this is the number the roadmap actually gets built at. Showing "1.4h" here and then
          // quietly scheduling 1.5h behind the scenes was confusing (and the raw 1.4h figure was
          // never actually achievable in whole session blocks anyway).
          const requiredPerDay=requiredPerDayRaw!==null?roundedDailyHours(requiredPerDayRaw):null;
          const requiredPerWeekRaw=daysUntilExam?Math.round((recommended/(daysUntilExam/7))*10)/10:null;
          const requiredPerWeek=requiredPerDay!==null&&studyDatesCount>0?Math.round(requiredPerDay*(studyDatesCount/(daysUntilExam/7))*10)/10:requiredPerWeekRaw;
          const feasible=requiredPerDay!==null&&requiredPerDay<=5; // beyond ~5h/study-day is unrealistic for most people

          return(
          <div>
            {commitStep===0&&(<>
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
              <button disabled={studyDays.length===0} onClick={()=>setCommitStep(1)}
                style={{width:"100%",padding:"13px",borderRadius:12,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",opacity:studyDays.length===0?0.4:1,marginBottom:10}}>
                continue →
              </button>
              <button onClick={()=>setStep(3)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
            </>)}

            {commitStep===1&&(<>
              <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>here's what it'll take</div>
              <div style={{fontSize:13,color:d.t3,marginBottom:18,lineHeight:1.5}}>
                covering the full {classLabel} syllabus ({recommended}h) by your exam date, on the {studyDays.length} day{studyDays.length!==1?"s":""}/week you picked, needs about:
              </div>
              <div style={{display:"flex",gap:10,marginBottom:20}}>
                <div style={{flex:1,padding:"16px",borderRadius:12,background:d.card,border:`1.5px solid ${d.a1}`,textAlign:"center"}}>
                  <div style={{fontSize:24,fontWeight:800,color:d.a1,fontFamily:"'DM Serif Display',serif"}}>{requiredPerWeek}h</div>
                  <div style={{fontSize:10,color:d.t3,marginTop:2}}>per week</div>
                </div>
                <div style={{flex:1,padding:"16px",borderRadius:12,background:d.card,border:`1.5px solid ${d.b}`,textAlign:"center"}}>
                  <div style={{fontSize:24,fontWeight:800,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{requiredPerDay}h</div>
                  <div style={{fontSize:10,color:d.t3,marginTop:2}}>per study day</div>
                </div>
              </div>
              {!feasible&&<div style={{fontSize:11.5,color:d.gold,marginBottom:16,lineHeight:1.5,fontStyle:"italic"}}>that's a lot for most people to sustain — totally fine to scope down instead of burning out.</div>}
              <button onClick={()=>{setDailyHours(requiredPerDay||2);onComplete({level,examWindow,studyDays,dailyHours:requiredPerDay||2,targetHours:recommended,focusMode:"full",username});}}
                style={{width:"100%",padding:"13px",borderRadius:12,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",marginBottom:10}}>
                I can commit to {requiredPerDay}h/study day →
              </button>
              <button onClick={()=>setCommitStep(2)}
                style={{width:"100%",padding:"13px",borderRadius:12,background:"transparent",border:`1.5px solid ${d.b}`,color:d.t2,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit",marginBottom:10}}>
                I can't put in that much time
              </button>
              <button onClick={()=>setCommitStep(0)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
            </>)}

            {commitStep===2&&(<>
              <div style={{fontSize:20,fontWeight:700,color:d.t,marginBottom:4,letterSpacing:"-.02em"}}>how much time do you actually have?</div>
              <div style={{fontSize:13,color:d.t3,marginBottom:14,lineHeight:1.5}}>we'll build a leaner roadmap around this instead of the full syllabus.</div>
              <div style={{padding:"12px 14px",borderRadius:10,background:d.gold+"12",border:`1px solid ${d.gold}40`,marginBottom:20,display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{fontSize:16,flexShrink:0}}>⚠️</span>
                <div style={{fontSize:12,color:d.t2,lineHeight:1.5}}><b>low-weight chapters will be skipped entirely</b> — the roadmap will only schedule high (and some medium) weight topics, the highest-yield material for your score. you can still study the rest manually, it just won't be on your plan.</div>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:d.t,marginBottom:10}}>hours per study day</div>
              <div style={{display:"flex",gap:8,marginBottom:24,flexWrap:"wrap"}}>
                {[0.5,1,1.5,2,3].map(h=>(
                  <div key={h} onClick={()=>setDailyHours(h)}
                    style={{flex:1,minWidth:56,padding:"11px 4px",borderRadius:10,textAlign:"center",cursor:"pointer",transition:"all .15s",
                      background:dailyHours===h?d.a1+"18":d.card,
                      border:"1.5px solid "+(dailyHours===h?d.a1:d.b),
                      color:dailyHours===h?d.a1:d.t3,fontSize:13,fontWeight:700}}>
                    {h}h
                  </div>
                ))}
              </div>
              <button onClick={()=>onComplete({level,examWindow,studyDays,dailyHours,targetHours:recommended,focusMode:"important",username})}
                style={{width:"100%",padding:"13px",borderRadius:12,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",marginBottom:10}}>
                build my leaner roadmap →
              </button>
              <button onClick={()=>setCommitStep(1)} style={{background:"none",border:"none",color:d.t3,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
            </>)}
          </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Roadmap Questionnaire ─────────────────────────────────────────────────────
function RoadmapQuestionnaire({d,jeClass,onSave}){
  const SUBS=Object.keys(TOPICS).filter(s=>(TOPICS[s][jeClass]||[]).length>0);
  const [step,setStep]=useState(0); // 0=completed topics, 1=weak areas
  const [completedTopics,setCompletedTopics]=useState({});
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
        <div style={{fontSize:12,color:d.t3,marginBottom:10,textAlign:"center"}}>a few quick questions before we build your roadmap — this is what makes it yours instead of a generic checklist.</div>
        <div style={{display:"flex",gap:4,marginBottom:24}}>
          {[0,1].map(s=><div key={s} style={{height:3,flex:1,borderRadius:2,background:s<=step?d.a1:d.b,transition:"background .2s"}}/>)}
        </div>

        {step===0&&(
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,marginBottom:4,letterSpacing:"-.03em"}}>what have you already covered?</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:6}}>tick anything you've studied before — even partially. we'll skip these in your roadmap. it's fine to tick nothing if you're starting fresh.</div>
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
            </div>
          </div>
        )}


        {step===1&&(
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
              <button onClick={()=>setStep(0)} style={{padding:"12px 18px",borderRadius:10,background:"transparent",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontFamily:"inherit"}}>← back</button>
              <button onClick={()=>onSave({completedTopics,weakAreas})}
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
      const s=localStorage.getItem("nev_auth")||localStorage.getItem("slothr_auth");
      if(!s)return null;
      const p=JSON.parse(s);
      if(p.expires_at&&p.expires_at<Date.now()){localStorage.removeItem("nev_auth");return null;}
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
    const prev=()=>{try{return JSON.parse(localStorage.getItem("nev_auth")||localStorage.getItem("slothr_auth"));}catch(e){return null;}};
    const p=prev();
    if(p?.user?.id&&p.user.id!==stored?.user?.id){
      // Different user — wipe everything so old account data doesn't bleed
      const ALL_KEYS=["nev_auth","nev_session_log","nev_mock_exams","nev_goal_log","nev_pyq_log",
        "nev_syllabus_status","nev_class","nev_revision_log","nev_sessions","nev_completed",
        "nev_syllabus","nev_mocks","nev_topic_notes","nev_roadmap_answers","nev_roadmap_done",
        "nev_exam_window","nev_study_days","nev_edu_status","nev_target_hours",
        "nev_exam_setup_done","nev_profile","nev_buddies","nev_setup"];
      ALL_KEYS.forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
      // Reset in-memory state immediately too — don't wait for the async Supabase reload
      setSessions([]);setMocks([]);setGoals([]);setPyqHistory([]);
      setSyllabusStatus({});setJeClass(null);setExamWindow(null);setStudyDays([0,1,2,3,4]);
      setRoadmapAnswers(null);
    }
    localStorage.setItem("nev_auth",JSON.stringify(stored));
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
    const ALL_KEYS=["nev_auth","nev_session_log","nev_mock_exams","nev_goal_log","nev_pyq_log",
      "nev_syllabus_status","nev_class","nev_revision_log","nev_sessions","nev_completed",
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
  // Mobile Chrome occasionally miscalculates the layout viewport width right after an in-app
  // (SPA) navigation onto a page short enough that it never needs to scroll — the page renders
  // narrower than the actual screen until something forces a reflow. Nudging a resize event on
  // every tab switch costs nothing and reliably forces that recalculation.
  useEffect(()=>{
    const id=setTimeout(()=>{try{window.dispatchEvent(new Event("resize"));}catch(e){}},50);
    return ()=>clearTimeout(id);
  },[tab]);
  const [jeClass,setJeClass]=useState(()=>{try{return localStorage.getItem("nev_class")||localStorage.getItem("slothr_class")||null;}catch(e){return null;}});
  // ── Exam setup state ─────────────────────────────────────────────────────
  const [examWindow,setExamWindow]=useState(()=>{try{return localStorage.getItem("nev_exam_window")||null;}catch(e){return null;}});
  const [studyDays,setStudyDays]=useState(()=>{try{const v=localStorage.getItem("nev_study_days");return v?JSON.parse(v):[0,1,2,3,4];}catch(e){return [0,1,2,3,4];}});
  const [eduStatus,setEduStatus]=useState(()=>{try{return localStorage.getItem("nev_edu_status")||null;}catch(e){return null;}}); // "student"|"working"|"graduated"
  const [targetHours,setTargetHours]=useState(()=>{try{const v=localStorage.getItem("nev_target_hours");return v?parseInt(v):null;}catch(e){return null;}});
  const [dailyStudyHours,setDailyStudyHours]=useState(()=>{try{const v=localStorage.getItem("nev_daily_hours");return v?parseFloat(v):2;}catch(e){return 2;}});
  const [roadmapFocusMode,setRoadmapFocusMode]=useState(()=>{try{return localStorage.getItem("nev_focus_mode")||"full";}catch(e){return "full";}});
  useEffect(()=>{try{localStorage.setItem("nev_focus_mode",roadmapFocusMode);}catch(e){}},[roadmapFocusMode]);
  const [examSetupDone,setExamSetupDone]=useState(()=>{try{return localStorage.getItem("nev_exam_setup_done")==="1";}catch(e){return false;}});
  // True while we're still waiting to hear back from the server about this account's saved
  // setup — without this, a brand-new session (no localStorage yet, e.g. incognito) renders
  // the onboarding/roadmap screens immediately on the first frame, before the fetch below has
  // any chance to say "actually, this account already has a saved setup."
  const [prefsLoading,setPrefsLoading]=useState(()=>!!(authSession?.access_token&&user?.id));
  useEffect(()=>{try{if(examWindow)localStorage.setItem("nev_exam_window",examWindow);}catch(e){}},[examWindow]);
  useEffect(()=>{try{localStorage.setItem("nev_study_days",JSON.stringify(studyDays));}catch(e){}},[studyDays]);
  useEffect(()=>{try{if(eduStatus)localStorage.setItem("nev_edu_status",eduStatus);}catch(e){}},[eduStatus]);
  useEffect(()=>{try{if(targetHours)localStorage.setItem("nev_target_hours",String(targetHours));}catch(e){}},[targetHours]);
  useEffect(()=>{try{localStorage.setItem("nev_daily_hours",String(dailyStudyHours));}catch(e){}},[dailyStudyHours]);
  const [sessions,setSessions]=useState(()=>{try{const c=localStorage.getItem("nev_session_log")||localStorage.getItem("slothr_sessions");return c?JSON.parse(c):[];}catch(e){return [];}});
  // Days the user actually opened/used the app — this is what the streak is based on now,
  // not whether they logged a study session that day. Showing up counts.
  const [activityDates,setActivityDates]=useState(()=>{
    try{const c=localStorage.getItem("nev_activity_dates");return c?JSON.parse(c):[];}catch(e){return [];}
  });
  const [mocks,setMocks]=useState(()=>{try{const c=localStorage.getItem("nev_mock_exams")||localStorage.getItem("slothr_mocks");return c?JSON.parse(c):[];}catch(e){return [];}});

  // ── Receive completed practice test result ──────────────────────────────────
  function handleTestComplete({mockEntry, pyqEntries}){
    setMocks(prev=>[...prev, mockEntry]);
    setPyqHistory(prev=>[...prev, ...pyqEntries]);
  }

  // Goals
  const [goals,setGoals]=useState(()=>{try{const c=localStorage.getItem("nev_goal_log")||localStorage.getItem("slothr_goals");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [goalInput,setGoalInput]=useState("");
  const [goalSub,setGoalSub]=useState("Ethics");
  const [goalTopic,setGoalTopic]=useState("");
  const [goalType,setGoalType]=useState("study");
  const [goalTarget,setGoalTarget]=useState("");
  const [goalLoading,setGoalLoading]=useState(false);

  // PYQ
  const [pyqHistory,setPyqHistory]=useState(()=>{try{const c=localStorage.getItem("nev_pyq_log")||localStorage.getItem("slothr_pyq");return c?JSON.parse(c):[];}catch(e){return [];}});

  // Coach
  const [syllabusStatus,setSyllabusStatus]=useState(()=>{try{const c=localStorage.getItem("nev_syllabus_status")||localStorage.getItem("slothr_syllabus");return c?JSON.parse(c):{};}catch(e){return {};}});
  // Revision scheduler state
  const [revisionLog,setRevisionLog]=useState(()=>{try{const c=localStorage.getItem("nev_revision_log")||localStorage.getItem("slothr_revision");return c?JSON.parse(c):{};}catch(e){return {};}});
  useEffect(()=>{try{localStorage.setItem("nev_revision_log",JSON.stringify(revisionLog));}catch(e){}},[revisionLog]);
  // Which "studied but not tracked" card currently has its recency picker open
  const [revisionRecencyPicker,setRevisionRecencyPicker]=useState(null);
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
  // Backfill scheduling for topics studied before/outside the tracker — the user tells us roughly
  // how long ago, we back-date lastStudied and compute the 3/7/14/30-day schedule from THAT date.
  // If it's been a while, some of those dates will already be in the past — which correctly makes
  // the topic show up as due immediately, instead of pretending it was just studied today.
  const RECENCY_DAYS_AGO={today:0,week:5,month:21,longer:45};
  function markStudiedWithRecency(sub,topic,recency){
    const daysAgo=RECENCY_DAYS_AGO[recency]??0;
    const lastStudied=addDays(today(),-daysAgo);
    setRevisionLog(prev=>({...prev,[sub+"|"+topic]:{
      lastStudied,
      nextRevisions:[
        addDays(lastStudied,3),
        addDays(lastStudied,7),
        addDays(lastStudied,14),
        addDays(lastStudied,30),
      ].filter(d=>true), // keep all four — past-due ones will simply surface as "due now"
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
  const [hasSearchedBuddy,setHasSearchedBuddy]=useState(false);
  const [buddyResults,setBuddyResults]=useState([]);
  const [buddyLoading,setBuddyLoading]=useState(false);
  const [buddyRequests,setBuddyRequests]=useState([]);
  const [myBuddies,setMyBuddies]=useState(()=>{try{const v=localStorage.getItem("nev_buddies");return v?JSON.parse(v):[];}catch(e){return [];}});
  useEffect(()=>{try{localStorage.setItem("nev_buddies",JSON.stringify(myBuddies));}catch(e){}},[myBuddies]);
  const [buddyStats,setBuddyStats]=useState({});
  const [sentRequests,setSentRequests]=useState(new Set()); // track pending sent requests
  const [recommendedBuddies,setRecommendedBuddies]=useState([]);
  const [recommendedLoading,setRecommendedLoading]=useState(false);
  async function loadSentRequests(){
    if(!user?.id||!authSession?.access_token)return;
    try{
      const r=await fetch(`${SB_URL}/rest/v1/nev_buddy_requests?from_user=eq.${user.id}&status=eq.pending&select=to_user`,{
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`}
      });
      if(!r.ok)return;
      const d=await r.json();
      if(Array.isArray(d))setSentRequests(new Set(d.map(x=>x.to_user)));
    }catch(e){}
  }
  useEffect(()=>{
    if(tab==="buddy"){
      myBuddies.forEach(b=>fetchBuddyStats(b.id));
      loadBuddyRequests();
      loadMyBuddies();
      loadSentRequests();
      // Poll for changes (accepted requests, new incoming requests) while the tab is open —
      // there's no realtime subscription, so this is what makes acceptance show up without
      // the user having to leave and re-enter the tab.
      const poll=setInterval(()=>{
        loadBuddyRequests();
        loadMyBuddies();
        loadSentRequests();
      },20000);
      return ()=>clearInterval(poll);
    }
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
    if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,roadmap_answers:ans})}).catch(()=>{});
  }
  // ── Planner / Roadmap completion state ───────────────────────────────────
  const [roadmapDone,setRoadmapDone]=useState(()=>{try{const c=localStorage.getItem("nev_roadmap_done");return c?JSON.parse(c):{};}catch(e){return {};}});
  useEffect(()=>{try{localStorage.setItem("nev_roadmap_done",JSON.stringify(roadmapDone));}catch(e){}},[roadmapDone]);
  // Any topic marked "done" (via the roadmap, a manual syllabus override, or from before this
  // auto-sync existed) that has no revision schedule yet gets backfilled automatically — this is
  // what makes "completed topics" actually show up in the revision panel without the user having
  // to manually add each one. Uses the real roadmap completion date when findable, so the 3/7/14/
  // 30-day due dates are accurate instead of resetting the clock to today.
  useEffect(()=>{
    const toBackfill=Object.keys(syllabusStatus).filter(key=>syllabusStatus[key]==="done"&&!revisionLog[key]);
    if(toBackfill.length===0)return;
    setRevisionLog(prev=>{
      const next={...prev};
      toBackfill.forEach(key=>{
        if(next[key])return; // already backfilled — avoid clobbering an active schedule
        const [sub,topic]=key.split("|");
        let completionDate=null;
        Object.keys(roadmapDone).forEach(k=>{
          if(!roadmapDone[k])return;
          const parts=k.split("|");
          if(parts.length<4)return;
          if(parts[1]===sub&&parts[2]===topic&&(!completionDate||parts[0]>completionDate)) completionDate=parts[0];
        });
        const lastStudied=completionDate||today();
        next[key]={
          lastStudied,
          nextRevisions:[addDays(lastStudied,3),addDays(lastStudied,7),addDays(lastStudied,14),addDays(lastStudied,30)],
          doneRevisions:[],
        };
      });
      return next;
    });
  },[syllabusStatus]);
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
    // ── Sync to syllabus: last pass = done, first/mid pass = in_progress ────
    if(item.subject&&item.topic){
      const sylKey=item.subject+"|"+item.topic;
      const isLastPass=!item.totalPasses||item.pass===item.totalPasses;
      const isUnticking=!!roadmapDone[itemKey(date,item)]; // will be toggled off
      const newStatus=isUnticking?"in_progress":isLastPass?"done":"in_progress";
      setSyllabusStatus(prev=>{
        const next={...prev,[sylKey]:newStatus};
        if(authSession?.access_token&&user?.id){
          fetch(`${SB_URL}/rest/v1/nev_syllabus`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},
            body:JSON.stringify({user_id:user.id,subject:item.subject,topic:item.topic,status:newStatus,updated_at:new Date().toISOString()})}).catch(()=>{});
        }
        return next;
      });
      // Finishing the LAST pass of a topic = fully done — feed it into the revision scheduler too,
      // so completing something via the roadmap keeps the revision tab in sync automatically.
      if(newStatus==="done")markStudied(item.subject,item.topic);
    }
  }
  // ── Roadmap — recomputed whenever level/window/study days change ──────────
  const windowData=(CFA_EXAM_WINDOWS[jeClass]||[]).find(w=>w.id===examWindow);
  const examDate=windowData?.start||null;
  // ── Stateful roadmap ─────────────────────────────────────────────────────
  // roadmapBase: the full generated plan (recalculated when setup changes)
  // Completed items are tracked in roadmapDone — "today" shows only undone items
  // roadmapStartDate anchors day-1 of the plan to the date it was FIRST generated for this
  // (level, examDate) combo. Without this, every reload/day re-ran generateRoadmap with
  // startDate defaulting to "today", which reset day-1 back to the same weight-sorted topics
  // every single day — that was the "I see the same topics everyday" bug.
  const roadmapAnchorKeyRef=useRef(null);
  const [roadmapStartDate,setRoadmapStartDate]=useState(()=>{
    try{const v=JSON.parse(localStorage.getItem("nev_roadmap_start")||"null");return v?.date||null;}catch(e){return null;}
  });
  useEffect(()=>{
    if(!jeClass||!examDate) return;
    const anchorKey=jeClass+"|"+examDate;
    if(roadmapAnchorKeyRef.current===anchorKey) return;
    roadmapAnchorKeyRef.current=anchorKey;
    let stored=null;
    try{stored=JSON.parse(localStorage.getItem("nev_roadmap_start")||"null");}catch(e){}
    if(stored&&stored.key===anchorKey){
      setRoadmapStartDate(stored.date);
    } else {
      const d=today();
      setRoadmapStartDate(d);
      try{localStorage.setItem("nev_roadmap_start",JSON.stringify({key:anchorKey,date:d}));}catch(e){}
    }
  },[jeClass,examDate]);
  // ── Live personalization signal ──────────────────────────────────────────
  // This is what makes the roadmap "yours" instead of one-size-fits-all: it's recomputed from
  // YOUR actual mock scores, PYQ accuracy, and marked-done chapters — not a static template.
  // NOTE: this is LIVE (recomputes on every tick) — it feeds the "frozen" snapshot below, and
  // is also useful for other displays. It must NOT be used directly to drive roadmapBase, or
  // ticking a single checkbox would regenerate and reshuffle the entire remaining schedule.
  const roadmapPerformanceLive=useMemo(()=>{
    const weakSubjects=new Set();
    Object.keys(SUBJECT_COLORS||{}).forEach(sub=>{
      const scores=mockScores.map(m=>({Physics:m.physics,Chemistry:m.chemistry,Mathematics:m.math}[sub])).filter(v=>v!=null);
      if(scores.length){
        const avg=scores.reduce((a,b)=>a+b,0)/scores.length;
        if(avg<65) weakSubjects.add(sub);
      }
    });
    const topicPyq={};
    (pyqHistory||[]).forEach(p=>{
      const key=p.subject+"|"+p.topic;
      if(!topicPyq[key]) topicPyq[key]={correct:0,total:0};
      topicPyq[key].total++;
      if(p.correct) topicPyq[key].correct++;
    });
    const weakTopics=new Set(),strongTopics=new Set();
    Object.entries(topicPyq).forEach(([key,v])=>{
      if(v.total<2) return;
      const acc=v.correct/v.total;
      if(acc<0.6) weakTopics.add(key);
      else if(acc>=0.85) strongTopics.add(key);
    });
    const doneTopics=new Set(Object.entries(syllabusStatus).filter(([,v])=>v==="done").map(([k])=>k));
    return {weakSubjects,weakTopics,strongTopics,doneTopics};
  },[mockScores,pyqHistory,syllabusStatus]);

  // ── Frozen snapshot used for actual generation ────────────────────────────
  // Only refreshed when the PLAN ITSELF changes (level/exam/study days/questionnaire) or the
  // user explicitly hits "rebalance". This is what stops ticking off a topic — which changes
  // syllabusStatus, which changes roadmapPerformanceLive — from silently regenerating and
  // reshuffling every future day's assignments. That reshuffling was the "I tick something off
  // and it shows me the same thing again" bug.
  const [rebalanceNonce,setRebalanceNonce]=useState(0);
  const [frozenPerformance,setFrozenPerformance]=useState(null);
  const planKey=jeClass+"|"+examDate+"|"+JSON.stringify(studyDays)+"|"+JSON.stringify(roadmapAnswers)+"|"+rebalanceNonce;
  const planKeyRef=useRef(null);
  useEffect(()=>{
    if(planKeyRef.current!==planKey){
      planKeyRef.current=planKey;
      setFrozenPerformance(roadmapPerformanceLive);
    }
  },[planKey,roadmapPerformanceLive]);
  const [showRebalancePicker,setShowRebalancePicker]=useState(false);
  const [rebalancePickDate,setRebalancePickDate]=useState("");
  function rebalanceRoadmap(){
    setShowRebalancePicker(true);
  }
  // Adds all current backlog on top of whatever's already scheduled on the chosen date — it never
  // replaces that day's existing plan. The original overdue slots get marked "removed" (not
  // "done") so they stop being recounted as backlog once they've been given a new home; the
  // actual backlog items get appended into roadmapManualAdds for the chosen date, which is the
  // same persisted mechanism "add topic to today" already uses — so this survives reloads and the
  // Planner grid picks it up automatically for that date, extra hours and all.
  function clearBacklogOnDate(targetDate){
    if(!roadmap||!jeClass||!examDate){setShowRebalancePicker(false);return;}
    const today_str=today();
    if(!targetDate||targetDate<today_str){showToast("pick a date today or later.");return;}
    const overdueItems=[];
    const seen=new Set();
    (roadmap.weeks||[]).forEach(w=>w.days.forEach(dd=>{
      if(dd.date<today_str){
        dd.items.forEach(item=>{
          const k=itemKey(dd.date,item);
          const topicKey=item.subject+"|"+item.topic+"|"+item.pass;
          if(!roadmapDone[k]&&!roadmapRemoved[k]&&!seen.has(topicKey)&&syllabusStatus[item.subject+"|"+item.topic]!=="done"){
            seen.add(topicKey);
            overdueItems.push({item:{...item,_overdue:true,_originalDate:dd.date},removeKey:k});
          }
        });
      }
    }));
    if(overdueItems.length===0){showToast("no backlog to clear.");setShowRebalancePicker(false);return;}
    setRoadmapManualAdds(prev=>({
      ...prev,
      [targetDate]:[...(prev[targetDate]||[]),...overdueItems.map(o=>o.item)]
    }));
    setRoadmapRemoved(prev=>{
      const next={...prev};
      overdueItems.forEach(o=>{next[o.removeKey]=true;});
      return next;
    });
    setShowRebalancePicker(false);
    const hrs=Math.round(overdueItems.reduce((a,o)=>a+(o.item.durationMins||0),0)/60*10)/10;
    showToast(`~${hrs}h of backlog added on top of ${targetDate}'s plan.`);
  }

  const roadmapBase=useMemo(()=>{
    if(!jeClass||!examDate||!roadmapStartDate||!frozenPerformance) return null;
    return generateRoadmap({level:jeClass,examDate,studyDays,answers:roadmapAnswers,startDate:roadmapStartDate,performance:frozenPerformance,dailyHours:dailyStudyHours,focusMode:roadmapFocusMode});
  },[jeClass,examDate,studyDays,roadmapAnswers,roadmapStartDate,frozenPerformance,dailyStudyHours,roadmapFocusMode]);

  // ── Manual overrides ──────────────────────────────────────────────────────
  // User-added or user-removed items for specific days — lets people directly edit "what to
  // study today" instead of being stuck with whatever the algorithm picked.
  const [roadmapManualAdds,setRoadmapManualAdds]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("nev_roadmap_manual_adds")||"{}");}catch(e){return {};}
  });
  const [roadmapRemoved,setRoadmapRemoved]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("nev_roadmap_removed")||"{}");}catch(e){return {};}
  });
  useEffect(()=>{
    try{localStorage.setItem("nev_roadmap_manual_adds",JSON.stringify(roadmapManualAdds));}catch(e){}
    if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,roadmap_manual_adds:roadmapManualAdds})}).catch(()=>{});
  },[roadmapManualAdds]);
  useEffect(()=>{
    try{localStorage.setItem("nev_roadmap_removed",JSON.stringify(roadmapRemoved));}catch(e){}
    if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,roadmap_removed:roadmapRemoved})}).catch(()=>{});
  },[roadmapRemoved]);
  function addManualTopicToday(sub,topic){
    const wt=getWeight(sub,topic,jeClass)||"M";
    const item={subject:sub,topic,weight:wt,pass:1,totalPasses:1,_manual:true};
    setRoadmapManualAdds(prev=>({...prev,[today()]:[...(prev[today()]||[]),item]}));
    showToast(`added "${topic}" to today.`);
  }
  function removeRoadmapItem(date,item){
    const k=itemKey(date,item);
    setRoadmapRemoved(prev=>({...prev,[k]:true}));
  }

  // roadmap is the adaptive view: past undone items get caught up on, either bubbled into today
  // (light slippage) or redistributed across the remaining days (real backlog) so you're never
  // just handed an ever-growing pile on a single day. Manually-added items (ad-hoc "add topic to
  // today", or backlog explicitly cleared onto a chosen date) are folded into every day here —
  // additive on top of whatever the algorithm already scheduled, never replacing it.
  const roadmap=useMemo(()=>{
    if(!roadmapBase||!examDate) return roadmapBase;
    const today_str=today();

    const weeksWithManual=(roadmapBase.weeks||[]).map(w=>({
      ...w,
      days:w.days.map(dd=>{
        const extra=roadmapManualAdds[dd.date];
        if(!extra||extra.length===0) return dd;
        return {...dd,items:[...dd.items,...extra]};
      })
    }));

    const overdue=[];
    const seenKeys=new Set();
    weeksWithManual.forEach(w=>{
      w.days.forEach(dd=>{
        if(dd.date<today_str){
          dd.items.forEach(item=>{
            const k=itemKey(dd.date,item);
            const topicKey=item.subject+"|"+item.topic+"|"+item.pass;
            const syllKey=item.subject+"|"+item.topic;
            if(!roadmapDone[k]&&!roadmapRemoved[k]&&!seenKeys.has(topicKey)&&syllabusStatus[syllKey]!=="done"){
              seenKeys.add(topicKey);
              overdue.push({...item,_overdue:true,_originalDate:dd.date});
            }
          });
        }
      });
    });
    if(overdue.length===0) return {...roadmapBase,weeks:weeksWithManual,_overdueCount:0,_overdueMins:0,_backlogRedistributed:false};
    const overdueMins=overdue.reduce((a,it)=>a+(it.durationMins||0),0);

    // Small slippage (a day or two behind) — bubble overdue items forward, but only as many as
    // actually fit into each day's real time budget. Previously this dumped ALL overdue items
    // straight onto today regardless of the user's daily-hours setting, which is why a 0.5h/day
    // plan could show 2+ hours of backlog crammed into a single "today".
    const backlogThreshold=Math.max(4,(roadmapBase.perDaySessions||2)*2);
    if(overdue.length<=backlogThreshold){
      // Same rounded figure the scheduler itself budgets to (see roundedDailyMins) — using raw
      // unrounded dailyStudyHours here made the backlog bubble-forward budget disagree with what
      // packSessionsIntoDates actually fills each day to.
      const dailyBudgetMins=roundedDailyMins(dailyStudyHours);
      const weeks=weeksWithManual.map(w=>({...w,days:w.days.map(dd=>({...dd,items:[...dd.items]}))}));
      const futureDays=weeks.flatMap(w=>w.days).filter(dd=>dd.date>=today_str);
      const queue=[...overdue];
      for(const dd of futureDays){
        if(queue.length===0)break;
        const existingKeys=new Set(dd.items.map(it=>it.subject+"|"+it.topic+"|"+it.pass));
        const existingTopics=new Set(dd.items.map(it=>it.subject+"|"+it.topic));
        let usedMins=dd.items.reduce((a,it)=>a+(it.durationMins||0),0);
        const toAdd=[];
        while(queue.length){
          const it=queue[0];
          const k=it.subject+"|"+it.topic+"|"+it.pass;
          const topicKey=it.subject+"|"+it.topic;
          if(existingKeys.has(k)){queue.shift();continue;}
          // If this day already has a different pass of the same topic scheduled, don't bubble
          // another pass of it onto the same day too — that's what caused "Code of Ethics: 0.5h
          // of 11h" and "Code of Ethics: 4h of 11h" to both show up on today's list at once.
          // Leave it in the queue and try it again on the next future day instead.
          if(existingTopics.has(topicKey))break;
          if(usedMins+(it.durationMins||30)>dailyBudgetMins)break;
          toAdd.push(it);
          usedMins+=(it.durationMins||30);
          existingTopics.add(topicKey);
          queue.shift();
        }
        dd.items=[...toAdd,...dd.items];
      }
      return{...roadmapBase,weeks,_overdueCount:overdue.length,_overdueMins:overdueMins,_backlogRedistributed:false};
    }

    // Real backlog — spread overdue + remaining future items evenly across the remaining study
    // days instead of dumping the whole pile on today. This is what "makes up for skipped days"
    // without burying you.
    const futureItems=weeksWithManual.flatMap(w=>w.days)
      .filter(dd=>dd.date>=today_str)
      .flatMap(dd=>dd.items.filter(it=>{
        const k=itemKey(dd.date,it);
        return !roadmapDone[k]&&!roadmapRemoved[k]&&syllabusStatus[it.subject+"|"+it.topic]!=="done";
      }));
    const allRemaining=[...overdue,...futureItems];
    const redistributed=generateRoadmap({
      level:jeClass,examDate,studyDays,answers:roadmapAnswers,
      startDate:today_str,
      remainingTopics:allRemaining,
      dailyHours:dailyStudyHours,
    });
    return {...redistributed,_overdueCount:overdue.length,_overdueMins:overdueMins,_backlogRedistributed:true};
  },[roadmapBase,roadmapDone,roadmapRemoved,roadmapManualAdds,examDate,syllabusStatus,jeClass,studyDays,roadmapAnswers,dailyStudyHours]);

  const isRevisionPhase=false; // revision no longer carved out of the roadmap — see the Revision tab/Planner instead
  // Today's items — overdue first, then scheduled, filtered to show undone at top.
  // Also drop anything already marked "done" via the Syllabus tab, anything manually removed.
  // Manual adds (including cleared backlog) are already folded into roadmap.weeks above, so they
  // don't need appending again here.
  const roadmapTodayAllItems=[
    ...((roadmap?.weeks||[]).flatMap(w=>w.days).find(dd=>dd.date===today())?.items||[])
      .filter(it=>syllabusStatus[it.subject+"|"+it.topic]!=="done")
      .filter(it=>!roadmapRemoved[itemKey(today(),it)]),
  ];
  // Sort: undone first, then done (so completed ones sink to bottom)
  const roadmapTodayItems=[
    ...roadmapTodayAllItems.filter(it=>!roadmapDone[itemKey(today(),it)]),
    ...roadmapTodayAllItems.filter(it=>roadmapDone[itemKey(today(),it)]),
  ];
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
  // Help & Feedback form — email pre-filled from the logged-in account but editable, since some
  // people prefer to be contacted somewhere else than their sign-in email.
  const [feedbackCategory,setFeedbackCategory]=useState("bug");
  const [feedbackMessage,setFeedbackMessage]=useState("");
  const [feedbackSubmitting,setFeedbackSubmitting]=useState(false);
  const [feedbackSubmitted,setFeedbackSubmitted]=useState(false);
  const [feedbackError,setFeedbackError]=useState("");
  const [postCapture,setPostCapture]=useState(null); // base64 image from camera
  const [postText,setPostText]=useState("");
  const [postLoading,setPostLoading]=useState(false);
  const [cameraStream,setCameraStream]=useState(null);
  const [showCamera,setShowCamera]=useState(false);
  const [leaderboard,setLeaderboard]=useState([]);
  const [leaderboardLoading,setLeaderboardLoading]=useState(false);
  const [leaderboardError,setLeaderboardError]=useState(false);
  const [feedTab,setFeedTab]=useState("following");
  const [searchResults,setSearchResults]=useState([]);
  const [openComments,setOpenComments]=useState(null);
  const [viewProfile,setViewProfile]=useState(null); // userId to view
  const videoRef=useRef(null);
  const canvasRef=useRef(null);
  function setSyllabusChapter(sub,topic,status){
    setSyllabusStatus(prev=>({...prev,[sub+"|"+topic]:status}));
    if(authSession?.access_token&&user?.id){
      fetch(`${SB_URL}/rest/v1/nev_syllabus`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},
        body:JSON.stringify({user_id:user.id,subject:sub,topic:topic,status:status,updated_at:new Date().toISOString()})}).catch(()=>{});
    }
    const key=sub+"|"+topic;
    if(status==="done"&&!revisionLog[key]){
      // First time this chapter is marked done and it isn't tracked for revision yet — start its clock.
      markStudied(sub,topic);
    } else if(status==="need_revision"&&!revisionLog[key]){
      // Flagged as needing revision but never scheduled — make it due right away.
      setRevisionLog(prev=>({...prev,[key]:{lastStudied:today(),nextRevisions:[today()],doneRevisions:[]}}));
    }
  }
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
  const [manualSub,setManualSub]=useState("Ethics");
  const [manualTopic,setManualTopic]=useState("");
  const [manualMins,setManualMins]=useState("");
  const [manualDate,setManualDate]=useState(()=>today());
  const [manualNotes,setManualNotes]=useState("");
  const [manualSaved,setManualSaved]=useState(false);
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
    let el=document.getElementById("nevilete-css");
    if(!el){el=document.createElement("style");el.id="nevilete-css";document.head.appendChild(el);}
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
            if(timerTopic)markStudied(timerSub,timerTopic);
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
  const streak=calcStreak(activityDates);
  // ── Streak milestone celebration ──────────────────────────────────────────
  const [celebrateMilestone,setCelebrateMilestone]=useState(null);
  const [seenMilestones,setSeenMilestones]=useState(()=>{
    try{return JSON.parse(localStorage.getItem("nev_streak_milestones_seen")||"[]");}catch(e){return [];}
  });
  useEffect(()=>{
    if(streak<=0)return;
    const hit=[...STREAK_MILESTONES].reverse().find(m=>m.days<=streak);
    if(hit&&!seenMilestones.includes(hit.days)){
      setCelebrateMilestone(hit);
      setSeenMilestones(prev=>{
        const next=[...prev,hit.days];
        try{localStorage.setItem("nev_streak_milestones_seen",JSON.stringify(next));}catch(e){}
        return next;
      });
    }
  },[streak]);
  const todayGoals=goals.filter(g=>g.date===today());
  const pyqAccuracy=pyqHistory.length?Math.round((pyqHistory.filter(p=>p.correct).length/pyqHistory.length)*100):null;
  // Sync all data to localStorage
  useEffect(()=>{try{localStorage.setItem("nev_session_log",JSON.stringify(sessions));}catch(e){}},[sessions]);
  // Buddy stats (This Week / Total Hours / Last Studied) read week_mins/total_mins/session_count/
  // last_studied off the profiles row, but nothing was ever writing those columns — they were
  // permanently stuck. Recompute and push them whenever sessions change so buddies can actually
  // see real numbers instead of "..." forever.
  useEffect(()=>{
    if(!authSession?.access_token||!user?.id||sessions.length===0)return;
    const weekStart=(()=>{const dt=new Date();dt.setHours(0,0,0,0);const day=dt.getDay();dt.setDate(dt.getDate()-(day===0?6:day-1));return dt.toISOString().split("T")[0];})();
    const weekMins=sessions.filter(s=>s.date>=weekStart).reduce((a,s)=>a+s.duration,0);
    const totalMins=sessions.reduce((a,s)=>a+s.duration,0);
    const lastStudied=[...sessions].sort((a,b)=>b.date.localeCompare(a.date))[0]?.date||null;
    fetch(`${SB_URL}/rest/v1/profiles`,{
      method:"POST",
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},
      body:JSON.stringify({id:user.id,week_mins:weekMins,total_mins:totalMins,session_count:sessions.length,last_studied:lastStudied})
    }).catch(()=>{});
  },[sessions.length]);
  useEffect(()=>{try{localStorage.setItem("nev_mock_exams",JSON.stringify(mocks));}catch(e){}},[mocks]);
  useEffect(()=>{try{localStorage.setItem("nev_goal_log",JSON.stringify(goals));}catch(e){}},[goals]);
  useEffect(()=>{try{localStorage.setItem("nev_pyq_log",JSON.stringify(pyqHistory));}catch(e){}},[pyqHistory]);
  useEffect(()=>{try{localStorage.setItem("nev_syllabus_status",JSON.stringify(syllabusStatus));}catch(e){}},[syllabusStatus]);
  useEffect(()=>{try{localStorage.setItem("nev_activity_dates",JSON.stringify(activityDates));}catch(e){}},[activityDates]);
  // Load from Supabase on login — Supabase is always the source of truth,
  // never gated on localStorage (that was the cause of data bleeding between accounts)
  useEffect(()=>{
    if(!authSession?.access_token||!user?.id){setPrefsLoading(false);return;}
    setPrefsLoading(true);
    const token=authSession.access_token, uid=user.id;
    // Merge server data in rather than blindly overwriting — a failed fetch (null) or a
    // suspicious empty response while we already have local data (e.g. an RLS policy silently
    // returning 200+[] instead of an error) must never wipe out real progress. This directly
    // guards against the streak/session data getting silently zeroed out.
    function mergeIn(setter,d,prevGetter){
      if(d===null){showToast("couldn't fully sync — showing your last saved data.");return;}
      const server=d.map(r=>r.data||r);
      setter(prev=>{
        if(server.length===0&&prev.length>0) return prev; // suspicious empty — keep local
        const serverIds=new Set(server.map(s=>s.id));
        const localOnly=prev.filter(s=>!serverIds.has(s.id));
        return [...server,...localOnly];
      });
    }
    SB_AUTH.loadData("user_sessions",uid,token).then(d=>mergeIn(setSessions,d));
    SB_AUTH.loadData("user_goals",uid,token).then(d=>mergeIn(setGoals,d));
    SB_AUTH.loadData("user_mocks",uid,token).then(d=>mergeIn(setMocks,d));
    SB_AUTH.loadData("user_pyq",uid,token).then(d=>mergeIn(setPyqHistory,d));
    // Roadmap tick-marks ("what to study today") and syllabus completion status were being
    // written to nev_completed / nev_syllabus on every toggle, but never read back — so a topic
    // ticked off on one device just sat in localStorage and never appeared on another device.
    // Not using SB_AUTH.loadData here since these tables order by completed_at/updated_at,
    // not created_at, so a plain select avoids a silent 400 from the wrong order column.
    fetch(`${SB_URL}/rest/v1/nev_completed?user_id=eq.${uid}&select=item_key`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${token}`}})
      .then(r=>r.ok?r.json():null)
      .then(rows=>{
        if(!rows)return;
        setRoadmapDone(prev=>{
          const next={...prev};
          rows.forEach(r=>{if(r.item_key)next[r.item_key]=true;});
          return next;
        });
      }).catch(()=>{});
    fetch(`${SB_URL}/rest/v1/nev_syllabus?user_id=eq.${uid}&select=subject,topic,status`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${token}`}})
      .then(r=>r.ok?r.json():null)
      .then(rows=>{
        if(!rows)return;
        setSyllabusStatus(prev=>{
          const next={...prev};
          rows.forEach(r=>{if(r.subject&&r.topic)next[r.subject+"|"+r.topic]=r.status;});
          return next;
        });
      }).catch(()=>{});
    // Activity/streak tracking — merge in server-known active days, then mark today active
    // both locally and server-side. If the "user_activity" table isn't set up yet, this fails
    // silently and the app just falls back to local-only tracking on this device.
    SB_AUTH.loadData("user_activity",uid,token).then(d=>{
      if(d===null)return;
      const serverDates=d.map(r=>r.data?.date||r.date).filter(Boolean);
      setActivityDates(prev=>[...new Set([...prev,...serverDates])]);
    });
    const todayStr=today();
    setActivityDates(prev=>prev.includes(todayStr)?prev:[...prev,todayStr]);
    fetch(`${SB_URL}/rest/v1/user_activity`,{
      method:"POST",
      headers:{"apikey":SB_ANON,"Authorization":`Bearer ${token}`,"Content-Type":"application/json","Prefer":"resolution=ignore-duplicates"},
      body:JSON.stringify({user_id:uid,data:{date:todayStr}})
    }).catch(()=>{});
    fetch(`${SB_URL}/rest/v1/user_prefs?user_id=eq.${uid}&select=*`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${token}`}})
      .then(r=>r.json())
      .then(d=>{
        const row=d?.[0];
        if(!row)return;
        if(row.je_class){setJeClass(row.je_class);try{localStorage.setItem("nev_class",row.je_class);}catch(e){}}
        if(row.exam_window){setExamWindow(row.exam_window);try{localStorage.setItem("nev_exam_window",row.exam_window);}catch(e){}}
        if(row.study_days){setStudyDays(row.study_days);try{localStorage.setItem("nev_study_days",JSON.stringify(row.study_days));}catch(e){}}
        if(row.target_hours){setTargetHours(row.target_hours);try{localStorage.setItem("nev_target_hours",String(row.target_hours));}catch(e){}}
        if(row.daily_hours){setDailyStudyHours(row.daily_hours);try{localStorage.setItem("nev_daily_hours",String(row.daily_hours));}catch(e){}}
        if(row.roadmap_answers){setRoadmapAnswers(row.roadmap_answers);try{localStorage.setItem("nev_roadmap_answers",JSON.stringify(row.roadmap_answers));}catch(e){}}
        if(row.roadmap_manual_adds){setRoadmapManualAdds(row.roadmap_manual_adds);try{localStorage.setItem("nev_roadmap_manual_adds",JSON.stringify(row.roadmap_manual_adds));}catch(e){}}
        if(row.roadmap_removed){setRoadmapRemoved(row.roadmap_removed);try{localStorage.setItem("nev_roadmap_removed",JSON.stringify(row.roadmap_removed));}catch(e){}}
        if(row.focus_mode){setRoadmapFocusMode(row.focus_mode);try{localStorage.setItem("nev_focus_mode",row.focus_mode);}catch(e){}}
        if(row.je_class&&row.exam_window){
          // Setup is complete — mark done so we don't show the setup screen again
          setExamSetupDone(true);
          try{localStorage.setItem("nev_exam_setup_done","1");}catch(e){}
        }
      }).catch(()=>{}).finally(()=>setPrefsLoading(false));
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
  // Profile loader — must be before early returns
  useEffect(()=>{
    if(tab==="profile"&&user?.id){
      fetchProfile(user.id).then(p=>{
        setProfile(p);
        if(p)setProfileIsPublic(p.is_public!==false); // default true if unset
      });
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
      if(timerTopic)markStudied(timerSub,timerTopic);
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
  // Called from the "start" button on a roadmap item in Overview — jumps to Sessions,
  // prefills subject/topic, and immediately starts a countdown for this item's scheduled
  // duration. This was previously called but never defined, so the button silently did nothing.
  function startTimer(item){
    if(timerOn)return;
    setTab("sessions");
    setTimerSub(item.subject);
    setTimerTopic(item.topic);
    setTimerNotes("");
    setTimerMode("countdown");
    const mins=Math.max(1,Math.round(item.durationMins||countdownSet));
    setCountdownSet(mins);
    setCountdownSec(mins*60);
    setTimerDone(false);
    setTimerOn(true);
  }
  function resetTimer(){setTimerOn(false);setTimerSec(0);timerSecRef.current=0;setCountdownSec(countdownSet*60);setTimerDone(false);}
  function applyCustom(){const m=parseInt(customMins);if(m>0&&m<=600){setCountdownSet(m);setCountdownSec(m*60);setCustomMins("");};}
  function logManualSession(){
    const mins=Math.round(parseFloat(manualMins));
    if(!mins||mins<=0||mins>600)return;
    const entry={id:Date.now(),subject:manualSub,topic:manualTopic||"General",duration:mins,date:manualDate||today(),notes:manualNotes||"Manually logged"};
    setSessions(p=>[...p,entry]);
    if(manualTopic)markStudied(manualSub,manualTopic);
    if(authSession?.access_token&&user?.id){
      fetch(`${SB_URL}/rest/v1/user_sessions`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({user_id:user.id,data:entry})}).catch(()=>{});
    }
    setManualMins("");setManualNotes("");
    setManualSaved(true);
    setTimeout(()=>setManualSaved(false),2500);
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
  async function sendBuddyRequest(targetUser){
    if(!user?.id||!authSession?.access_token)return;
    // Optimistic UI: mark as "sent" immediately
    setSentRequests(prev=>new Set([...prev,targetUser.id]));
    showToast(`request sent to @${targetUser.username||"them"}.`);
    try{
      const r=await fetch(`${SB_URL}/rest/v1/nev_buddy_requests`,{
        method:"POST",
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=ignore-duplicates,return=representation"},
        body:JSON.stringify({from_user:user.id,to_user:targetUser.id,status:"pending"})
      });
      if(!r.ok){setSentRequests(prev=>{const n=new Set(prev);n.delete(targetUser.id);return n;});showToast("couldn't send that request — try again.");}
    }catch(e){setSentRequests(prev=>{const n=new Set(prev);n.delete(targetUser.id);return n;});showToast("couldn't send that request — try again.");}
  }
  async function acceptBuddyRequest(req){
    if(!user?.id||!authSession?.access_token)return;
    try{
      // Update status to accepted
      await fetch(`${SB_URL}/rest/v1/nev_buddy_requests?id=eq.${req.id}`,{
        method:"PATCH",
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},
        body:JSON.stringify({status:"accepted"})
      });
      // Add each other as buddies locally
      const them={id:req.from_user,username:req.profiles?.username,display_name:req.profiles?.display_name,je_class:req.profiles?.je_class};
      setMyBuddies(prev=>[...prev.filter(b=>b.id!==them.id),them]);
      setBuddyRequests(prev=>prev.filter(r=>r.id!==req.id));
    }catch(e){}
  }
  async function declineBuddyRequest(req){
    if(!user?.id||!authSession?.access_token)return;
    try{
      await fetch(`${SB_URL}/rest/v1/nev_buddy_requests?id=eq.${req.id}`,{
        method:"PATCH",
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},
        body:JSON.stringify({status:"declined"})
      });
      setBuddyRequests(prev=>prev.filter(r=>r.id!==req.id));
    }catch(e){}
  }
  async function loadBuddyRequests(){
    if(!user?.id||!authSession?.access_token)return;
    try{
      // Step 1: get pending requests to me
      const r=await fetch(`${SB_URL}/rest/v1/nev_buddy_requests?to_user=eq.${user.id}&status=eq.pending&select=id,from_user,created_at`,{
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`}
      });
      const reqs=await r.json();
      if(!Array.isArray(reqs)||reqs.length===0)return;
      // Step 2: fetch senders' profiles
      const fromIds=reqs.map(r=>r.from_user).join(",");
      const profR=await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${fromIds})&select=id,username,display_name,avatar_url,je_class`,{
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`}
      });
      const profs=await profR.json();
      const profMap={};
      if(Array.isArray(profs))profs.forEach(p=>profMap[p.id]=p);
      // Merge
      const enriched=reqs.map(req=>({...req,profiles:profMap[req.from_user]||null}));
      setBuddyRequests(enriched);
    }catch(e){}
  }
  async function loadMyBuddies(){
    if(!user?.id||!authSession?.access_token)return;
    try{
      // Step 1: get all accepted request rows involving this user
      const [r1,r2]=await Promise.all([
        fetch(`${SB_URL}/rest/v1/nev_buddy_requests?from_user=eq.${user.id}&status=eq.accepted&select=to_user`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`}}),
        fetch(`${SB_URL}/rest/v1/nev_buddy_requests?to_user=eq.${user.id}&status=eq.accepted&select=from_user`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`}})
      ]);
      const d1=await r1.json(),d2=await r2.json();
      const buddyIds=[];
      if(Array.isArray(d1))d1.forEach(r=>r.to_user&&buddyIds.push(r.to_user));
      if(Array.isArray(d2))d2.forEach(r=>r.from_user&&buddyIds.push(r.from_user));
      if(buddyIds.length===0)return;
      // Step 2: fetch profiles for those IDs
      const ids=buddyIds.join(",");
      const profR=await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${ids})&select=id,username,display_name,avatar_url,je_class`,{
        headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`}
      });
      const profs=await profR.json();
      if(Array.isArray(profs)&&profs.length>0)setMyBuddies(profs);
    }catch(e){}
  }
  async function searchBuddy(){
    if(!buddySearch.trim())return;
    setBuddyLoading(true);
    setBuddyResults([]);
    const q=buddySearch.replace("@","").toLowerCase().trim();
    try{
      // Search by exact username first, then partial
      const exactR=await fetch(SB_URL+"/rest/v1/profiles?username=eq."+encodeURIComponent(q)+"&select=id,username,display_name,avatar_url,je_class",{
        headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}
      });
      const exactD=await exactR.json();
      if(Array.isArray(exactD)&&exactD.length>0){
        setBuddyResults(exactD.filter(u=>u.id!==user?.id&&!myBuddies.find(b=>b.id===u.id)));
        setHasSearchedBuddy(true);setBuddyLoading(false);return;
      }
      // Fallback: partial match
      const r=await fetch(SB_URL+"/rest/v1/profiles?username=ilike."+encodeURIComponent("%"+q+"%")+"&select=id,username,display_name,avatar_url,je_class&limit=10",{
        headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}
      });
      const d=await r.json();
      if(Array.isArray(d))setBuddyResults(d.filter(u=>u.id!==user?.id&&!myBuddies.find(b=>b.id===u.id)));
    }catch(e){console.error("Buddy search error:",e);}
    setHasSearchedBuddy(true);
    setBuddyLoading(false);
  }
  function addBuddy(u){
    setMyBuddies(prev=>prev.find(b=>b.id===u.id)?prev:[...prev,u]);
    setBuddyResults(prev=>prev.filter(r=>r.id!==u.id));
  }
  function removeBuddy(id){
    setMyBuddies(prev=>prev.filter(b=>b.id!==id));
  }
  // Fetch buddy stats from their public profile row (week_mins, total_mins synced on session save)
  async function fetchBuddyStats(buddyId){
    try{
      const r=await fetch(SB_URL+"/rest/v1/profiles?id=eq."+buddyId+"&select=week_mins,total_mins,last_studied,session_count",{
        headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}
      });
      const rows=await r.json();
      if(!Array.isArray(rows)||!rows.length)return;
      const p=rows[0];
      setBuddyStats(prev=>({...prev,[buddyId]:{
        weekMins:p.week_mins||0,
        totalMins:p.total_mins||0,
        lastDate:p.last_studied||null,
        sessionCount:p.session_count||0,
      }}));
    }catch(e){}
  }
  // ── "People you may know" style ranking ────────────────────────────────────
  // Mirrors the core signal behind Facebook's friend suggestions: rank candidates
  // by mutual connections first, then by other affinity signals (same exam window,
  // recent activity, similar study volume) — not just a flat "same level" filter.
  async function fetchRecommendedBuddies(){
    if(!jeClass||!user?.id)return;
    setRecommendedLoading(true);
    try{
      const myBuddyIds=new Set(myBuddies.map(b=>b.id));
      // Step 1: candidate pool — same level, not me, not already a buddy.
      // Cast a wider net than before since we now rank instead of just filtering.
      const url=SB_URL+"/rest/v1/profiles?je_class=eq."+jeClass+"&id=neq."+user.id+"&select=id,username,display_name,avatar_url,je_class,exam_window,week_mins,total_mins,last_studied,session_count&limit=60";
      const r=await fetch(url,{headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}});
      if(!r.ok){showToast("couldn't load buddy suggestions — check your connection.");setRecommendedLoading(false);return;}
      const d=await r.json();
      if(!Array.isArray(d)){setRecommendedLoading(false);return;}
      const candidates=d.filter(u=>!myBuddyIds.has(u.id));
      if(candidates.length===0){setRecommendedBuddies([]);setRecommendedLoading(false);return;}

      // Step 2: mutual connections — accepted buddy edges touching any candidate.
      const candIds=candidates.map(c=>c.id);
      let mutualMap={}; // candidateId -> count of shared buddies with me
      if(myBuddyIds.size>0&&candIds.length>0){
        const idsList="("+candIds.join(",")+")";
        const [e1,e2]=await Promise.all([
          fetch(`${SB_URL}/rest/v1/nev_buddy_requests?from_user=in.${idsList}&status=eq.accepted&select=from_user,to_user`,{headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}}),
          fetch(`${SB_URL}/rest/v1/nev_buddy_requests?to_user=in.${idsList}&status=eq.accepted&select=from_user,to_user`,{headers:{"apikey":SB_ANON,"Authorization":"Bearer "+(authSession?.access_token||"")}}),
        ]);
        const [edges1,edges2]=await Promise.all([e1.json(),e2.json()]);
        const allEdges=[...(Array.isArray(edges1)?edges1:[]),...(Array.isArray(edges2)?edges2:[])];
        allEdges.forEach(edge=>{
          // whichever side is the candidate, the other side is one of THEIR buddies
          if(candIds.includes(edge.from_user)&&myBuddyIds.has(edge.to_user)){
            mutualMap[edge.from_user]=(mutualMap[edge.from_user]||0)+1;
          }
          if(candIds.includes(edge.to_user)&&myBuddyIds.has(edge.from_user)){
            mutualMap[edge.to_user]=(mutualMap[edge.to_user]||0)+1;
          }
        });
      }

      // Step 3: score + rank, same spirit as a "people you may know" feed
      const now=today();
      const scored=candidates.map(u=>{
        const mutualCount=mutualMap[u.id]||0;
        const sameWindow=examWindow&&u.exam_window===examWindow;
        const activeRecently=u.last_studied&&daysBetween(u.last_studied,now)<=3;
        const score=
          mutualCount*30 +               // mutual buddies = strongest signal, like FB
          (sameWindow?15:0) +            // studying for the same sitting
          (activeRecently?8:0) +         // actually active, not a ghost profile
          Math.min(10,(u.session_count||0)/3); // established study habit, small weight
        return {...u,_mutualCount:mutualCount,_sameWindow:sameWindow,_activeRecently:activeRecently,_score:score};
      });
      scored.sort((a,b)=>b._score-a._score);
      setRecommendedBuddies(scored.slice(0,8));
    }catch(e){
      console.error(e);
      showToast("couldn't load buddy suggestions right now.");
    }
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

  function suggestTodayFocus(){
    const uniqueDays=new Set(sessions.map(s=>s.date)).size;
    if(uniqueDays<3){showToast("log 3 days of study first. then i'll suggest today's focus. 😏");return;}
    setGoalLoading(true);
    try{
      // ── Mock scores per subject ───────────────────────────────────────────
      const mockBySubject=Object.keys(SUBJECT_COLORS).map(sub=>{
        const scores=mocks.map(m=>({Physics:m.physics,Chemistry:m.chemistry,Mathematics:m.math}[sub]));
        const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null;
        return{sub,avg};
      }).filter(s=>s.avg!==null).sort((a,b)=>a.avg-b.avg);

      // ── BUCKET A: High-weightage chapters not yet studied ─────────────────
      const highWeightGaps=Object.keys(TOPICS).flatMap(sub=>
        classTopics(sub)
          .filter(t=>
            !sessions.some(s=>s.subject===sub&&s.topic===t) &&
            (getWeight(sub,t,jeClass)||"M")==="H"
          )
          .map(t=>({subject:sub, topic:t, weight:"H"}))
      ).slice(0,6);

      // ── BUCKET B: Chapters studied but performing badly ───────────────────
      const topicPyqMap=pyqHistory.reduce((acc,p)=>{
        const key=`${p.subject}||${p.topic}`;
        if(!acc[key]) acc[key]={subject:p.subject,topic:p.topic,correct:0,total:0};
        acc[key].total++;
        if(p.correct) acc[key].correct++;
        return acc;
      },{});

      // ── Build the 4-topic mix: ~2 coverage gaps + ~2 consolidation ──────────
      const existingSet=new Set(roadmapTodayItems.map(g=>`${g.subject}-${g.topic}`));
      const poorPyqStructured=Object.values(topicPyqMap)
        .map(t=>({...t,acc:Math.round((t.correct/t.total)*100),weight:getWeight(t.subject,t.topic,jeClass)||"M"}))
        .filter(t=>t.acc<60&&t.total>=2)
        .sort((a,b)=>a.acc-b.acc);
      const out=[];
      highWeightGaps.forEach(t=>{
        if(out.length>=2)return;
        out.push({subject:t.subject,topic:t.topic,reason:"H-weight chapter with 0 sessions logged."});
      });
      poorPyqStructured.forEach(t=>{
        if(out.length>=4)return;
        out.push({subject:t.subject,topic:t.topic,reason:`${t.acc}% PYQ accuracy on ${t.total} questions.`});
      });
      if(out.length<4){
        mockBySubject.filter(s=>s.avg!==null&&s.avg<65).forEach(s=>{
          if(out.length>=4)return;
          const topicTimes=sessions.filter(x=>x.subject===s.sub).reduce((a,x)=>{a[x.topic]=(a[x.topic]||0)+x.duration;return a;},{});
          const topTopic=Object.entries(topicTimes).sort((a,b)=>b[1]-a[1])[0]?.[0];
          if(topTopic) out.push({subject:s.sub,topic:topTopic,reason:`${s.sub} mock average ${s.avg}/100.`});
        });
      }
      if(out.length<4){
        highWeightGaps.slice(2).forEach(t=>{
          if(out.length>=4)return;
          out.push({subject:t.subject,topic:t.topic,reason:"H-weight chapter with 0 sessions logged."});
        });
      }
      const focus=out.filter(g=>!existingSet.has(`${g.subject}-${g.topic}`)).slice(0,4);

      if(focus.length>0){
        focus.forEach(g=>addManualTopicToday(g.subject,g.topic));
        showToast(`added ${focus.length} focus topic${focus.length!==1?"s":""} to today, based on your weak spots.`);
      } else {
        showToast("couldn't find anything new to suggest — log a bit more study data first.");
      }
    }catch(e){
      console.error(e);
      showToast("couldn't suggest focus topics — try again.");
    }
    setGoalLoading(false);
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  // ─── Onboarding ───────────────────────────────────────────────────────────

  // ── Exam Setup flow — runs once after level is picked ────────────────────
  // ExamSetupDone is false if: brand new user, OR returning user with stale JEE class (dropper/11th/12th)
  const needsSetup = !examSetupDone || !jeClass || !CLASSES.find(c=>c.id===jeClass);
  if(prefsLoading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:d.bg,color:d.t3,fontSize:13,fontFamily:"inherit"}}>
      loading your account…
    </div>
  );
  if(needsSetup) return(
    <ExamSetupScreen
      d={d}
      initialLevel={CLASSES.find(c=>c.id===jeClass)?jeClass:null}
      existingUsername={profile?.username}
      user={user}
      authSession={authSession}
      SB_URL={SB_URL}
      SB_ANON={SB_ANON}
      onComplete={(setup)=>{
        setJeClass(setup.level);
        setExamWindow(setup.examWindow);
        setStudyDays(setup.studyDays);
        setEduStatus(setup.eduStatus);
        setTargetHours(setup.targetHours);
        if(setup.dailyHours) setDailyStudyHours(setup.dailyHours);
        if(setup.focusMode) setRoadmapFocusMode(setup.focusMode);
        if(setup.focusMode&&authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,focus_mode:setup.focusMode})}).catch(()=>{});
        setExamSetupDone(true);
        if(setup.username) setProfile(p=>({...(p||{}),username:setup.username}));
        try{
          localStorage.setItem("nev_class",setup.level);
          localStorage.setItem("nev_exam_window",setup.examWindow);
          localStorage.setItem("nev_study_days",JSON.stringify(setup.studyDays));
          localStorage.setItem("nev_edu_status",setup.eduStatus||"");
          localStorage.setItem("nev_target_hours",String(setup.targetHours));
          localStorage.setItem("nev_exam_setup_done","1");
        }catch(e){}
        if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,je_class:setup.level,exam_window:setup.examWindow,study_days:setup.studyDays,edu_status:setup.eduStatus,target_hours:setup.targetHours,daily_hours:setup.dailyHours||dailyStudyHours})}).catch(()=>{});
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
      <>
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
      </div>
      {/* ── Manual session logging — for sessions you did without the timer open ── */}
      <div className="card cp" style={{marginTop:10}}>
        <div style={{fontSize:13,fontWeight:700,color:d.t,marginBottom:10}}>log a session manually</div>
        <div className="field">
          <label className="fl">subject</label>
          <Select value={manualSub} onChange={v=>{setManualSub(v);setManualTopic("");}} options={Object.keys(SUBJECT_COLORS)} d={d}/>
        </div>
        <div className="field">
          <label className="fl">topic</label>
          <Select value={manualTopic} onChange={setManualTopic} options={[{value:"",label:"General Study"},...classTopics(manualSub).map(t=>({value:t,label:t}))]} d={d}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <div className="field" style={{flex:1}}>
            <label className="fl">minutes</label>
            <input className="inp" type="number" min="1" max="600" placeholder="e.g. 45" value={manualMins} onChange={e=>setManualMins(e.target.value)}/>
          </div>
          <div className="field" style={{flex:1}}>
            <label className="fl">date</label>
            <input className="inp" type="date" value={manualDate} max={today()} onChange={e=>setManualDate(e.target.value)}/>
          </div>
        </div>
        <div className="field">
          <label className="fl">notes (optional)</label>
          <input className="inp" placeholder="what did you cover." value={manualNotes} onChange={e=>setManualNotes(e.target.value)}/>
        </div>
        <button className="btn btn-full" style={{background:d.a1,color:"#fff"}} disabled={!manualMins||parseFloat(manualMins)<=0} onClick={logManualSession}>+ log session</button>
        {manualSaved&&<div style={{textAlign:"center",fontSize:12,color:d.a2,marginTop:8,fontWeight:500}}>logged. nice work.</div>}
      </div>
      </>
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
            {["overview","planner","syllabus","revision","mocks","sessions","coach","streaks"].map(id=>{
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
            {["buddy","report","profile","help"].map(id=>{
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
                  {tab==="coach"&&"your study data, decoded — and are you ready to pass."}
                  {tab==="sessions"&&`${sessions.length} sessions · ${fmt(totalTime)} total. not bad.`}
                  {tab==="streaks"&&`${streak} day streak${currentMilestone?" · "+currentMilestone.icon+" "+currentMilestone.label:""}`}
                  {tab==="syllabus"&&"track every chapter. i know which ones you're avoiding."}
                  {tab==="revision"&&"spaced repetition. i'll remind you before you forget."}
                  {tab==="planner"&&"your full roadmap, auto-built around your exam date."}
                  {tab==="mocks"&&"log every mock. track every score. see the trend."}
                  {tab==="buddy"&&"find someone studying the same level. suffer together."}
                  {tab==="partner"&&"two candidates, one deadline. accountability works."}
                  {tab==="report"&&"every sunday, the truth about your week."}
                  {tab==="profile"&&`@${profile?.username||"..."}`}
                  {tab==="help"&&"found a bug? got an idea? tell us — we actually read these."}
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
              const isStudyDayToday=(studyDays||[]).includes(weekdayIndex(today()));
              // Today's target must reflect what's actually scheduled today, not just the flat
              // daily-hours budget — once backlog gets added on top of today (extra hours, on
              // purpose), today's real commitment is bigger than the usual daily target, so the
              // progress bar and "target hit" message need to grow with it instead of declaring
              // victory at the old, smaller number.
              const todayScheduledMins=roadmapTodayItems.reduce((a,it)=>a+(it.durationMins||0),0);
              const todayTargetMins=isStudyDayToday?Math.max(roundedDailyMins(dailyStudyHours),todayScheduledMins):0;
              const todayRemainingMins=Math.max(0,todayTargetMins-todayMins);

              // Today's items from roadmap — same topic can get multiple passes scheduled on the
              // same day now that a day fills its full budget by continuing an in-progress topic
              // (see packSessionsIntoDates). Merge those into one card here: same "start" button,
              // combined duration, and the cumulative "X of Yh" already reads correctly off the
              // highest-pass entry — showing 3 near-identical rows for one topic was just noise.
              const todayRoadmap=(()=>{
                const groups=new Map();
                for(const it of roadmapTodayItems){
                  const k=it.subject+"|"+it.topic;
                  if(!groups.has(k))groups.set(k,[]);
                  groups.get(k).push(it);
                }
                return Array.from(groups.values()).map(g=>{
                  const sorted=[...g].sort((a,b)=>(a.pass||0)-(b.pass||0));
                  const last=sorted[sorted.length-1];
                  const totalDuration=sorted.reduce((s,it)=>s+(it.durationMins||0),0);
                  // Cumulative "X of Yh" uses pass-number × the ORIGINAL per-pass block size (all
                  // passes of a topic share the same block size) — not the merged total, which
                  // would double-count once several of today's passes get folded into one card.
                  const cumulativeMins=(last.pass||1)*(last.durationMins||30);
                  return {...last,durationMins:totalDuration,_cumulativeMins:cumulativeMins,_mergedPasses:sorted};
                });
              })();
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
              // Same "not enough data yet" gate as the Analytics readiness card — a score computed
              // off 1 day of logging is noise, not signal, so don't show it as if it means anything.
              const ovUniqueDays=new Set(sessions.map(s=>s.date)).size;
              const ovReadinessReady=ovUniqueDays>=7;

              if(!roadmapAnswers){
                return(
                  <div className="pin">
                    <RoadmapQuestionnaire d={d} jeClass={jeClass} onSave={(ans)=>{saveRoadmapAnswers(ans);}}/>
                  </div>
                );
              }
              return(
                <div className="pin">
                  {/* ── Countdown banner ── */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:16,flexWrap:"wrap",gap:14}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:d.t4,marginBottom:4}}>
                        {windowData?windowData.label:"Exam Window"}
                      </div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:32,color:d.t,letterSpacing:"-.03em",lineHeight:1}}>
                        {daysLeft!==null?<>{daysLeft} <span style={{fontSize:16,color:d.t3}}>days left</span></>:"set your exam date"}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{textAlign:"center"}}>
                        {ovReadinessReady?(<>
                          <div style={{fontSize:22,fontWeight:700,color:readColor,fontFamily:"'DM Serif Display',serif"}}>{readiness}</div>
                          <div style={{fontSize:9,color:d.t3,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>readiness</div>
                          <div style={{fontSize:9,fontWeight:700,color:readColor}}>{readLabel}</div>
                        </>):(<>
                          <div style={{fontSize:22,fontWeight:700,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{ovUniqueDays}<span style={{fontSize:12,color:d.t3}}>/7</span></div>
                          <div style={{fontSize:9,color:d.t3,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>days logged</div>
                        </>)}
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

                  {/* ── Today's target ── */}
                  {isStudyDayToday&&todayTargetMins>0&&(
                    <div style={{padding:"14px 16px",borderRadius:12,background:d.card,border:`1px solid ${d.b}`,marginBottom:16,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:160}}>
                        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:d.t4,marginBottom:4}}>today's target</div>
                        <div style={{fontSize:18,fontWeight:700,color:d.t}}>{fmt(todayMins)} <span style={{color:d.t3,fontWeight:400}}>of {fmt(todayTargetMins)}</span></div>
                      </div>
                      <div style={{flex:1,minWidth:120}}>
                        <div style={{height:6,background:d.b,borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${Math.min(100,Math.round((todayMins/todayTargetMins)*100))}%`,background:todayRemainingMins===0?d.a2:d.a1,borderRadius:3,transition:"width .3s"}}/>
                        </div>
                        <div style={{fontSize:11.5,color:todayRemainingMins===0?d.a2:d.t3,marginTop:6,fontStyle:"italic"}}>
                          {todayRemainingMins===0?"target hit for today. good.":`${fmt(todayRemainingMins)} left to hit today's target.`}
                        </div>
                      </div>
                    </div>
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

                  {/* Backlog notice */}
                  {roadmap?._overdueCount>0&&(
                    <div style={{padding:"12px 16px",borderRadius:10,background:roadmap._backlogRedistributed?d.a3+"10":d.gold+"10",border:`1px solid ${roadmap._backlogRedistributed?d.a3:d.gold}25`,fontSize:12.5,color:d.t2,marginBottom:12,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:200}}>
                        {roadmap._backlogRedistributed
                          ? `📦 you had ${roadmap._overdueCount} topics piling up (~${Math.round((roadmap._overdueMins||0)/60*10)/10}h) — spread them across your remaining study days instead of dumping them all today.`
                          : `⏰ ${roadmap._overdueCount} topic${roadmap._overdueCount!==1?"s":""} carried over from missed days (~${Math.round((roadmap._overdueMins||0)/60*10)/10}h of backlog).`}
                      </div>
                      <button onClick={rebalanceRoadmap}
                        style={{padding:"6px 12px",borderRadius:7,background:"transparent",border:`1px solid ${d.b}`,color:d.t2,cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit",flexShrink:0}}>
                        📆 add backlog to a day
                      </button>
                    </div>
                  )}

                  {/* Doesn't-fit notice — content had to be dropped rather than exceed the daily-hours budget */}
                  {roadmap?.droppedSessions>0&&(
                    <div style={{padding:"12px 16px",borderRadius:10,background:d.gold+"10",border:`1px solid ${d.gold}25`,fontSize:12.5,color:d.t2,marginBottom:12,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:200}}>
                        {`⚠️ even the leaner roadmap doesn't fit your exam date at ${roundedDailyHours(dailyStudyHours)}h/day — ~${roadmap.droppedHours}h of lower-priority material (${roadmap.droppedSessions} session${roadmap.droppedSessions!==1?"s":""}) had to be left off the calendar rather than overload any single day. push out your exam date or raise your daily hours to cover it.`}
                      </div>
                    </div>
                  )}

                  {showRebalancePicker&&(
                    <div style={{position:"fixed",inset:0,zIndex:9997,background:"rgba(10,10,15,.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
                      onClick={()=>setShowRebalancePicker(false)}>
                      <div onClick={e=>e.stopPropagation()}
                        style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:16,padding:24,maxWidth:340,width:"100%"}}>
                        <div style={{fontSize:16,fontWeight:700,color:d.t,marginBottom:6}}>Which day should carry the backlog?</div>
                        <div style={{fontSize:12,color:d.t3,marginBottom:14,lineHeight:1.5}}>
                          you're carrying ~{Math.round((roadmap?._overdueMins||0)/60*10)/10}h of backlog. pick one day — it gets added ON TOP of whatever's already scheduled there (extra hours, not a swap), and every other day stays exactly as planned.
                        </div>
                        <div style={{marginBottom:16}}>
                          <label className="fl">pick a date</label>
                          <input className="inp" type="date" min={today()} max={examDate||undefined} value={rebalancePickDate} onChange={e=>setRebalancePickDate(e.target.value)}/>
                          <button onClick={()=>clearBacklogOnDate(rebalancePickDate)} disabled={!rebalancePickDate}
                            style={{width:"100%",marginTop:8,padding:"11px",borderRadius:10,background:rebalancePickDate?d.a1:d.hover,border:`1px solid ${d.b}`,color:rebalancePickDate?"#fff":d.t4,cursor:rebalancePickDate?"pointer":"default",fontFamily:"inherit",fontSize:13,fontWeight:700}}>
                            add backlog to this day
                          </button>
                        </div>
                        <button onClick={()=>setShowRebalancePicker(false)}
                          style={{width:"100%",padding:"10px",borderRadius:10,background:"transparent",border:"none",color:d.t3,cursor:"pointer",fontSize:12,fontFamily:"inherit",marginTop:4}}>
                          cancel
                        </button>
                      </div>
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
                      const passes=item._mergedPasses||[item];
                      const key=itemKey(today(),item);
                      const done=passes.every(p=>roadmapDone[itemKey(today(),p)]);
                      const col=SUBJECT_COLORS[item.subject]||d.a1;
                      return(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:done?d.hover:d.card,border:`1px solid ${done?d.b:col+"30"}`,borderLeft:`3px solid ${done?d.b:col}`,borderRadius:10,marginBottom:8,transition:"all .2s",opacity:done?.6:1}}>
                          <div onClick={()=>{
                              // Toggle every pass merged into this card together, so the checkbox
                              // reflects (and controls) the whole card, not just one pass of it.
                              passes.forEach(p=>{
                                const already=!!roadmapDone[itemKey(today(),p)];
                                if(done?already:!already) toggleRoadmapItem(today(),p);
                              });
                            }}
                            style={{width:22,height:22,borderRadius:6,border:`2px solid ${done?d.a2:d.b}`,background:done?d.a2:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,color:"#fff",fontSize:12,fontWeight:700,transition:"all .15s"}}>
                            {done&&"✓"}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                              <div style={{fontSize:13.5,fontWeight:600,color:done?d.t3:d.t,textDecoration:done?"line-through":"none"}}>{item.topic}</div>
                            </div>
                            {item.totalPasses>1&&(
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                                <div style={{flex:1,maxWidth:100,height:4,background:d.b,borderRadius:2,overflow:"hidden"}}>
                                  <div style={{height:"100%",width:`${(item.pass/item.totalPasses)*100}%`,background:d.a1,borderRadius:2}}/>
                                </div>
                                <span style={{fontSize:9.5,color:d.t4}}>{Math.round(((item._cumulativeMins!=null?item._cumulativeMins:item.pass*(item.durationMins||30))/60)*10)/10} hour of {item.topicHours||"?"} hour</span>
                              </div>
                            )}
                            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                              <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:col+"18",color:col,fontWeight:700}}>{item.subject}</span>
                              <span style={{fontSize:10,color:d.t4}}>{item.weight==="H"?"● high weight":item.weight==="M"?"● medium weight":"● lower weight"}</span>
                              {item.durationMins&&<span style={{fontSize:10,color:d.a2,fontWeight:600}}>~{item.durationMins}min</span>}
                              {item._manual&&<span style={{fontSize:10,color:d.a1}}>+ added by you</span>}
                              {item._overdue&&!item._manual&&<span style={{fontSize:10,color:d.gold}}>carried over</span>}
                            </div>
                          </div>
                          {!done&&(
                            <button onClick={()=>{startTimer({...item,_date:today()});}} disabled={timerOn}
                              style={{padding:"7px 14px",borderRadius:7,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",flexShrink:0,opacity:timerOn?.4:1}}>
                              ▶ start
                            </button>
                          )}
                          <button onClick={()=>passes.forEach(p=>removeRoadmapItem(today(),p))} title="remove from today"
                            style={{width:26,height:26,borderRadius:6,background:"transparent",border:"none",color:d.t4,cursor:"pointer",fontSize:14,flexShrink:0}}>
                            ✕
                          </button>
                        </div>
                      );
                    })}

                    {/* Manually add a topic to today */}
                    <div style={{display:"flex",gap:8,marginTop:8}}>
                      <div style={{flex:1}}><ManualTopicAdder d={d} jeClass={jeClass} onAdd={addManualTopicToday}/></div>
                    </div>

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

                  {/* ── What to revise today ── */}
                  {(()=>{
                    const dueToday=Object.entries(revisionLog)
                      .filter(([,entry])=>entry.nextRevisions?.length>0&&entry.nextRevisions[0]<=today())
                      .map(([key,entry])=>{
                        const [sub,topic]=key.split("|");
                        return{sub,topic,key,overdueDays:daysBetween(entry.nextRevisions[0],today()),weight:getWeight(sub,topic,jeClass)||"M"};
                      })
                      .sort((a,b)=>({H:0,M:1,L:2}[a.weight]-{H:0,M:1,L:2}[b.weight])||b.overdueDays-a.overdueDays);
                    if(dueToday.length===0) return null;
                    return(
                      <div style={{marginBottom:20}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:d.t,letterSpacing:"-.02em"}}>What to revise today</div>
                          <div style={{fontSize:11,color:d.t3}}>{dueToday.length} due</div>
                        </div>
                        {dueToday.slice(0,6).map((r,i)=>{
                          const col=SUBJECT_COLORS[r.sub]||d.a1;
                          return(
                            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 16px",background:d.card,border:`1px solid ${d.b}`,borderLeft:`3px solid ${col}`,borderRadius:10,marginBottom:6}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:13,fontWeight:600,color:d.t}}>{r.topic}</div>
                                <div style={{display:"flex",gap:6,alignItems:"center",marginTop:3,flexWrap:"wrap"}}>
                                  <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:col+"18",color:col,fontWeight:700}}>{r.sub}</span>
                                  <span style={{fontSize:10,color:r.overdueDays>0?d.gold:d.t4}}>{r.overdueDays>0?`${r.overdueDays}d overdue`:"due today"}</span>
                                </div>
                              </div>
                              <button onClick={()=>markRevisionDone(r.sub,r.topic)}
                                style={{padding:"6px 14px",borderRadius:7,background:d.a2,color:"#fff",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                                ✓ revised
                              </button>
                            </div>
                          );
                        })}
                        {dueToday.length>6&&<div style={{fontSize:11,color:d.t3,textAlign:"center",marginTop:6,cursor:"pointer"}} onClick={()=>setTab("revision")}>+{dueToday.length-6} more — open Revision tab</div>}
                      </div>
                    );
                  })()}

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
                  // Weekly trend — last 4 calendar weeks (Monday-start), oldest to newest, left to right
                  const weeks=[];
                  for(let i=3;i>=0;i--){
                    const ws=addDays(weekStartOf(today()),-i*7);
                    const we=addDays(ws,6);
                    const wMins=sessions.filter(s=>s.date>=ws&&s.date<=we).reduce((a,s)=>a+(s.duration||0),0);
                    weeks.push({label:i===0?"This wk":new Date(ws+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"}),mins:wMins,isCurrent:i===0});
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
                            <div style={{width:"100%",background:w.isCurrent?d.a1:d.a1+"50",borderRadius:"4px 4px 0 0",height:Math.max(4,(w.mins/maxWkMins)*70)+"px",transition:"height .5s"}}/>
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
                      const highWt=SUBS.flatMap(sub=>classTopics(sub).filter(t=>getWeight(sub,t,jeClass)==="H").map(t=>({sub,t,done:syllabusStatus[sub+"|"+t]==="done"})));
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
                            <div style={{fontSize:11,color:d.t3,marginBottom:8}}>high-weight topics not yet completed:</div>
                            {notDone.map((x,i)=>(
                              <div key={i} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:`1px solid ${d.b}44`,fontSize:12,color:d.t2,flexWrap:"wrap"}}>
                                <span style={{color:SUBJECT_COLORS[x.sub]||d.a1,fontWeight:600,minWidth:80,flexShrink:0}}>{x.sub}</span>
                                <span style={{minWidth:0,overflowWrap:"break-word"}}>{x.t}</span>
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

              {(()=>{
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

              // ── Performance signal — the piece that was missing ────────────────
              // Everything above measures EFFORT (hours, coverage, pacing). None of it asks
              // "are you actually good at this material?" A student who skims every chapter
              // once could score well here without being exam-ready. Mock scores + PYQ accuracy
              // are the closest proxy we have to "would you actually pass right now."
              const mockScoresFlat=mocks.flatMap(m=>[m.physics,m.chemistry,m.math].filter(v=>v!=null));
              const mockAvg=mockScoresFlat.length?Math.round(mockScoresFlat.reduce((a,b)=>a+b,0)/mockScoresFlat.length):null;
              const performanceScore=
                mockAvg!==null&&pyqAcc!==null ? Math.round(mockAvg*0.65+pyqAcc*0.35) :
                mockAvg!==null ? mockAvg :
                pyqAcc!==null ? pyqAcc :
                null; // no accuracy data at all yet — handled separately below, not defaulted to a fake neutral score

              // Score each factor 0-100
              const factors={
                hoursProgress:{score:hoursPct,weight:20,label:"Hours Logged",hint:Math.round(hoursLoggedSoFar)+" / "+recommendedHrs+"h target"},
                coverage:{score:coveragePct,weight:15,label:"Syllabus Coverage",hint:studiedChapters+"/"+totalChapters+" topics"},
                consistency:{score:Math.min(100,Math.round((streak/60)*100)),weight:15,label:"Consistency (Streak)",hint:streak+" day streak"},
                pacing:{score:onPace===null?50:(onPace?100:Math.max(20,Math.round((currentWeeklyHrs/Math.max(neededWeeklyHrs,1))*100))),weight:15,label:"On Pace for Exam",hint:neededWeeklyHrs!==null?currentWeeklyHrs+"h/wk vs "+neededWeeklyHrs+"h/wk needed":"set exam date for pacing"},
                highWeight:{score:highWtPct,weight:10,label:"High-Weight Topics",hint:highWtDone+"/"+highWtTotal+" done"},
                performance:{score:performanceScore===null?50:performanceScore,weight:performanceScore===null?5:25,label:"Actual Performance",hint:mockAvg!==null&&pyqAcc!==null?`${mockAvg}/100 mock avg · ${pyqAcc}% PYQ accuracy`:mockAvg!==null?`${mockAvg}/100 mock avg`:pyqAcc!==null?`${pyqAcc}% PYQ accuracy`:"take a mock or log PYQs — this is worth the most once you have data"},
              };
              // If there's no performance data yet, redistribute most (not all) of its weight back
              // to hours/coverage — it keeps a small standing weight so "take a mock" still shows
              // up as a suggestion, rather than quietly scoring it 50 as if "average" would.
              if(performanceScore===null){
                factors.hoursProgress.weight+=10;
                factors.coverage.weight+=10;
              }
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
                .filter(([,f])=>f.score<80&&f.weight>0)
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
                    performance:mockAvg===null&&pyqAcc===null?"take a mock exam or log some PYQs — right now nothing here measures if you're actually learning it":mockAvg!==null&&mockAvg<65?"your mock average is below a safe passing margin — go back and consolidate, not just cover new ground":"your PYQ accuracy needs work — drill the topics you're getting wrong, not the ones you already know",
                  }[k]
                }));

              const uniqueDays=new Set(sessions.map(s=>s.date)).size;
              const hasEnoughData=uniqueDays>=7;
              // This card's other two numbers (Days Logged, Total Hours) both come from actual
              // logged study sessions — so the streak shown here needs to be a STUDY streak too,
              // not the app-open streak used in the separate Streaks tab ("showing up counts").
              // Mixing the two made it possible to show "3d streak" next to "0 days logged",
              // which looked like a bug because the two numbers were answering different
              // questions while sitting in the same card.
              const studyStreak=calcStreak(sessions);

              return(
                <div style={{marginTop:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}><div style={{fontSize:15,fontWeight:700,color:d.t}}>Readiness</div><div style={{flex:1,height:1,background:d.b}}/></div>
                  {!hasEnoughData&&(
                    <div className="card cp" style={{textAlign:"center",padding:"40px 24px",marginBottom:20}}>
                      <div style={{fontSize:40,marginBottom:16}}>😎</div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,color:d.t,marginBottom:8}}>readiness score unlocks in {7-uniqueDays} day{7-uniqueDays!==1?"s":""}</div>
                      <div style={{fontSize:13,color:d.t3,marginBottom:20,lineHeight:1.7,maxWidth:320,margin:"0 auto 20px"}}>log study sessions for 7 days and i'll tell you exactly where you stand.</div>
                      <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                        {[{l:"Days Logged",v:uniqueDays,t:"/ 7",c:d.a1},{l:"Total Hours",v:fmt(totalTime),t:"",c:d.a2},{l:"Streak",v:studyStreak+"d",t:"",c:d.a3}].map(s=>(
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
                  </div>);
                })()}
              </div>
            )}

            {/* ── SESSIONS ── */}
            {tab==="sessions"&&(
              <div className="pin" style={{width:"100%",boxSizing:"border-box"}}>
                <div style={{marginBottom:28}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:28,fontWeight:400,letterSpacing:"-.02em",color:d.t,marginBottom:4,lineHeight:1.2}}>sessions.</div>
                  <div style={{fontSize:12,color:d.t3,fontStyle:"italic"}}>{sessions.length===0?"nothing yet.":`${sessions.length} session${sessions.length!==1?"s":""} · ${fmt(totalTime)} total. not bad.`}</div>
                </div>
                <div style={{marginBottom:28}}>
                  {renderTimer()}
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
                        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:d.card,border:`1px solid ${d.b}`,borderLeft:`3px solid ${subColor}`,borderRadius:4,marginBottom:2,flexWrap:"wrap"}}>
                          <div style={{display:"flex",alignItems:"baseline",gap:6,flex:1,minWidth:100}}>
                            <div style={{fontSize:12,fontWeight:700,color:subColor}}>{sub}</div>
                            <div style={{fontSize:9.5,color:d.t4,fontWeight:600}}>{TOPIC_WEIGHT_RANGES[sub]?.[jeClass]||"—"} of exam</div>
                          </div>
                          <div style={{fontSize:10,color:d.t3}}>{subDone}/{chapters.length} chapters</div>
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
                                  <div key={topic} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",background:status==="done"?`${d.a2}05`:status==="in_progress"?`${d.a3}05`:status==="need_revision"?`${d.a1}05`:"transparent",borderBottom:`1px solid ${d.b}44`,transition:"background .12s",flexWrap:"wrap"}}>
                                    <div style={{flex:1,minWidth:140}}>
                                      <div style={{fontSize:12,fontWeight:500,color:status==="done"?d.t3:d.t,textDecoration:status==="done"?"line-through":"none",textDecorationColor:d.t4,overflow:"hidden",textOverflow:"ellipsis"}}>{topic}</div>
                                      <div style={{display:"flex",gap:6,marginTop:3,alignItems:"center",flexWrap:"wrap"}}>
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
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,letterSpacing:"-.02em",marginBottom:4}}>Study Buddy</div>
                  <div style={{fontSize:12,color:d.t3}}>find people studying CFA at the same time. send a request, they accept, then you can see each other's study hours.</div>
                </div>

                {/* Incoming requests */}
                {buddyRequests.length>0&&(
                  <div className="card cp" style={{marginBottom:20,borderColor:d.a1+"40"}}>
                    <div style={{fontSize:12,fontWeight:700,color:d.a1,marginBottom:12}}>📬 {buddyRequests.length} pending request{buddyRequests.length>1?"s":""}</div>
                    {buddyRequests.map(req=>{
                      const p=req.profiles||{};
                      return(
                        <div key={req.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:`1px solid ${d.b}`}}>
                          <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:13,flexShrink:0}}>
                            {(p.display_name||p.username||"?")[0].toUpperCase()}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:600,color:d.t}}>{p.display_name||p.username}</div>
                            <div style={{fontSize:11,color:d.t3}}>@{p.username} wants to be your study buddy</div>
                          </div>
                          <button onClick={()=>acceptBuddyRequest(req)}
                            style={{padding:"6px 12px",borderRadius:6,background:d.a2,color:"#06140f",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                            ✓ accept
                          </button>
                          <button onClick={()=>declineBuddyRequest(req)}
                            style={{padding:"6px 10px",borderRadius:6,background:"none",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Recommended */}
                {(recommendedBuddies.length>0||recommendedLoading)&&(
                  <div className="card cp" style={{marginBottom:20}}>
                    <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:4}}>✨ Recommended for you</div>
                    <div style={{fontSize:11,color:d.t3,marginBottom:14}}>
                      {recommendedLoading?"finding candidates studying "+jeClass+"...":"ranked by mutual buddies, exam window, and activity"}
                    </div>
                    {recommendedBuddies.filter(u=>!myBuddies.find(b=>b.id===u.id)).map(u=>{
                      const reasons=[];
                      if(u._mutualCount>0)reasons.push(`${u._mutualCount} mutual bud${u._mutualCount>1?"dies":"dy"}`);
                      if(u._sameWindow)reasons.push("same window");
                      if(u._activeRecently)reasons.push("active recently");
                      const isSent=sentRequests.has(u.id);
                      return(
                        <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${d.b}44`}}>
                          <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:13,flexShrink:0}}>
                            {(u.display_name||u.username||"?")[0].toUpperCase()}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:d.t}}>{u.display_name||u.username}</div>
                            <div style={{fontSize:11,color:d.t3}}>
                              @{u.username||"—"}{reasons.length>0&&<span style={{color:d.a2,fontWeight:600}}> · {reasons.join(" · ")}</span>}
                            </div>
                          </div>
                          <button onClick={()=>!isSent&&sendBuddyRequest(u)} disabled={isSent}
                            style={{padding:"6px 14px",borderRadius:6,background:isSent?"transparent":d.a1,color:isSent?d.t3:"#fff",border:isSent?`1px solid ${d.b}`:"none",cursor:isSent?"default":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                            {isSent?"✓ sent":"+ request"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Search by username */}
                <div className="card cp" style={{marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:10}}>Search by username</div>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp" placeholder="@username" value={buddySearch}
                      onChange={e=>{setBuddySearch(e.target.value);setHasSearchedBuddy(false);}}
                      onKeyDown={e=>e.key==="Enter"&&searchBuddy()}
                      style={{flex:1}}/>
                    <button onClick={searchBuddy} disabled={buddyLoading}
                      style={{padding:"9px 18px",borderRadius:6,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",opacity:buddyLoading?.6:1}}>
                      {buddyLoading?"...":"search"}
                    </button>
                  </div>
                  {buddyResults.filter(u=>!myBuddies.find(b=>b.id===u.id)).length>0&&(
                    <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
                      {buddyResults.filter(u=>!myBuddies.find(b=>b.id===u.id)).map(u=>{
                        const isSent=sentRequests.has(u.id);
                        return(
                        <div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0"}}>
                          <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:13,flexShrink:0}}>
                            {(u.display_name||u.username||"?")[0].toUpperCase()}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:600,color:d.t}}>{u.display_name||u.username}</div>
                            <div style={{fontSize:11,color:d.t3}}>@{u.username} · {CLASSES.find(c=>c.id===u.je_class)?.label?.replace("CFA ","")||"—"}</div>
                          </div>
                          <button onClick={()=>!isSent&&sendBuddyRequest(u)} disabled={isSent}
                            style={{padding:"6px 14px",borderRadius:6,background:isSent?"transparent":d.a1,color:isSent?d.t3:"#fff",border:isSent?`1px solid ${d.b}`:"none",cursor:isSent?"default":"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                            {isSent?"✓ sent":"+ request"}
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  )}
                  {buddyResults.length===0&&hasSearchedBuddy&&!buddyLoading&&(
                    <div style={{fontSize:11,color:d.t3,marginTop:10,fontStyle:"italic"}}>no one found — make sure they've set a username in their profile.</div>
                  )}
                </div>

                {/* My study buddies */}
                <div style={{fontSize:12,fontWeight:700,color:d.t3,letterSpacing:".08em",textTransform:"uppercase",marginBottom:12}}>
                  My Study Buddies {myBuddies.length>0&&`(${myBuddies.length})`}
                </div>
                {myBuddies.length===0&&(
                  <div className="card empty">
                    <div style={{fontSize:28,marginBottom:10}}>🤝</div>
                    <div className="et">no study buddies yet</div>
                    <div className="es">search by username or send a request to someone recommended above.</div>
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
                        <div style={{width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,${d.a1},${d.a3})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",fontSize:16,flexShrink:0,position:"relative"}}>
                          {(b.display_name||b.username||"?")[0].toUpperCase()}
                          {isActiveToday&&<div style={{position:"absolute",bottom:0,right:0,width:12,height:12,borderRadius:"50%",background:d.a2,border:`2px solid ${d.card}`}}/>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:14,fontWeight:600,color:d.t}}>{b.display_name||b.username}</div>
                          <div style={{fontSize:11,color:d.t3}}>@{b.username||"—"} · {CLASSES.find(c=>c.id===b.je_class)?.label?.replace("CFA ","")||"—"}</div>
                        </div>
                        <button onClick={()=>removeBuddy(b.id)}
                          style={{background:"none",border:"none",color:d.t4,cursor:"pointer",fontSize:16,padding:4}}>×</button>
                      </div>
                      <div style={{display:"flex",gap:8,marginTop:12}}>
                        {[
                          {l:"This Week",v:weekHrs!==null?weekHrs+"h":"...",c:d.a1},
                          {l:"Total Hours",v:totalHrs!==null?totalHrs+"h":"...",c:d.t2},
                          {l:"Last Studied",v:isActiveToday?"Today ✓":daysSinceLast!==null?daysSinceLast+"d ago":"—",c:isActiveToday?d.a2:d.t3},
                        ].map(s=>(
                          <div key={s.l} style={{flex:1,textAlign:"center",padding:"10px 6px",background:d.hover,borderRadius:8}}>
                            <div style={{fontSize:15,fontWeight:700,color:s.c,fontFamily:"'DM Serif Display',serif"}}>{s.v}</div>
                            <div style={{fontSize:8.5,color:d.t3,marginTop:2,textTransform:"uppercase"}}>{s.l}</div>
                          </div>
                        ))}
                      </div>
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

                  {/* Username — set once during onboarding, locked after that */}
                  {profile?.username?(
                    <div style={{display:"inline-flex",alignItems:"center",gap:6,marginBottom:4,padding:"3px 10px",borderRadius:6,background:d.hover}}>
                      <span style={{fontSize:13,color:d.t2}}>@{profile.username}</span>
                    </div>
                  ):!editingUsername?(
                    <div onClick={()=>{setUsernameInput("");setEditingUsername(true);}}
                      style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",marginBottom:4,padding:"3px 10px",borderRadius:6,background:d.hover}}>
                      <span style={{fontSize:13,color:d.t2}}>set a username</span>
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
                      <div style={{fontSize:9.5,color:d.t4,marginTop:5,textAlign:"center"}}>you can only set this once — choose carefully.</div>
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
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0"}}>
                      <span style={{fontSize:12,color:d.t3}}>Study Target</span>
                      <span style={{fontSize:12,fontWeight:600,color:d.t}}>{targetHours||CFA_RECOMMENDED_HOURS[jeClass]||300} hours</span>
                    </div>
                  </div>
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

            {/* ── HELP & FEEDBACK ── */}
            {tab==="help"&&(()=>{
              const submitFeedback=async()=>{
                setFeedbackError("");
                const msg=feedbackMessage.trim();
                if(msg.length<5){setFeedbackError("say a little more so we know what happened");return;}
                setFeedbackSubmitting(true);
                try{
                  const res=await fetch(`${SB_URL}/rest/v1/user_feedback`,{
                    method:"POST",
                    headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token||SB_ANON}`,"Content-Type":"application/json","Prefer":"return=minimal"},
                    body:JSON.stringify({
                      user_id:user?.id||null,
                      // Quietly captured from the account if logged in — there's no support inbox
                      // to reply from yet, so we don't ask for or promise to use an email here.
                      email:user?.email||null,
                      category:feedbackCategory,
                      message:msg,
                      // Context that's genuinely useful for triaging a bug report, sent quietly —
                      // not shown as a form field so the person isn't asked to fill it in themselves.
                      meta:{je_class:jeClass,exam_window:examWindow,daily_hours:dailyStudyHours,page:tab,ts:new Date().toISOString()}
                    })
                  });
                  if(!res.ok)throw new Error("save failed");
                  setFeedbackSubmitted(true);
                  setFeedbackMessage("");
                }catch(e){
                  setFeedbackError("couldn't send that — check your connection and try again");
                }
                setFeedbackSubmitting(false);
              };
              return(
              <div className="pin">
                <div className="card cp" style={{marginBottom:20}}>
                  <div style={{fontSize:16,fontWeight:700,color:d.t,marginBottom:4}}>Help & Feedback</div>
                  <div style={{fontSize:12.5,color:d.t3,marginBottom:18,lineHeight:1.5}}>
                    hit a bug, confused by something, or have an idea that would make this better? tell us here — a real person reads every one of these.
                  </div>

                  {feedbackSubmitted?(
                    <div style={{padding:"20px 16px",borderRadius:10,background:d.a2+"12",border:`1px solid ${d.a2}30`,textAlign:"center"}}>
                      <div style={{fontSize:24,marginBottom:8}}>✅</div>
                      <div style={{fontSize:13.5,fontWeight:700,color:d.t,marginBottom:4}}>thank you, really.</div>
                      <div style={{fontSize:12,color:d.t3,marginBottom:14}}>we read every single one of these, and it directly shapes what we fix and build next. we can't always reply personally, but you're helping make this better for everyone studying with it.</div>
                      <button onClick={()=>setFeedbackSubmitted(false)}
                        style={{padding:"7px 16px",borderRadius:7,background:"transparent",border:`1px solid ${d.b}`,color:d.t2,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
                        send another
                      </button>
                    </div>
                  ):(
                    <>
                      <div className="field">
                        <label className="fl">What's this about?</label>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          {[{id:"bug",label:"🐞 Something's broken"},{id:"idea",label:"💡 Feature idea"},{id:"general",label:"💬 General feedback"}].map(c=>(
                            <div key={c.id} onClick={()=>setFeedbackCategory(c.id)}
                              style={{padding:"8px 14px",borderRadius:8,cursor:"pointer",fontSize:12.5,fontWeight:600,
                                background:feedbackCategory===c.id?d.a1+"18":d.hover,
                                border:`1.5px solid ${feedbackCategory===c.id?d.a1:d.b}`,
                                color:feedbackCategory===c.id?d.a1:d.t2}}>
                              {c.label}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="field">
                        <label className="fl">Tell us what happened</label>
                        <textarea className="inp" rows={5}
                          placeholder="the more detail the better — what were you doing, what did you expect, what actually happened?"
                          style={{resize:"vertical",minHeight:100,fontFamily:"inherit"}}
                          value={feedbackMessage} onChange={e=>setFeedbackMessage(e.target.value)}/>
                      </div>

                      {feedbackError&&(
                        <div style={{fontSize:12,color:d.danger,marginBottom:10}}>{feedbackError}</div>
                      )}

                      <button onClick={submitFeedback} disabled={feedbackSubmitting||feedbackMessage.trim().length<5}
                        style={{width:"100%",padding:"11px",borderRadius:8,background:d.a1,color:"#fff",border:"none",
                          cursor:feedbackSubmitting?"default":"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",
                          opacity:feedbackSubmitting||feedbackMessage.trim().length<5?0.6:1}}>
                        {feedbackSubmitting?"sending...":"send feedback"}
                      </button>
                    </>
                  )}
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
              // ── Auto-sync with the personalised roadmap ──────────────────────────
              // roadmap.revisionTopics is the exact H/M-weight list YOUR roadmap has flagged
              // for the final revision window. Cross-check it against syllabus completion so
              // gaps ("flagged for revision but never actually studied") are visible here too —
              // not just a generic spaced-repetition list disconnected from the plan.
              const roadmapRevisionGaps=(roadmap?.revisionTopics||[])
                .filter(t=>syllabusStatus[t.subject+"|"+t.topic]!=="done")
                .filter((t,i,arr)=>arr.findIndex(x=>x.subject===t.subject&&x.topic===t.topic)===i)
                .sort((a,b)=>wtO[a.weight]-wtO[b.weight])
                .slice(0,6);
              // ── Revision Planner — chronological view of what's coming, like the roadmap ──
              const planner={};
              Object.entries(revisionLog).forEach(([key,entry])=>{
                const next=entry.nextRevisions?.[0];
                if(!next) return;
                const daysOut=daysBetween(today(),next);
                if(daysOut<0||daysOut>21) return; // overdue ones already shown above; cap at 3 weeks out
                const [sub,topic]=key.split("|");
                if(!planner[next]) planner[next]=[];
                planner[next].push({sub,topic,wt:getWeight(sub,topic,jeClass)||"M"});
              });
              const plannerDays=Object.keys(planner).sort();
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

                  {/* Revision Planner — chronological view */}
                  {plannerDays.length>0&&(
                    <div style={{marginBottom:24}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                        <div style={{fontSize:13,fontWeight:700,color:d.t2}}>📅 Revision Planner</div>
                        <div style={{flex:1,height:1,background:d.b}}/>
                        <div style={{fontSize:10,color:d.t3}}>next 21 days</div>
                      </div>
                      <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:6}}>
                        {plannerDays.map(date=>{
                          const items=planner[date];
                          const dt=new Date(date+"T00:00:00");
                          const dayName=dt.toLocaleDateString("en-IN",{weekday:"short"});
                          const isToday=date===today();
                          return(
                            <div key={date} style={{flexShrink:0,width:110,background:isToday?d.a1+"10":d.card,border:`1px solid ${isToday?d.a1:d.b}`,borderRadius:10,padding:"10px 10px"}}>
                              <div style={{fontSize:9,fontWeight:700,color:isToday?d.a1:d.t3,textTransform:"uppercase",marginBottom:2}}>{isToday?"Today":dayName}</div>
                              <div style={{fontSize:11,color:d.t4,marginBottom:8}}>{dt.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
                              {items.slice(0,3).map((it,i)=>{
                                const col=SUBJECT_COLORS[it.sub]||d.a1;
                                return(
                                  <div key={i} title={it.topic} style={{fontSize:10,color:d.t2,padding:"3px 0",borderTop:i>0?`1px solid ${d.b}44`:"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                    <span style={{color:col,fontWeight:700}}>●</span> {it.topic}
                                  </div>
                                );
                              })}
                              {items.length>3&&<div style={{fontSize:9,color:d.t4,marginTop:2}}>+{items.length-3} more</div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

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

                  {/* Flagged by the personalised roadmap for final revision, but not yet studied */}
                  {roadmapRevisionGaps.length>0&&(
                    <div style={{marginBottom:24}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                        <div style={{fontSize:13,fontWeight:700,color:d.a3}}>🗺️ Your Roadmap Flags These for Revision</div>
                        <div style={{flex:1,height:1,background:d.b}}/>
                        <div style={{fontSize:10,color:d.t3}}>not studied yet</div>
                      </div>
                      <div style={{fontSize:11,color:d.t3,marginBottom:10,fontStyle:"italic"}}>these are pulled straight from your personalised roadmap's final-revision list — but you haven't marked them done yet, so there's nothing to revise. cover them first.</div>
                      {roadmapRevisionGaps.map((t,i)=>{
                        const subColor=SUBJECT_COLORS[t.subject];
                        const wtColor=t.weight==="H"?d.danger:d.gold;
                        return(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",marginBottom:4,background:d.card,border:`1px solid ${d.b}`,borderLeft:`3px solid ${d.a3}`,borderRadius:4}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                                <span style={{fontSize:12.5,fontWeight:600,color:d.t}}>{t.topic}</span>
                                <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:`${subColor}18`,color:subColor,fontWeight:700}}>{t.subject}</span>
                                <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:`${wtColor}18`,color:wtColor,fontWeight:700}}>{t.weight}</span>
                              </div>
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
                      <div style={{fontSize:11,color:d.t3,marginBottom:10,fontStyle:"italic"}}>tap a chapter, then tell us roughly when you last studied it — so the due dates are accurate, not reset to "today".</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>
                        {allNeverScheduled.slice(0,12).map(({sub,topic,wt,hrs})=>{
                          const subColor=SUBJECT_COLORS[sub];
                          const wtColor=wt==="H"?d.danger:wt==="M"?d.gold:d.t4;
                          const cardKey=sub+"|"+topic;
                          const pickerOpen=revisionRecencyPicker===cardKey;
                          return(
                            <div key={cardKey} style={{padding:"10px 14px",background:d.card,border:`1px solid ${pickerOpen?d.a1:d.b}`,borderRadius:4}}>
                              <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}
                                onClick={()=>setRevisionRecencyPicker(pickerOpen?null:cardKey)}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:12,fontWeight:500,color:d.t,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{topic}</div>
                                  <div style={{display:"flex",gap:5,marginTop:3}}>
                                    <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:`${subColor}18`,color:subColor,fontWeight:700}}>{sub.slice(0,4)}</span>
                                    <span style={{fontSize:9,padding:"1px 5px",borderRadius:2,background:`${wtColor}18`,color:wtColor,fontWeight:700}}>{wt}</span>
                                    <span style={{fontSize:9,color:d.t3}}>{fmt(hrs)}</span>
                                  </div>
                                </div>
                                <span style={{fontSize:16,color:d.t3}}>{pickerOpen?"−":"+"}</span>
                              </div>
                              {pickerOpen&&(
                                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10,paddingTop:10,borderTop:`1px solid ${d.b}`}}>
                                  {[
                                    {k:"today",l:"today"},
                                    {k:"week",l:"this week"},
                                    {k:"month",l:"2–4 weeks ago"},
                                    {k:"longer",l:"over a month ago"},
                                  ].map(opt=>(
                                    <button key={opt.k}
                                      onClick={()=>{markStudiedWithRecency(sub,topic,opt.k);setRevisionRecencyPicker(null);}}
                                      style={{padding:"5px 10px",borderRadius:6,background:d.hover,border:`1px solid ${d.b}`,color:d.t2,fontSize:10.5,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                                      {opt.l}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {Object.keys(revisionLog).length===0&&allNeverScheduled.length===0&&roadmapRevisionGaps.length===0&&(
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
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead>
                        <tr style={{borderBottom:`1px solid ${d.b}`}}>
                          <th style={{textAlign:"left",padding:"6px 4px",fontSize:9.5,color:d.t4,textTransform:"uppercase",letterSpacing:".05em",fontWeight:600}}></th>
                          <th style={{textAlign:"left",padding:"6px 4px",fontSize:9.5,color:d.t4,textTransform:"uppercase",letterSpacing:".05em",fontWeight:600}}>milestone</th>
                          <th style={{textAlign:"right",padding:"6px 4px",fontSize:9.5,color:d.t4,textTransform:"uppercase",letterSpacing:".05em",fontWeight:600}}>days</th>
                          <th style={{textAlign:"right",padding:"6px 4px",fontSize:9.5,color:d.t4,textTransform:"uppercase",letterSpacing:".05em",fontWeight:600}}>status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {STREAK_MILESTONES.map(b=>{
                          const reached=streak>=b.days;
                          return(
                            <tr key={b.days} style={{borderBottom:`1px solid ${d.b}44`,background:reached?d.a2+"08":"transparent"}}>
                              <td style={{padding:"9px 4px",fontSize:16,width:30}}>{b.icon}</td>
                              <td style={{padding:"9px 4px",fontSize:12.5,fontWeight:500,color:reached?d.t:d.t3}}>{b.label}</td>
                              <td style={{padding:"9px 4px",fontSize:11.5,color:d.t4,textAlign:"right"}}>{b.days}</td>
                              <td style={{padding:"9px 4px",textAlign:"right"}}>
                                {reached?<span style={{color:d.a2,fontWeight:700,fontSize:12}}>✓ done</span>:<span style={{color:d.t4,fontSize:11}}>{b.days-streak} to go</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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
                    <div className="card cp mb12">
                      <div className="cl mb10">last 8 weeks</div>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead>
                          <tr style={{borderBottom:`1px solid ${d.b}`}}>
                            <th style={{textAlign:"left",padding:"5px 4px",fontSize:9,color:d.t4,textTransform:"uppercase"}}>week of</th>
                            <th style={{textAlign:"right",padding:"5px 4px",fontSize:9,color:d.t4,textTransform:"uppercase"}}>days</th>
                            <th style={{textAlign:"right",padding:"5px 4px",fontSize:9,color:d.t4,textTransform:"uppercase"}}>hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({length:8},(_,i)=>{
                            const wStart=weekStartOf(addDays(today(),-7*(7-i)));
                            const wEnd=addDays(wStart,6);
                            const weekSessions=sessions.filter(s=>s.date>=wStart&&s.date<=wEnd);
                            const daysActive=new Set(weekSessions.map(s=>s.date)).size;
                            const hrs=weekSessions.reduce((a,s)=>a+s.duration,0);
                            const isCurrentWeek=i===7;
                            return(
                              <tr key={wStart} style={{borderBottom:`1px solid ${d.b}44`,background:isCurrentWeek?d.a1+"08":"transparent"}}>
                                <td style={{padding:"6px 4px",fontSize:11,color:isCurrentWeek?d.t:d.t3}}>{wStart.slice(5)}{isCurrentWeek?" (now)":""}</td>
                                <td style={{padding:"6px 4px",fontSize:11,color:daysActive>=5?d.a2:d.t3,textAlign:"right",fontWeight:daysActive>=5?700:400}}>{daysActive}/7</td>
                                <td style={{padding:"6px 4px",fontSize:11,color:d.t3,textAlign:"right"}}>{fmt(hrs)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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

            {/* ── MOCK SCORES + PASS PREDICTOR ── */}
            {tab==="mocks"&&(()=>{
              // CFA Industry benchmark: candidates who pass average ~70%+ on mocks
              // MPS (minimum passing score) estimated at 65% based on candidate surveys
              const MPS=65;
              const avgScore=mockScores.length?Math.round(mockScores.reduce((a,m)=>a+parseFloat(m.score||0),0)/mockScores.length):null;
              const latestScore=mockScores.length?parseFloat(mockScores[mockScores.length-1].score):null;
              // Trend: linear regression over scores
              let trend=null;
              if(mockScores.length>=3){
                const n=mockScores.length;
                const xs=mockScores.map((_,i)=>i);
                const ys=mockScores.map(m=>parseFloat(m.score||0));
                const xm=xs.reduce((a,b)=>a+b,0)/n;
                const ym=ys.reduce((a,b)=>a+b,0)/n;
                const slope=(xs.reduce((a,x,i)=>a+(x-xm)*(ys[i]-ym),0))/(xs.reduce((a,x)=>a+(x-xm)**2,0)||1);
                // Project to exam day
                const daysLeft2=examDate?Math.max(0,daysBetween(today(),examDate)):null;
                const weeksLeft=daysLeft2?(daysLeft2/7):null;
                const mockPerWeek=mockScores.length/(daysLeft2?Math.max(1,daysBetween(mockScores[0]?.date||today(),today())/7):1);
                const mocksLeft=weeksLeft?Math.round(weeksLeft*mockPerWeek):null;
                const projectedScore=mocksLeft?Math.min(100,Math.round(latestScore+slope*mocksLeft)):null;
                trend={slope:Math.round(slope*10)/10,projectedScore};
              }
              const passLikelihood=avgScore===null?null:avgScore>=MPS+10?"Strong Pass":avgScore>=MPS?"Likely Pass":avgScore>=MPS-5?"Borderline":"At Risk";
              const passColor=passLikelihood==="Strong Pass"?d.a2:passLikelihood==="Likely Pass"?d.a2:passLikelihood==="Borderline"?d.gold:d.danger;

              const subjectScores={};
              mockScores.forEach(m=>{
                if(m.weakTopics&&Array.isArray(m.weakTopics)){
                  m.weakTopics.forEach(t=>{subjectScores[t]=(subjectScores[t]||0)+1;});
                }
              });
              const weakestAreas=Object.entries(subjectScores).sort((a,b)=>b[1]-a[1]).slice(0,4);

              return(
                <div className="pin">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                    <div>
                      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,letterSpacing:"-.02em",marginBottom:4}}>Mock Scores</div>
                      <div style={{fontSize:12,color:d.t3}}>track every attempt. the trend tells the truth.</div>
                    </div>
                    <button onClick={()=>setShowMockForm(true)}
                      style={{padding:"9px 18px",borderRadius:8,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                      + log mock
                    </button>
                  </div>

                  {/* Add mock form */}
                  {showMockForm&&(
                    <div style={{position:"fixed",inset:0,zIndex:200,background:"rgba(10,10,15,.95)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
                      <div style={{width:"100%",maxWidth:440,background:d.card,borderRadius:16,padding:24,border:`1px solid ${d.b}`}}>
                        <div style={{fontSize:16,fontWeight:700,color:d.t,marginBottom:18}}>Log Mock Exam</div>
                        {[
                          {l:"Date",k:"date",type:"date"},
                          {l:"Provider",k:"provider",type:"select",opts:["Kaplan","Schweser","CFA Institute","AnalystPrep","Salt Solutions","Other"]},
                          {l:"Score (%)",k:"score",type:"number",placeholder:"e.g. 68"},
                          {l:"Notes",k:"notes",type:"text",placeholder:"what did you struggle with?"},
                        ].map(f=>(
                          <div key={f.k} style={{marginBottom:12}}>
                            <div style={{fontSize:11,color:d.t3,marginBottom:4,fontWeight:600}}>{f.l}</div>
                            {f.type==="select"?(
                              <select value={mockForm[f.k]} onChange={e=>setMockForm(p=>({...p,[f.k]:e.target.value}))}
                                style={{width:"100%",padding:"9px 12px",borderRadius:8,background:d.hover,border:`1px solid ${d.b}`,color:d.t,fontSize:13,fontFamily:"inherit"}}>
                                {f.opts.map(o=><option key={o}>{o}</option>)}
                              </select>
                            ):(
                              <input type={f.type} value={mockForm[f.k]} placeholder={f.placeholder||""} min={f.type==="number"?0:undefined} max={f.type==="number"?100:undefined}
                                onChange={e=>setMockForm(p=>({...p,[f.k]:e.target.value}))}
                                style={{width:"100%",padding:"9px 12px",borderRadius:8,background:d.hover,border:`1px solid ${d.b}`,color:d.t,fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
                            )}
                          </div>
                        ))}
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:11,color:d.t3,marginBottom:6,fontWeight:600}}>Weakest topics this mock</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                            {Object.keys(SUBJECT_COLORS).map(sub=>{
                              const sel=(mockForm.weakTopics||[]).includes(sub);
                              return(
                                <div key={sub} onClick={()=>setMockForm(p=>({...p,weakTopics:sel?(p.weakTopics||[]).filter(x=>x!==sub):[...(p.weakTopics||[]),sub]}))}
                                  style={{padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,
                                    background:sel?(SUBJECT_COLORS[sub]+"20"):d.hover,
                                    color:sel?SUBJECT_COLORS[sub]:d.t3,
                                    border:`1px solid ${sel?SUBJECT_COLORS[sub]:d.b}`}}>
                                  {sub}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:10}}>
                          <button onClick={()=>{
                            if(!mockForm.score)return;
                            const entry={...mockForm,id:Date.now(),date:mockForm.date||today()};
                            const next=[...mockScores,entry];
                            setMockScores(next);
                            if(authSession?.access_token&&user?.id){
                              fetch(`${SB_URL}/rest/v1/user_mocks`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({id:entry.id,user_id:user.id,data:entry})}).catch(()=>{});
                            }
                            setShowMockForm(false);
                            setMockForm({date:today(),provider:"Kaplan",score:"",notes:"",weakTopics:[]});
                          }} style={{flex:1,padding:"11px",borderRadius:8,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                            save
                          </button>
                          <button onClick={()=>setShowMockForm(false)}
                            style={{padding:"11px 18px",borderRadius:8,background:"none",color:d.t3,border:`1px solid ${d.b}`,cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>
                            cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {mockScores.length===0&&(
                    <div className="card empty">
                      <div style={{fontSize:28,marginBottom:10}}>📝</div>
                      <div className="et">no mocks logged yet</div>
                      <div className="es">log your first Kaplan or Schweser mock to see your pass prediction.</div>
                    </div>
                  )}

                  {mockScores.length>0&&(
                    <>
                      {/* Pass likelihood card */}
                      <div style={{padding:"20px 22px",background:d.card,border:`1px solid ${passColor}30`,borderRadius:14,marginBottom:16}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
                          <div>
                            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:d.t3,marginBottom:6}}>Pass Likelihood</div>
                            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:40,color:passColor,letterSpacing:"-.04em",lineHeight:1}}>{passLikelihood}</div>
                            <div style={{fontSize:11,color:d.t3,marginTop:6,fontStyle:"italic"}}>
                              CFA benchmark: ~{MPS}%+ on standardised mocks correlates with passing.
                              {trend?.projectedScore&&` At your current trend you'll hit ${trend.projectedScore}% by exam day.`}
                            </div>
                          </div>
                          <div style={{display:"flex",gap:16}}>
                            <div style={{textAlign:"center"}}>
                              <div style={{fontSize:28,fontWeight:700,color:passColor,fontFamily:"'DM Serif Display',serif"}}>{avgScore}%</div>
                              <div style={{fontSize:9,color:d.t3,marginTop:2,textTransform:"uppercase"}}>avg score</div>
                            </div>
                            <div style={{textAlign:"center"}}>
                              <div style={{fontSize:28,fontWeight:700,color:d.t,fontFamily:"'DM Serif Display',serif"}}>{latestScore}%</div>
                              <div style={{fontSize:9,color:d.t3,marginTop:2,textTransform:"uppercase"}}>latest</div>
                            </div>
                            {trend&&<div style={{textAlign:"center"}}>
                              <div style={{fontSize:28,fontWeight:700,color:trend.slope>=0?d.a2:d.danger,fontFamily:"'DM Serif Display',serif"}}>
                                {trend.slope>=0?"+":""}{trend.slope}%
                              </div>
                              <div style={{fontSize:9,color:d.t3,marginTop:2,textTransform:"uppercase"}}>per mock</div>
                            </div>}
                          </div>
                        </div>
                        {/* Score bar vs MPS */}
                        <div style={{marginTop:16}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:d.t3,marginBottom:4}}>
                            <span>0%</span>
                            <span style={{color:d.gold}}>MPS ~{MPS}%</span>
                            <span>100%</span>
                          </div>
                          <div style={{height:8,background:d.b,borderRadius:4,position:"relative",overflow:"hidden"}}>
                            <div style={{position:"absolute",left:MPS+"%",top:0,bottom:0,width:2,background:d.gold,zIndex:1}}/>
                            <div style={{height:"100%",width:(avgScore||0)+"%",background:`linear-gradient(90deg,${d.danger},${d.gold},${d.a2})`,borderRadius:4,transition:"width .8s"}}/>
                          </div>
                        </div>
                      </div>

                      {/* Weakest areas */}
                      {weakestAreas.length>0&&(
                        <div style={{padding:"14px 18px",background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:16}}>
                          <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:10}}>Your weak spots (across all mocks)</div>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                            {weakestAreas.map(([sub,count])=>(
                              <div key={sub} style={{padding:"5px 12px",borderRadius:6,background:(SUBJECT_COLORS[sub]||d.a1)+"18",color:SUBJECT_COLORS[sub]||d.a1,fontSize:11,fontWeight:700}}>
                                {sub} <span style={{opacity:.7}}>×{count}</span>
                              </div>
                            ))}
                          </div>
                          <div style={{fontSize:11,color:d.t3,marginTop:10,fontStyle:"italic"}}>these show up most often in your weak topics. prioritise them in revision.</div>
                        </div>
                      )}

                      {/* Score history */}
                      <div style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:16,overflow:"hidden"}}>
                        <div style={{padding:"14px 18px",borderBottom:`1px solid ${d.b}`,fontSize:12,fontWeight:700,color:d.t}}>Score History</div>
                        {/* Bar chart */}
                        <div style={{padding:"16px 18px",display:"flex",gap:6,alignItems:"flex-end",height:120}}>
                          {mockScores.map((m,i)=>{
                            const pct=parseFloat(m.score)||0;
                            const col=pct>=MPS+10?d.a2:pct>=MPS?d.a2:pct>=MPS-5?d.gold:d.danger;
                            return(
                              <div key={m.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                                <div style={{fontSize:9,color:col,fontWeight:700}}>{pct}%</div>
                                <div style={{width:"100%",background:col,borderRadius:"3px 3px 0 0",height:Math.max(4,(pct/100)*80)+"px",transition:"height .5s",position:"relative"}}>
                                  {pct>=MPS&&<div style={{position:"absolute",inset:0,background:"rgba(255,255,255,.1)",borderRadius:"3px 3px 0 0"}}/>}
                                </div>
                                <div style={{fontSize:8,color:d.t4}}>{m.provider?.slice(0,3)}</div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Table */}
                        {[...mockScores].reverse().map((m,i)=>(
                          <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 18px",borderTop:`1px solid ${d.b}`}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,fontWeight:600,color:d.t}}>{m.provider}</div>
                              <div style={{fontSize:10,color:d.t3}}>{m.date}{m.notes&&" · "+m.notes}</div>
                            </div>
                            <div style={{fontSize:18,fontWeight:700,fontFamily:"'DM Serif Display',serif",
                              color:parseFloat(m.score)>=MPS?d.a2:parseFloat(m.score)>=MPS-5?d.gold:d.danger}}>
                              {m.score}%
                            </div>
                            <button onClick={()=>setMockScores(prev=>prev.filter(x=>x.id!==m.id))}
                              style={{background:"none",border:"none",color:d.t4,cursor:"pointer",fontSize:14,padding:"2px 6px"}}>×</button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

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
                      <div style={{fontSize:12,color:d.t3}}>{roadmap.totalDays} days · {roadmap.weeks?.length||0} study weeks{roadmap.revisionDays>0?` · last ${roadmap.revisionDays} day${roadmap.revisionDays!==1?"s":""} = revision`:""}</div>
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
                    const weekMins=week.days.flatMap(dd=>dd.items).reduce((a,it)=>a+(it.durationMins||60),0);
                    return(
                      <div key={week.weekNum} style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:14,overflow:"hidden"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:d.hover,borderBottom:`1px solid ${d.b}`,flexWrap:"wrap",gap:8}}>
                          <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                            <div style={{fontSize:13,fontWeight:700,color:d.t}}>Week {week.weekNum}</div>
                            <div style={{fontSize:10,color:d.t3}}>~{fmt(weekMins)}</div>
                          </div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            {weekTopics.map(s=><span key={s} style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:(SUBJECT_COLORS[s]||d.a1)+"18",color:SUBJECT_COLORS[s]||d.a1,fontWeight:700}}>{s}</span>)}
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:1,background:d.b}}>
                          {week.days.map(dd=>{
                            const dayMins=dd.items.reduce((a,it)=>a+(it.durationMins||60),0);
                            return(
                            <div key={dd.date} style={{background:d.card,padding:"10px 10px",minHeight:80}}>
                              <div style={{fontSize:10,fontWeight:700,color:d.t3,marginBottom:6}}>{dayName(dd.date)} <span style={{color:d.t4}}>{dd.date.slice(5)}</span>{dayMins>0&&<span style={{color:d.a2,fontWeight:600}}> · {fmt(dayMins)}</span>}</div>
                              {dd.items.length===0?(
                                <div style={{fontSize:10,color:dd.dayType==="revision"?d.gold:d.t4,fontStyle:"italic",padding:"3px 6px"}}>
                                  {dd.dayType==="revision"?"revision — syllabus done, review time":"rest day"}
                                </div>
                              ):(()=>{
                                // Same-topic passes scheduled on the same day (e.g. a 1.5h/day
                                // plan chunked into three 30-min blocks of one topic) used to
                                // render as separate near-identical rows — "Code of Ethics
                                // (0.5h/11h)", "(1h/11h)", "(1.5h/11h)" stacked on top of each
                                // other. Merge them into one row per topic per day: combined
                                // duration, and the cumulative "X of Yh" read off the highest-pass
                                // entry so it still reflects real progress.
                                const groups=new Map();
                                for(const it of dd.items){
                                  const gk=it.subject+"|"+it.topic;
                                  if(!groups.has(gk))groups.set(gk,[]);
                                  groups.get(gk).push(it);
                                }
                                return Array.from(groups.values()).map((g,i)=>{
                                  const sorted=[...g].sort((a,b)=>(a.pass||0)-(b.pass||0));
                                  const last=sorted[sorted.length-1];
                                  const totalDuration=sorted.reduce((s,it)=>s+(it.durationMins||0),0);
                                  const cumulativeMins=(last.pass||1)*(last.durationMins||30);
                                  const done=sorted.every(p=>roadmapDone[itemKey(dd.date,p)]);
                                  return(
                                    <div key={i} onClick={()=>{
                                        sorted.forEach(p=>{
                                          const already=!!roadmapDone[itemKey(dd.date,p)];
                                          if(done?already:!already) toggleRoadmapItem(dd.date,p);
                                        });
                                      }} title={last.topic}
                                      style={{fontSize:10,color:done?d.t4:d.t2,padding:"3px 6px",marginBottom:2,background:done?d.hover:(SUBJECT_COLORS[last.subject]||d.a1)+"10",borderRadius:4,borderLeft:`2px solid ${SUBJECT_COLORS[last.subject]||d.a1}`,cursor:"pointer",lineHeight:1.3,textDecoration:done?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                      {last.topic}{last.totalPasses>1&&<span style={{fontWeight:800,color:done?d.t4:d.a1}}> ({Math.round((cumulativeMins/60)*10)/10}h/{last.topicHours||"?"}h)</span>}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          );})}
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
                  const r=await fetch(`${SB_URL}/rest/v1/profiles?je_class=eq.${jeClass}&id=neq.${user?.id}&select=id,username,display_name,avatar_url,je_class&limit=20`,
                    {headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession?.access_token||""}`}});
                  if(!r.ok){showToast("couldn't load partner candidates.");setPartnerLoading(false);return;}
                  const d2=await r.json();
                  if(Array.isArray(d2))setPartnerResults(d2);
                }catch(e){showToast("couldn't load partner candidates.");}
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
                            <div style={{fontSize:11,color:d.t3}}>@{p.username} · {CLASSES.find(c=>c.id===p.je_class)?.label||p.je_class}</div>
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
              // Weekly target is just the user's own chosen pace (daily hours × study days/week) —
              // not re-derived from total plan length. That derived version mixed hour-units with
              // minute-units (off by a factor of 60) AND barely varied between users since it
              // depended mostly on the fixed default target/plan-length ratio, which is why every
              // student was seeing almost the same "behind" number regardless of their own goals.
              // Use the ROUNDED daily hours here — the same figure the scheduler actually builds
              // the roadmap around and the same figure shown as "your daily target" elsewhere.
              // Using the raw unrounded dailyStudyHours (e.g. 1.4h) produced a weekly target that
              // didn't match anything else in the app (1.4×7=9.8h instead of the real 1.5×7=10.5h).
              const weeklyTargetHrs=Math.round(roundedDailyHours(dailyStudyHours||0)*(studyDays?.length||0)*10)/10;
              const weeklyTargetMins=weeklyTargetHrs*60;
              const behindHrs=Math.max(0,Math.round((weeklyTargetMins-thisWeekMins)/60*10)/10);
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

              // Day-by-day breakdown for the current week (Mon–Sun), for the new bar chart below.
              const weekDayMins=[0,1,2,3,4,5,6].map(i=>{
                const dt=addDays(thisWeekStart,i);
                const mins=sessions.filter(s=>s.date===dt).reduce((a,s)=>a+(s.duration||0),0);
                return {date:dt,mins,label:new Date(dt+"T00:00:00").toLocaleDateString("en-IN",{weekday:"short"}),isToday:dt===today(),isFuture:dt>today()};
              });
              const maxDayMins=Math.max(60,...weekDayMins.map(w=>w.mins)); // floor of 1h so bars aren't invisible on light weeks

              // Last 6 weeks (oldest → newest, this week last) — the actual "progress" view, since
              // day-to-day is noisy but a 6-week trend shows whether the pace is really improving.
              const weekTrend=[5,4,3,2,1,0].map(n=>{
                const wkStart=addDays(thisWeekStart,-7*n);
                const wkEndExclusive=n===0?addDays(today(),1):addDays(wkStart,7);
                const mins=sessions.filter(s=>s.date>=wkStart&&s.date<wkEndExclusive).reduce((a,s)=>a+(s.duration||0),0);
                return {label:n===0?"this wk":new Date(wkStart+"T00:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short"}),hrs:Math.round(mins/60*10)/10,isCurrent:n===0};
              });
              const maxTrendHrs=Math.max(1,...weekTrend.map(w=>w.hrs));

              return(
                <div className="pin" style={{width:"100%",boxSizing:"border-box"}}>
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

                  {/* Daily breakdown — this week, Mon–Sun */}
                  <div style={{padding:"18px 20px",background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:16}}>
                    <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:16}}>This week, day by day</div>
                    <div style={{display:"flex",alignItems:"flex-end",gap:8,height:110}}>
                      {weekDayMins.map(w=>(
                        <div key={w.date} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%",minWidth:0}}>
                          {w.mins>0&&<div style={{fontSize:9,color:d.t3,marginBottom:4,fontWeight:600}}>{Math.round(w.mins/60*10)/10}h</div>}
                          <div style={{width:"100%",maxWidth:28,height:`${w.isFuture?0:Math.max(w.mins>0?6:2,(w.mins/maxDayMins)*76)}px`,background:w.isToday?d.a1:w.isFuture?"transparent":w.mins>0?d.a3:d.b,border:w.isFuture?`1px dashed ${d.b}`:"none",borderRadius:3,transition:"height .4s"}}/>
                          <div style={{fontSize:9.5,color:w.isToday?d.a1:d.t4,fontWeight:w.isToday?700:400,marginTop:6}}>{w.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 6-week trend — the actual "am I improving" view; day-to-day is too noisy for that */}
                  <div style={{padding:"18px 20px",background:d.card,border:`1px solid ${d.b}`,borderRadius:12,marginBottom:16}}>
                    <div style={{fontSize:12,fontWeight:700,color:d.t,marginBottom:16}}>Last 6 weeks</div>
                    <div style={{display:"flex",alignItems:"flex-end",gap:8,height:110}}>
                      {weekTrend.map((w,wi)=>(
                        <div key={wi} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%",minWidth:0}}>
                          {w.hrs>0&&<div style={{fontSize:9,color:d.t3,marginBottom:4,fontWeight:600}}>{w.hrs}h</div>}
                          <div style={{width:"100%",maxWidth:32,height:`${Math.max(w.hrs>0?6:2,(w.hrs/maxTrendHrs)*76)}px`,background:w.isCurrent?d.a1:d.a3+"90",borderRadius:3,transition:"height .4s"}}/>
                          <div style={{fontSize:9,color:w.isCurrent?d.a1:d.t4,fontWeight:w.isCurrent?700:400,marginTop:6,textAlign:"center"}}>{w.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

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

      {/* ── Toast (was previously state-only with no UI — errors were being set but never shown) ── */}
      {toast&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:10001,
          background:d.card,border:`1px solid ${d.b}`,borderRadius:10,padding:"12px 20px",
          boxShadow:"0 8px 24px rgba(0,0,0,.35)",fontSize:13,color:d.t,maxWidth:"90vw",textAlign:"center"}}>
          {toast}
        </div>
      )}

      {/* ── Streak milestone celebration ── */}
      {celebrateMilestone&&(
        <div style={{position:"fixed",inset:0,zIndex:10002,background:"rgba(10,10,15,.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setCelebrateMilestone(null)}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:d.card,border:`1.5px solid ${d.a1}`,borderRadius:20,padding:"40px 32px",textAlign:"center",maxWidth:340,boxShadow:`0 0 60px ${d.a1}40`}}>
            <div style={{fontSize:56,marginBottom:10,animation:"celebrate-bounce .6s ease"}}>{celebrateMilestone.icon}</div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:d.t,marginBottom:6}}>{celebrateMilestone.label}!</div>
            <div style={{fontSize:13,color:d.t3,marginBottom:24}}>
              {celebrateMilestone.days} day{celebrateMilestone.days!==1?"s":""} in a row. keep the chain going — one skipped day and it's back to zero.
            </div>
            <button onClick={()=>setCelebrateMilestone(null)}
              style={{padding:"11px 28px",borderRadius:10,background:d.a1,color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit"}}>
              let's go →
            </button>
          </div>
          <style>{"@keyframes celebrate-bounce{0%{transform:scale(0.3);opacity:0;}50%{transform:scale(1.15);}100%{transform:scale(1);opacity:1;}}"}</style>
        </div>
      )}
    </>
  );
}
