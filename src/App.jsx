import { useState, useEffect, useRef, useCallback } from "react";
const SB_URL  = import.meta.env.VITE_SB_URL;
const SB_ANON = import.meta.env.VITE_SB_ANON;
const OR_KEY  = import.meta.env.VITE_OR_KEY;
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
    localStorage.removeItem("cfa_auth");
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




// ── Shared Select ─────────────────────────────────────────────────────────────
function Select({value,onChange,options,placeholder,disabled,d,minWidth}){
  return(
    <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}
      style={{background:d?d.inp:"#0d0f18",border:`1px solid ${d?d.inpb:"rgba(180,185,220,0.12)"}`,
        color:d?d.t:"#eef0f8",borderRadius:4,padding:"7px 10px",fontSize:13,
        fontFamily:"inherit",cursor:"pointer",minWidth:minWidth||120,outline:"none"}}>
      {placeholder&&<option value="">{placeholder}</option>}
      {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
    </select>
  );
}

const SUB_C = SUBJECT_COLORS;
const SUB_EMOJI = {
  "Ethics & Standards":"⚖️","Quantitative Methods":"📊","Economics":"🌐",
  "Financial Reporting":"📑","Corporate Issuers":"🏢","Equity Investments":"📈",
  "Fixed Income":"🏦","Derivatives":"⚙️","Alternative Investments":"🔷","Portfolio Management":"💼",
};



// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL — Home · Network · Rankings · Events · Search · Profile
// Premium CFA candidate social layer
// ─────────────────────────────────────────────────────────────────────────────

function sbFetch(SB_URL, SB_ANON, path, opts = {}) {
  const token = opts.token || SB_ANON;
  const { token: _t, prefer, ...rest } = opts;
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: SB_ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: prefer || "",
      ...(opts.headers || {}),
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const AV_PALETTE = ["#c9a84c","#4a8fc4","#7b6fb5","#4aab8a","#c97a4a","#5a9fb5","#8f7ab5","#b54a6a"];
function avColor(str) {
  if (!str) return AV_PALETTE[0];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AV_PALETTE[Math.abs(h) % AV_PALETTE.length];
}
function sInitials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}
function sAgo(iso) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const day = Math.floor(h / 24);
  return day < 7 ? `${day}d` : new Date(iso).toLocaleDateString("en-GB", { day:"numeric", month:"short" });
}
function sFmtS(s) {
  if (!s || s <= 0) return "0m";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m > 0 ? m + "m" : ""}`.trim() : `${m}m`;
}
const CFA_TOPICS_LIST = Object.keys(SUBJECT_COLORS);

// ── Avatar ────────────────────────────────────────────────────────────────────
function SAv({ name, url, size = 36, d, onClick, ring = false }) {
  const bg = avColor(name);
  const base = {
    width: size, height: size, borderRadius: "50%", background: bg, color: "#fff",
    flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: Math.round(size * 0.38), fontWeight: 700,
    ...(ring ? { outline: `2.5px solid ${bg}`, outlineOffset: 2 } : {}),
  };
  const img = url
    ? <img src={url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
    : sInitials(name);
  if (onClick) return (
    <button onClick={onClick} style={{ background:"none", border:"none", padding:0, cursor:"pointer", flexShrink:0, borderRadius:"50%", display:"inline-flex" }}>
      <div style={base}>{img}</div>
    </button>
  );
  return <div style={base}>{img}</div>;
}

// ── Username setup modal ──────────────────────────────────────────────────────
function UsernameSetupModal({ user, d, SB_URL, SB_ANON, accessToken, onDone }) {
  const [handle, setHandle] = useState("");
  const [state, setState] = useState("idle");
  const debounceRef = useRef(null);

  function onType(v) {
    const clean = v.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24);
    setHandle(clean);
    setState("idle");
    if (clean.length < 3) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setState("checking");
      const r = await sbFetch(SB_URL, SB_ANON, `profiles?handle=eq.${clean}&select=id`);
      const rows = r.ok ? await r.json() : [];
      setState(rows.length > 0 ? "taken" : "ok");
    }, 350);
  }

  async function save() {
    if (state !== "ok") return;
    await sbFetch(SB_URL, SB_ANON, "profiles", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal", token: accessToken,
      body: JSON.stringify({ id: user.id, display_name: user.name, handle, avatar_url: user.avatar || null }),
    });
    onDone(handle);
  }

  const borderC = state === "ok" ? d.a2 : state === "taken" ? d.danger : d.b;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:999, background:"rgba(0,0,0,.8)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:10, padding:"36px 30px", width:"100%", maxWidth:380, textAlign:"center" }}>
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:".18em", textTransform:"uppercase", color:d.a1, marginBottom:20 }}>CharterRun</div>
        <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:24, color:d.t, marginBottom:8 }}>pick your @handle.</div>
        <div style={{ fontSize:13, color:d.t3, marginBottom:28, lineHeight:1.65 }}>this is how fellow candidates find you. choose wisely.</div>
        <div style={{ position:"relative", marginBottom:10 }}>
          <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:d.t3, fontSize:14, pointerEvents:"none" }}>@</span>
          <input value={handle} onChange={e => onType(e.target.value)} onKeyDown={e => e.key === "Enter" && save()}
            placeholder="your_handle" maxLength={24}
            style={{ width:"100%", boxSizing:"border-box", padding:"11px 14px 11px 32px", border:`1.5px solid ${borderC}`, borderRadius:5, background:d.inp, color:d.t, fontFamily:"inherit", fontSize:14, outline:"none", transition:"border-color .15s" }} />
          {state === "checking" && <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:11, color:d.t3 }}>…</span>}
          {state === "ok"       && <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:15, color:d.a2 }}>✓</span>}
          {state === "taken"    && <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", fontSize:11, color:d.danger }}>taken</span>}
        </div>
        <div style={{ fontSize:10.5, color:d.t4, marginBottom:22 }}>3–24 chars · letters, numbers, _ and . only</div>
        <button onClick={save} disabled={state !== "ok"}
          style={{ width:"100%", padding:"12px", borderRadius:5, border:"none", background:state==="ok"?d.a1:d.b, color:state==="ok"?"#fff":d.t4, fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:state==="ok"?"pointer":"not-allowed", transition:"all .15s", letterSpacing:".03em" }}>
          confirm handle →
        </button>
      </div>
    </div>
  );
}

// ── HomeGate — username check + routes to correct social view ─────────────────
function HomeGate({ user, d, dark, SB_URL, SB_ANON, accessToken, sessions, streak, fmt, today, view }) {
  const [myHandle, setMyHandle] = useState(null);
  const [checked, setChecked] = useState(false);
  const [profileUid, setProfileUid] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    sbFetch(SB_URL, SB_ANON, `profiles?id=eq.${user.id}&select=handle`)
      .then(r => r.ok ? r.json() : [])
      .then(rows => { setMyHandle(rows[0]?.handle || null); setChecked(true); });
  }, [user?.id]);

  function openProfile(uid) { setProfileUid(uid); }
  function closeProfile() { setProfileUid(null); }

  if (!checked) return <div style={{ padding:40, textAlign:"center", color:d.t3, fontSize:13, fontStyle:"italic" }}>loading…</div>;
  if (!myHandle) return <UsernameSetupModal user={user} d={d} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={accessToken} onDone={h => setMyHandle(h)} />;

  const props = { user, d, SB_URL, SB_ANON, accessToken, sessions, streak, fmt, today, myHandle, onOpenProfile: openProfile };

  if (profileUid) return (
    <div style={{ maxWidth:680, margin:"0 auto" }}>
      <SProfileView {...props} viewingUid={profileUid} isOwn={profileUid === user?.id} onBack={closeProfile} />
    </div>
  );

  return (
    <div style={{ maxWidth:680, margin:"0 auto" }}>
      {view === "home"        && <SHomeView        {...props} />}
      {view === "friends"     && <SFriendsView     {...props} />}
      {view === "leaderboard" && <SLeaderboardView {...props} />}
      {view === "events"      && <SEventsView      {...props} />}
    </div>
  );
}

// ── Post Card ─────────────────────────────────────────────────────────────────
function SPostCard({ post, user, d, onKudos, onOpenProfile, onRefresh, SB_URL, SB_ANON, accessToken }) {
  const profile = post.profiles || {};
  const sc = SUBJECT_COLORS[post.subject] || d.a1;
  const isOwn = post.user_id === user?.id;
  const [showMenu, setShowMenu] = useState(false);

  async function deletePost() {
    await sbFetch(SB_URL, SB_ANON, `social_posts?id=eq.${post.id}&user_id=eq.${user.id}`, { method:"DELETE", token:accessToken });
    onRefresh?.();
  }

  return (
    <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, marginBottom:10, overflow:"hidden" }}>
      {/* Gold accent bar for high-weight topics */}
      {CFA_WEIGHTAGE[post.subject] === "H" && (
        <div style={{ height:2, background:`linear-gradient(90deg,${sc},${sc}30)` }} />
      )}
      {/* Header */}
      <div style={{ padding:"13px 15px 10px", display:"flex", alignItems:"center", gap:10 }}>
        <SAv name={profile.display_name} url={profile.avatar_url} size={36} d={d} onClick={() => onOpenProfile(post.user_id)} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
            <button onClick={() => onOpenProfile(post.user_id)} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700, color:d.t, padding:0 }}>
              {profile.display_name || "Candidate"}
            </button>
            {profile.handle && <span style={{ fontSize:10.5, color:d.t4 }}>@{profile.handle}</span>}
            <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:`${sc}18`, color:sc, letterSpacing:".02em" }}>
              {SUB_EMOJI[post.subject] || "📚"} {post.subject}
            </span>
          </div>
          <div style={{ fontSize:10.5, color:d.t4, marginTop:1 }}>{sAgo(post.created_at)}</div>
        </div>
        {isOwn && (
          <div style={{ position:"relative" }}>
            <button onClick={() => setShowMenu(v => !v)} style={{ background:"none", border:"none", color:d.t4, cursor:"pointer", fontSize:18, padding:"2px 6px" }}>⋯</button>
            {showMenu && (
              <div style={{ position:"absolute", right:0, top:"100%", zIndex:20, background:d.card, border:`1px solid ${d.b}`, borderRadius:6, padding:4, boxShadow:"0 8px 30px rgba(0,0,0,.25)", minWidth:110 }}>
                <button onClick={deletePost} style={{ display:"block", width:"100%", padding:"8px 12px", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, color:d.danger, textAlign:"left" }}>delete post</button>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Content */}
      <div style={{ padding:"0 15px 12px" }}>
        <div style={{ fontSize:14, fontWeight:600, color:d.t, marginBottom:post.notes ? 6 : 10, lineHeight:1.4 }}>{post.title}</div>
        {post.notes && <div style={{ fontSize:12.5, color:d.t2, lineHeight:1.75, marginBottom:10 }}>{post.notes}</div>}
        <div style={{ display:"flex", gap:6 }}>
          {[
            { label:"Duration", val:sFmtS(post.duration_seconds) },
            { label:"Questions", val:post.problems_solved ?? "—" },
            { label:"Accuracy",  val:post.accuracy_pct != null ? `${post.accuracy_pct}%` : "—" },
          ].map(s => (
            <div key={s.label} style={{ flex:1, textAlign:"center", background:d.hover, borderRadius:4, padding:"7px 4px", border:`1px solid ${d.b}` }}>
              <div style={{ fontSize:14, fontWeight:700, color:d.t, letterSpacing:"-.01em" }}>{s.val}</div>
              <div style={{ fontSize:9, color:d.t4, textTransform:"uppercase", letterSpacing:".07em", marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Actions */}
      <div style={{ padding:"9px 15px", borderTop:`1px solid ${d.b}`, display:"flex", alignItems:"center", gap:4, background:d.hover }}>
        <button onClick={onKudos} disabled={isOwn} style={{
          display:"flex", alignItems:"center", gap:5, padding:"5px 9px", border:"none",
          background: post.kudos_given ? `${d.danger}12` : "transparent", borderRadius:4,
          fontFamily:"inherit", fontSize:12, color:post.kudos_given ? d.danger : d.t3,
          cursor:isOwn ? "default" : "pointer", opacity:isOwn ? .4 : 1, transition:"all .12s",
        }}>
          <span style={{ fontSize:15, lineHeight:1 }}>{post.kudos_given ? "♥" : "♡"}</span>
          {post.kudos_count} {post.kudos_count === 1 ? "kudo" : "kudos"}
        </button>
        <span style={{ marginLeft:"auto", fontSize:10.5, color:d.t4 }}>{sAgo(post.created_at)}</span>
      </div>
    </div>
  );
}

// ── Post Composer ─────────────────────────────────────────────────────────────
function SPostComposer({ user, d, SB_URL, SB_ANON, accessToken, onPosted }) {
  const [form, setForm] = useState({ title:"", subject:CFA_TOPICS_LIST[0], dur:"", problems:"", accuracy:"", notes:"" });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.title.trim() || !user?.id) return;
    setSaving(true);
    await sbFetch(SB_URL, SB_ANON, "profiles", {
      method:"POST", prefer:"resolution=merge-duplicates,return=minimal", token:accessToken,
      body: JSON.stringify({ id:user.id, display_name:user.name, avatar_url:user.avatar||null }),
    });
    await sbFetch(SB_URL, SB_ANON, "social_posts", {
      method:"POST", prefer:"return=minimal", token:accessToken,
      body: JSON.stringify({
        user_id:user.id, title:form.title.trim(), subject:form.subject,
        duration_seconds: form.dur ? parseInt(form.dur)*60 : null,
        problems_solved: form.problems ? parseInt(form.problems) : null,
        accuracy_pct: form.accuracy ? parseInt(form.accuracy) : null,
        notes: form.notes.trim() || null,
      }),
    });
    setSaving(false);
    onPosted();
  }

  const inp = { padding:"8px 11px", border:`1px solid ${d.b}`, borderRadius:4, background:d.inp, color:d.t, fontFamily:"inherit", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" };

  return (
    <div>
      <input style={{ ...inp, marginBottom:8 }} placeholder="what did you study? e.g. Fixed Income — duration and convexity"
        value={form.title} onChange={e => setForm(f => ({ ...f, title:e.target.value }))} />
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr", gap:7, marginBottom:8 }}>
        <select style={{ ...inp, cursor:"pointer" }} value={form.subject} onChange={e => setForm(f => ({ ...f, subject:e.target.value }))}>
          {CFA_TOPICS_LIST.map(t => <option key={t}>{t}</option>)}
        </select>
        <input style={inp} type="number" min="1" placeholder="Mins" value={form.dur} onChange={e => setForm(f => ({ ...f, dur:e.target.value }))} />
        <input style={inp} type="number" min="0" placeholder="Questions" value={form.problems} onChange={e => setForm(f => ({ ...f, problems:e.target.value }))} />
        <input style={inp} type="number" min="0" max="100" placeholder="Acc %" value={form.accuracy} onChange={e => setForm(f => ({ ...f, accuracy:e.target.value }))} />
      </div>
      <textarea style={{ ...inp, resize:"vertical", minHeight:52, marginBottom:10 }}
        placeholder="any insights? what clicked, what didn't?"
        value={form.notes} onChange={e => setForm(f => ({ ...f, notes:e.target.value }))} />
      <div style={{ display:"flex", justifyContent:"flex-end" }}>
        <button className="btn btn-d" onClick={submit} disabled={saving || !form.title.trim()}
          style={{ fontSize:12, opacity:saving || !form.title.trim() ? .4 : 1, letterSpacing:".03em" }}>
          {saving ? "posting…" : "post session →"}
        </button>
      </div>
    </div>
  );
}

// ── Skeleton loaders ──────────────────────────────────────────────────────────
function SSkeletonFeed({ d }) {
  return (
    <div>
      {[1,2,3].map(i => (
        <div key={i} style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, marginBottom:10, padding:"14px 15px" }}>
          <div style={{ display:"flex", gap:10, marginBottom:12 }}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:d.b, flexShrink:0 }}/>
            <div style={{ flex:1 }}>
              <div className="shim" style={{ height:10, width:"45%", marginBottom:6 }}/>
              <div className="shim" style={{ height:8, width:"28%" }}/>
            </div>
          </div>
          <div className="shim" style={{ height:12, width:"70%", marginBottom:10 }}/>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
            {[1,2,3].map(j => <div key={j} className="shim" style={{ height:42 }}/>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function SEmptySlate({ d, icon, title, sub }) {
  return (
    <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, textAlign:"center", padding:"48px 24px" }}>
      <div style={{ fontSize:32, marginBottom:12 }}>{icon}</div>
      <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:18, color:d.t, marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:13, color:d.t3, lineHeight:1.65 }}>{sub}</div>
    </div>
  );
}

function SSuggestRow({ s, d, isFollowing, onFollow, onOpenProfile }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
      <SAv name={s.display_name} url={s.avatar_url} size={32} d={d} onClick={() => onOpenProfile(s.id)} />
      <div style={{ flex:1, minWidth:0 }}>
        <button onClick={() => onOpenProfile(s.id)} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600, color:d.t, padding:0, textAlign:"left", display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"100%" }}>
          {s.display_name}
        </button>
        <div style={{ fontSize:10.5, color:d.t3 }}>{s.handle ? `@${s.handle}` : ""}{s.target_college ? ` · ${s.target_college}` : ""}</div>
      </div>
      {!isFollowing && (
        <button onClick={onFollow} style={{ fontSize:10, fontWeight:700, padding:"4px 10px", borderRadius:3, background:`${d.a1}15`, color:d.a1, border:`1px solid ${d.a1}30`, cursor:"pointer", fontFamily:"inherit", flexShrink:0, letterSpacing:".03em" }}>
          follow
        </button>
      )}
    </div>
  );
}

// ── Home View — global feed ────────────────────────────────────────────────────
function SHomeView({ user, d, SB_URL, SB_ANON, accessToken, sessions, streak, fmt, today, myHandle, onOpenProfile }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [topStudiers, setTopStudiers] = useState([]);
  const todayMins = sessions.filter(s => s.date === today()).reduce((a, s) => a + s.duration, 0);

  useEffect(() => { fetchHome(); }, []);

  async function fetchHome() {
    setLoading(true);
    const pr = await sbFetch(SB_URL, SB_ANON,
      `social_posts?select=*,social_kudos(user_id),profiles:user_id(id,display_name,handle,avatar_url)&order=created_at.desc&limit=50`
    );
    const raw = pr.ok ? await pr.json() : [];
    setPosts(raw.map(p => ({
      ...p,
      kudos_count: (p.social_kudos || []).length,
      kudos_given: (p.social_kudos || []).some(k => k.user_id === user?.id),
    })));
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const tr = await sbFetch(SB_URL, SB_ANON,
      `social_posts?select=user_id,duration_seconds,profiles:user_id(id,display_name,avatar_url)&created_at=gte.${todayStart.toISOString()}&limit=100`
    );
    const td = tr.ok ? await tr.json() : [];
    const map = {};
    td.forEach(p => {
      if (!p.profiles) return;
      if (!map[p.user_id]) map[p.user_id] = { profile:p.profiles, secs:0 };
      map[p.user_id].secs += p.duration_seconds || 0;
    });
    setTopStudiers(Object.values(map).sort((a,b) => b.secs - a.secs).slice(0, 10));
    setLoading(false);
  }

  async function toggleKudos(post) {
    if (!user?.id || post.user_id === user.id) return;
    if (post.kudos_given) {
      await sbFetch(SB_URL, SB_ANON, `social_kudos?post_id=eq.${post.id}&user_id=eq.${user.id}`, { method:"DELETE", token:accessToken });
    } else {
      await sbFetch(SB_URL, SB_ANON, "social_kudos", { method:"POST", prefer:"return=minimal", token:accessToken, body: JSON.stringify({ post_id:post.id, user_id:user.id }) });
    }
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, kudos_given:!p.kudos_given, kudos_count:p.kudos_count+(p.kudos_given?-1:1) } : p));
  }

  return (
    <div>
      {/* Compose bar — always visible */}
      <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, marginBottom:12, overflow:"hidden" }}>
        <div style={{ padding:"11px 14px", display:"flex", alignItems:"center", gap:10 }}>
          <SAv name={user?.name} url={user?.avatar} size={34} d={d} />
          <button onClick={() => setShowCompose(v => !v)} style={{
            flex:1, padding:"9px 14px", background:d.hover,
            border:`1.5px solid ${showCompose ? d.a1 : d.b}`,
            borderRadius:4, color:showCompose ? d.t : d.t3,
            fontSize:12.5, fontFamily:"inherit", cursor:"pointer", textAlign:"left", transition:"all .15s",
          }}>
            {showCompose ? "▲ close" : `log a study session, @${myHandle}…`}
          </button>
          <button onClick={() => setShowCompose(v => !v)} style={{
            width:34, height:34, borderRadius:"50%",
            background:showCompose ? d.danger : d.a1,
            border:"none", color:"#fff", fontSize:20, lineHeight:1,
            cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all .15s",
          }}>{showCompose ? "×" : "+"}</button>
        </div>
        {showCompose && (
          <div style={{ padding:"0 14px 14px", borderTop:`1px solid ${d.b}`, paddingTop:12, animation:"selIn .15s ease" }}>
            <SPostComposer user={user} d={d} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={accessToken}
              onPosted={() => { setShowCompose(false); fetchHome(); }} />
          </div>
        )}
      </div>

      {/* Story row */}
      {topStudiers.length > 0 && (
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", gap:14, overflowX:"auto", paddingBottom:6, scrollbarWidth:"none" }}>
            {topStudiers.map(({ profile, secs }) => (
              <div key={profile.id} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, flexShrink:0, cursor:"pointer" }} onClick={() => onOpenProfile(profile.id)}>
                <SAv name={profile.display_name} url={profile.avatar_url} size={48} d={d} ring={true} />
                <span style={{ fontSize:9.5, color:d.t3, maxWidth:48, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sFmtS(secs)}</span>
              </div>
            ))}
          </div>
          <div style={{ height:1, background:d.b }}/>
        </div>
      )}

      {loading ? <SSkeletonFeed d={d} /> :
       posts.length === 0 ? <SEmptySlate d={d} icon="📭" title="no sessions posted yet." sub="be the first — hit + above to log your session." /> :
       posts.map(post => (
        <SPostCard key={post.id} post={post} user={user} d={d}
          onKudos={() => toggleKudos(post)} onOpenProfile={onOpenProfile}
          onRefresh={fetchHome} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={accessToken} />
      ))}
    </div>
  );
}

// ── Friends/Network View ──────────────────────────────────────────────────────
function SFriendsView({ user, d, SB_URL, SB_ANON, accessToken, myHandle, onOpenProfile }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [followingSet, setFollowingSet] = useState(new Set());

  useEffect(() => { fetchFriends(); }, []);

  async function fetchFriends() {
    setLoading(true);
    if (!user?.id) { setLoading(false); return; }
    const fr = await sbFetch(SB_URL, SB_ANON, `social_follows?follower_id=eq.${user.id}&select=following_id`);
    const follows = fr.ok ? await fr.json() : [];
    const followIds = follows.map(f => f.following_id);
    setFollowingSet(new Set(followIds));
    if (followIds.length > 0) {
      const idsQ = followIds.map(id => `user_id=eq.${id}`).join(",");
      const pr = await sbFetch(SB_URL, SB_ANON, `social_posts?or=(${idsQ})&select=*,social_kudos(user_id),profiles:user_id(id,display_name,handle,avatar_url)&order=created_at.desc&limit=40`);
      const raw = pr.ok ? await pr.json() : [];
      setPosts(raw.map(p => ({ ...p, kudos_count:(p.social_kudos||[]).length, kudos_given:(p.social_kudos||[]).some(k=>k.user_id===user?.id) })));
    }
    const excStr = [user.id,...followIds].map(id=>`id.neq.${id}`).join(",");
    const sr = await sbFetch(SB_URL, SB_ANON, `profiles?and=(${excStr})&select=id,display_name,handle,avatar_url,target_college&limit=5&order=created_at.desc`);
    setSuggestions(sr.ok ? await sr.json() : []);
    setLoading(false);
  }

  async function toggleKudos(post) {
    if (!user?.id || post.user_id === user.id) return;
    if (post.kudos_given) {
      await sbFetch(SB_URL, SB_ANON, `social_kudos?post_id=eq.${post.id}&user_id=eq.${user.id}`, { method:"DELETE", token:accessToken });
    } else {
      await sbFetch(SB_URL, SB_ANON, "social_kudos", { method:"POST", prefer:"return=minimal", token:accessToken, body:JSON.stringify({post_id:post.id,user_id:user.id}) });
    }
    setPosts(prev => prev.map(p => p.id===post.id ? {...p,kudos_given:!p.kudos_given,kudos_count:p.kudos_count+(p.kudos_given?-1:1)} : p));
  }

  async function follow(uid) {
    await sbFetch(SB_URL, SB_ANON, "social_follows", { method:"POST", prefer:"return=minimal", token:accessToken, body:JSON.stringify({follower_id:user.id,following_id:uid}) });
    setFollowingSet(prev => new Set([...prev, uid]));
    setSuggestions(prev => prev.filter(s => s.id !== uid));
    fetchFriends();
  }

  const noFriends = followingSet.size === 0;

  return (
    <div>
      {noFriends && suggestions.length > 0 && (
        <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, padding:"16px", marginBottom:12 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase", color:d.t4, marginBottom:12 }}>find candidates to follow</div>
          {suggestions.map(s => <SSuggestRow key={s.id} s={s} d={d} isFollowing={followingSet.has(s.id)} onFollow={() => follow(s.id)} onOpenProfile={onOpenProfile} />)}
        </div>
      )}
      {loading ? <SSkeletonFeed d={d} /> :
       posts.length === 0 ? <SEmptySlate d={d} icon="👥" title={noFriends?"follow fellow candidates.":"network is quiet."} sub={noFriends?"their study sessions will appear here.":"your connections haven't posted yet."} /> :
       posts.map(post => (
        <SPostCard key={post.id} post={post} user={user} d={d}
          onKudos={() => toggleKudos(post)} onOpenProfile={onOpenProfile}
          onRefresh={fetchFriends} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={accessToken} />
      ))}
      {!noFriends && suggestions.length > 0 && (
        <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, padding:"16px", marginTop:8 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:".14em", textTransform:"uppercase", color:d.t4, marginBottom:12 }}>suggested candidates</div>
          {suggestions.map(s => <SSuggestRow key={s.id} s={s} d={d} isFollowing={followingSet.has(s.id)} onFollow={() => follow(s.id)} onOpenProfile={onOpenProfile} />)}
        </div>
      )}
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function SLeaderboardView({ user, d, SB_URL, SB_ANON, onOpenProfile }) {
  const [board, setBoard] = useState([]);
  const [period, setPeriod] = useState("week");
  const [subject, setSubject] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchBoard(); }, [period, subject]);

  async function fetchBoard() {
    setLoading(true);
    let q = `social_posts?select=user_id,duration_seconds,subject,created_at,profiles:user_id(id,display_name,handle,avatar_url)`;
    if (subject !== "All") q += `&subject=eq.${encodeURIComponent(subject)}`;
    if (period === "week") { const s = new Date(); s.setDate(s.getDate()-7); q += `&created_at=gte.${s.toISOString()}`; }
    else if (period === "month") { const s = new Date(); s.setMonth(s.getMonth()-1); q += `&created_at=gte.${s.toISOString()}`; }
    q += `&limit=500`;
    const r = await sbFetch(SB_URL, SB_ANON, q);
    const data = r.ok ? await r.json() : [];
    const map = {};
    data.forEach(s => {
      if (!s.profiles) return;
      if (!map[s.user_id]) map[s.user_id] = { profile:s.profiles, secs:0, sessions:0 };
      map[s.user_id].secs += s.duration_seconds || 0;
      map[s.user_id].sessions++;
    });
    setBoard(Object.values(map).filter(e=>e.profile).sort((a,b)=>b.secs-a.secs).slice(0,50));
    setLoading(false);
  }

  const myRank = board.findIndex(e => e.profile.id === user?.id) + 1;
  const myEntry = board.find(e => e.profile.id === user?.id);
  const prevEntry = myRank > 1 ? board[myRank-2] : null;
  const MEDAL = ["🥇","🥈","🥉"];

  const Pill = ({ label, active, onClick }) => (
    <button onClick={onClick} style={{ padding:"5px 12px", border:`1px solid ${active?d.a1:d.b}`, borderRadius:3, background:active?`${d.a1}15`:"transparent", color:active?d.a1:d.t3, fontFamily:"inherit", fontSize:11, fontWeight:active?700:400, cursor:"pointer", transition:"all .12s" }}>{label}</button>
  );

  return (
    <div>
      {myEntry && (
        <div style={{ padding:"18px 20px", marginBottom:14, borderRadius:8, background:`linear-gradient(135deg,${d.a1}10,${d.a2}08)`, border:`1px solid ${d.a1}20`, display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ textAlign:"center", minWidth:60 }}>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:46, fontWeight:400, color:d.a1, lineHeight:1 }}>#{myRank}</div>
            <div style={{ fontSize:10, color:d.t3, marginTop:3, letterSpacing:".06em", textTransform:"uppercase" }}>your rank</div>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:600, color:d.t, marginBottom:4 }}>{sFmtS(myEntry.secs)} studied</div>
            {prevEntry && <div style={{ fontSize:12, color:d.t3 }}>{sFmtS(prevEntry.secs - myEntry.secs)} behind #{myRank-1}</div>}
            <div style={{ height:3, background:d.b, borderRadius:2, overflow:"hidden", marginTop:10 }}>
              <div style={{ height:"100%", borderRadius:2, background:d.a1, width:`${board[0]?.secs>0?(myEntry.secs/board[0].secs)*100:0}%`, transition:"width .6s ease" }}/>
            </div>
          </div>
        </div>
      )}
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:7 }}>
        {[["week","This week"],["month","This month"],["all","All time"]].map(([v,l]) => <Pill key={v} label={l} active={period===v} onClick={() => setPeriod(v)} />)}
      </div>
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:14 }}>
        {["All",...CFA_TOPICS_LIST.slice(0,5)].map(s => <Pill key={s} label={s==="All"?"All":s.split(" ")[0]} active={subject===s} onClick={() => setSubject(s)} />)}
      </div>
      <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, overflow:"hidden" }}>
        {loading ? (
          <div style={{ padding:"32px", textAlign:"center", color:d.t3, fontSize:13, fontStyle:"italic" }}>loading rankings…</div>
        ) : board.length === 0 ? (
          <div style={{ padding:"32px", textAlign:"center", color:d.t3, fontSize:13, fontStyle:"italic" }}>no data yet. post a session to get ranked.</div>
        ) : board.map((entry, i) => {
          const isMe = entry.profile.id === user?.id;
          const pct = board[0]?.secs > 0 ? (entry.secs/board[0].secs)*100 : 0;
          return (
            <div key={entry.profile.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 16px", borderBottom:i<board.length-1?`1px solid ${d.b}`:"none", background:isMe?`${d.a1}06`:"transparent", position:"relative" }}>
              <div style={{ position:"absolute", left:0, top:0, bottom:0, width:`${pct}%`, background:`${d.a1}04`, pointerEvents:"none" }}/>
              <span style={{ fontSize:i<3?17:13, fontWeight:700, width:26, textAlign:"center", color:i<3?"inherit":d.t4, flexShrink:0, zIndex:1 }}>{i<3?MEDAL[i]:i+1}</span>
              <SAv name={entry.profile.display_name} url={entry.profile.avatar_url} size={30} d={d} onClick={() => onOpenProfile(entry.profile.id)} />
              <div style={{ flex:1, minWidth:0, zIndex:1 }}>
                <button onClick={() => onOpenProfile(entry.profile.id)} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:isMe?700:500, color:isMe?d.a1:d.t, padding:0 }}>
                  {entry.profile.display_name}{isMe&&<span style={{ fontSize:9, marginLeft:6, background:`${d.a1}18`, color:d.a1, padding:"1px 5px", borderRadius:2 }}>you</span>}
                </button>
                {entry.profile.handle && <div style={{ fontSize:10, color:d.t4 }}>@{entry.profile.handle}</div>}
              </div>
              <div style={{ textAlign:"right", zIndex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color:isMe?d.a1:d.t }}>{sFmtS(entry.secs)}</div>
                <div style={{ fontSize:9, color:d.t4 }}>{entry.sessions} post{entry.sessions!==1?"s":""}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Events ────────────────────────────────────────────────────────────────────
function SEventsView({ user, d, SB_URL, SB_ANON, accessToken, myHandle }) {
  const [events, setEvents] = useState([]);
  const [registered, setRegistered] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState("upcoming");

  useEffect(() => { fetchEvents(); }, [tab]);

  async function fetchEvents() {
    setLoading(true);
    const now = new Date().toISOString();
    const q = tab === "mine"
      ? `study_events?created_by=eq.${user?.id}&select=*,study_event_registrations(count)&order=starts_at.desc`
      : `study_events?ends_at=gte.${now}&or=(is_private.eq.false,created_by.eq.${user?.id})&select=*,study_event_registrations(count)&order=starts_at.asc&limit=30`;
    const er = await sbFetch(SB_URL, SB_ANON, q);
    setEvents(er.ok ? await er.json() : []);
    if (user?.id) {
      const rr = await sbFetch(SB_URL, SB_ANON, `study_event_registrations?user_id=eq.${user.id}&select=event_id`);
      setRegistered(new Set((rr.ok ? await rr.json() : []).map(r => r.event_id)));
    }
    setLoading(false);
  }

  async function toggleReg(evtId) {
    if (!user?.id) return;
    if (registered.has(evtId)) {
      await sbFetch(SB_URL, SB_ANON, `study_event_registrations?event_id=eq.${evtId}&user_id=eq.${user.id}`, { method:"DELETE", token:accessToken });
      setRegistered(prev => { const s = new Set(prev); s.delete(evtId); return s; });
    } else {
      await sbFetch(SB_URL, SB_ANON, "study_event_registrations", { method:"POST", prefer:"return=minimal", token:accessToken, body:JSON.stringify({event_id:evtId,user_id:user.id}) });
      setRegistered(prev => new Set([...prev, evtId]));
    }
  }

  const isLive = e => { const now = new Date(); return new Date(e.starts_at)<=now&&new Date(e.ends_at)>=now; };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
        <div style={{ display:"flex", gap:4 }}>
          {[["upcoming","Upcoming"],["mine","My Events"]].map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)} style={{ padding:"5px 12px", border:`1px solid ${tab===v?d.a1:d.b}`, borderRadius:3, background:tab===v?`${d.a1}15`:"transparent", color:tab===v?d.a1:d.t3, fontFamily:"inherit", fontSize:11, fontWeight:tab===v?700:400, cursor:"pointer" }}>{l}</button>
          ))}
        </div>
        <button onClick={() => setShowCreate(v=>!v)} style={{ padding:"7px 14px", border:`1px solid ${showCreate?d.danger:d.a1}`, borderRadius:3, background:showCreate?`${d.danger}10`:`${d.a1}10`, color:showCreate?d.danger:d.a1, fontFamily:"inherit", fontSize:11, fontWeight:700, cursor:"pointer" }}>
          {showCreate ? "✕ cancel" : "+ create event"}
        </button>
      </div>
      {showCreate && (
        <div style={{ marginBottom:12 }}>
          <SCreateEventForm user={user} d={d} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={accessToken} onCreated={() => { setShowCreate(false); fetchEvents(); }} />
        </div>
      )}
      {loading ? <div style={{ padding:"32px", textAlign:"center", color:d.t3, fontSize:13, fontStyle:"italic" }}>loading…</div> :
       events.length === 0 ? <SEmptySlate d={d} icon="🗓" title={tab==="mine"?"no events created yet.":"no upcoming events."} sub="create a study group event above." /> :
       events.map(evt => {
        const live = isLive(evt);
        const sc = SUBJECT_COLORS[evt.subject] || d.a1;
        const count = evt.study_event_registrations?.[0]?.count || 0;
        const reg = registered.has(evt.id);
        const isOwn = evt.created_by === user?.id;
        return (
          <div key={evt.id} style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, marginBottom:10, overflow:"hidden" }}>
            <div style={{ height:2, background:`linear-gradient(90deg,${sc},${sc}30)` }}/>
            <div style={{ padding:"14px 16px 13px" }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:8 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:5 }}>
                    <span style={{ fontSize:15, fontWeight:700, color:d.t }}>{evt.name}</span>
                    {live && <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:"#c45a5a18", color:"#c45a5a" }}>🔴 Live</span>}
                    {!live && <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:`${d.a2}15`, color:d.a2 }}>Upcoming</span>}
                    {evt.is_private && <span style={{ fontSize:10, padding:"2px 7px", borderRadius:3, background:`${d.t4}12`, color:d.t4 }}>🔒 Private</span>}
                    {isOwn && <span style={{ fontSize:10, padding:"2px 7px", borderRadius:3, background:`${d.a1}15`, color:d.a1 }}>yours</span>}
                  </div>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:`${sc}15`, color:sc }}>{SUB_EMOJI[evt.subject]||"📚"} {evt.subject}</span>
                </div>
              </div>
              {evt.description && <div style={{ fontSize:12.5, color:d.t2, lineHeight:1.75, marginBottom:10 }}>{evt.description}</div>}
              <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginBottom:12 }}>
                <span style={{ fontSize:11, color:d.t3 }}>📅 {new Date(evt.starts_at).toLocaleString("en-GB",{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                <span style={{ fontSize:11, color:d.t3 }}>⏱ {(()=>{const m=Math.round((new Date(evt.ends_at)-new Date(evt.starts_at))/60000);const h=Math.floor(m/60);return h>0?`${h}h${m%60>0?" "+(m%60)+"m":""}`:m+"m";})()}</span>
                <span style={{ fontSize:11, color:d.t3 }}>👥 {count} registered</span>
              </div>
              {!isOwn && (
                <button onClick={() => toggleReg(evt.id)} style={{ padding:"8px 20px", borderRadius:3, border:`1px solid ${reg?d.b:live?"#c45a5a":d.a1}`, background:reg?"transparent":live?"#c45a5a":d.a1, color:reg?d.t3:"#fff", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer", transition:"all .12s", letterSpacing:".02em" }}>
                  {reg?(live?"✓ joined":"✓ registered — cancel?"):(live?"join live":"register")}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SCreateEventForm({ user, d, SB_URL, SB_ANON, accessToken, onCreated }) {
  const now = new Date(); now.setMinutes(Math.ceil(now.getMinutes()/15)*15,0,0);
  const localISO = dt => new Date(dt.getTime()-dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const [form, setForm] = useState({ name:"", subject:CFA_TOPICS_LIST[0], description:"", starts_at:localISO(now), duration_hours:"2", is_private:false });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.name.trim()) return;
    setSaving(true);
    const starts = new Date(form.starts_at);
    const ends = new Date(starts.getTime()+parseFloat(form.duration_hours)*3600000);
    await sbFetch(SB_URL, SB_ANON, "study_events", { method:"POST", prefer:"return=minimal", token:accessToken, body:JSON.stringify({name:form.name.trim(),subject:form.subject,description:form.description.trim()||null,starts_at:starts.toISOString(),ends_at:ends.toISOString(),is_private:form.is_private,created_by:user?.id}) });
    setSaving(false); onCreated();
  }

  const inp = { padding:"8px 11px", border:`1px solid ${d.b}`, borderRadius:4, background:d.inp, color:d.t, fontFamily:"inherit", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box" };
  return (
    <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, padding:"16px" }}>
      <div style={{ fontSize:12, fontWeight:700, color:d.t, marginBottom:12, letterSpacing:".04em" }}>new study event</div>
      <input style={{ ...inp, marginBottom:8 }} placeholder="Event name — e.g. Fixed Income Marathon" maxLength={60} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8, marginBottom:8 }}>
        <select style={{ ...inp, cursor:"pointer" }} value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))}>
          {CFA_TOPICS_LIST.map(t=><option key={t}>{t}</option>)}
        </select>
        <input style={inp} type="datetime-local" value={form.starts_at} onChange={e=>setForm(f=>({...f,starts_at:e.target.value}))}/>
        <select style={{ ...inp, cursor:"pointer" }} value={form.duration_hours} onChange={e=>setForm(f=>({...f,duration_hours:e.target.value}))}>
          {["0.5","1","1.5","2","3","4","6"].map(h=><option key={h} value={h}>{h==="0.5"?"30 min":`${h}h`}</option>)}
        </select>
      </div>
      <textarea style={{ ...inp, resize:"vertical", minHeight:48, marginBottom:10 }} placeholder="What will you cover? Any rules?" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, padding:"10px 12px", background:d.hover, borderRadius:4, border:`1px solid ${d.b}` }}>
        <button onClick={()=>setForm(f=>({...f,is_private:!f.is_private}))} style={{ width:36,height:20,borderRadius:10,background:form.is_private?d.a1:d.b,border:"none",cursor:"pointer",position:"relative",flexShrink:0,transition:"background .2s" }}>
          <span style={{ position:"absolute",top:2,left:form.is_private?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left .2s" }}/>
        </button>
        <div>
          <div style={{ fontSize:12,fontWeight:600,color:d.t }}>{form.is_private?"🔒 Private event":"🌐 Public event"}</div>
          <div style={{ fontSize:10.5,color:d.t3 }}>{form.is_private?"invite only":"visible to all candidates"}</div>
        </div>
      </div>
      <button className="btn btn-d" onClick={submit} disabled={saving||!form.name.trim()} style={{ fontSize:12,opacity:saving||!form.name.trim()?.4:1,letterSpacing:".03em" }}>
        {saving?"creating…":"create event →"}
      </button>
    </div>
  );
}

// ── Profile View ──────────────────────────────────────────────────────────────
function SProfileView({ user, d, SB_URL, SB_ANON, accessToken, viewingUid, isOwn, onOpenProfile, onBack, sessions }) {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [stats, setStats] = useState({ secs:0, followers:0, following:0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("posts");

  useEffect(() => { load(); }, [viewingUid]);

  async function load() {
    setLoading(true); setEditing(false);
    const pr = await sbFetch(SB_URL, SB_ANON, `profiles?id=eq.${viewingUid}&select=*`);
    let prof = (pr.ok ? await pr.json() : [])[0];
    if (!prof && isOwn) {
      await sbFetch(SB_URL, SB_ANON, "profiles", { method:"POST", prefer:"return=minimal", token:accessToken, body:JSON.stringify({id:user.id,display_name:user.name,avatar_url:user.avatar||null}) });
      prof = { id:user.id, display_name:user.name, avatar_url:user.avatar, bio:null, target_college:null, handle:null };
    }
    setProfile(prof || { id:viewingUid, display_name:"Candidate" });
    const postr = await sbFetch(SB_URL, SB_ANON, `social_posts?user_id=eq.${viewingUid}&select=*,social_kudos(user_id)&order=created_at.desc&limit=30`);
    const rawPosts = postr.ok ? await postr.json() : [];
    let totalSecs = rawPosts.reduce((a,p)=>a+(p.duration_seconds||0),0);
    if (isOwn && sessions?.length) totalSecs = Math.max(totalSecs, sessions.reduce((a,s)=>a+s.duration*60,0));
    setPosts(rawPosts.map(p=>({...p,profiles:prof||{display_name:user.name,avatar_url:user.avatar},kudos_count:(p.social_kudos||[]).length,kudos_given:(p.social_kudos||[]).some(k=>k.user_id===user?.id)})));
    const [folr,folgi] = await Promise.all([
      sbFetch(SB_URL,SB_ANON,`social_follows?following_id=eq.${viewingUid}&select=follower_id`),
      sbFetch(SB_URL,SB_ANON,`social_follows?follower_id=eq.${viewingUid}&select=following_id`),
    ]);
    setStats({secs:totalSecs,followers:folr.ok?(await folr.json()).length:0,following:folgi.ok?(await folgi.json()).length:0});
    if (!isOwn&&user?.id) {
      const cr = await sbFetch(SB_URL,SB_ANON,`social_follows?follower_id=eq.${user.id}&following_id=eq.${viewingUid}&select=follower_id`);
      setIsFollowing((cr.ok?await cr.json():[]).length>0);
    }
    setLoading(false);
  }

  async function toggleFollow() {
    if (!user?.id) return;
    if (isFollowing) {
      await sbFetch(SB_URL,SB_ANON,`social_follows?follower_id=eq.${user.id}&following_id=eq.${viewingUid}`,{method:"DELETE",token:accessToken});
      setIsFollowing(false); setStats(s=>({...s,followers:s.followers-1}));
    } else {
      await sbFetch(SB_URL,SB_ANON,"social_follows",{method:"POST",prefer:"return=minimal",token:accessToken,body:JSON.stringify({follower_id:user.id,following_id:viewingUid})});
      setIsFollowing(true); setStats(s=>({...s,followers:s.followers+1}));
    }
  }

  async function toggleKudos(post) {
    if (!user?.id||post.user_id===user.id) return;
    if (post.kudos_given) {
      await sbFetch(SB_URL,SB_ANON,`social_kudos?post_id=eq.${post.id}&user_id=eq.${user.id}`,{method:"DELETE",token:accessToken});
    } else {
      await sbFetch(SB_URL,SB_ANON,"social_kudos",{method:"POST",prefer:"return=minimal",token:accessToken,body:JSON.stringify({post_id:post.id,user_id:user.id})});
    }
    setPosts(prev=>prev.map(p=>p.id===post.id?{...p,kudos_given:!p.kudos_given,kudos_count:p.kudos_count+(p.kudos_given?-1:1)}:p));
  }

  if (loading) return <div style={{padding:40,textAlign:"center",color:d.t3,fontSize:13,fontStyle:"italic"}}>loading profile…</div>;
  const bg = avColor(profile?.display_name);
  const subBreakdown = CFA_TOPICS_LIST.map(sub=>({sub,secs:posts.filter(p=>p.subject===sub).reduce((a,p)=>a+(p.duration_seconds||0),0)}));
  const totalPostedSecs = subBreakdown.reduce((a,b)=>a+b.secs,0);

  return (
    <div>
      <div style={{ background:d.card, border:`1px solid ${d.b}`, borderRadius:8, overflow:"hidden", marginBottom:10 }}>
        <div style={{ height:72, background:`linear-gradient(135deg,${bg}60,${bg}15)`, position:"relative" }}>
          {!isOwn && <button onClick={onBack} style={{ position:"absolute", top:10, left:12, background:"rgba(0,0,0,.4)", border:"none", color:"#fff", borderRadius:3, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>← back</button>}
        </div>
        <div style={{ padding:"0 18px 18px" }}>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginTop:-26, marginBottom:12 }}>
            <div style={{ width:54,height:54,borderRadius:"50%",background:bg,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,border:`3px solid ${d.card}`,overflow:"hidden",flexShrink:0 }}>
              {profile?.avatar_url?<img src={profile.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:sInitials(profile?.display_name)}
            </div>
            {isOwn ? (
              <button onClick={()=>setEditing(v=>!v)} style={{padding:"7px 16px",border:`1px solid ${d.b}`,borderRadius:3,background:"transparent",color:d.t3,fontFamily:"inherit",fontSize:11,fontWeight:600,cursor:"pointer",letterSpacing:".03em"}}>
                {editing?"cancel":"edit profile"}
              </button>
            ) : (
              <button onClick={toggleFollow} style={{padding:"8px 20px",borderRadius:3,border:`1px solid ${isFollowing?d.b:d.a1}`,background:isFollowing?"transparent":d.a1,color:isFollowing?d.t3:"#fff",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .12s",letterSpacing:".02em"}}>
                {isFollowing?"following":"follow"}
              </button>
            )}
          </div>
          {editing ? (
            <SEditProfileForm user={user} profile={profile} d={d} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={accessToken} onSaved={updated=>{setProfile(updated);setEditing(false);}} />
          ) : (
            <>
              <div style={{fontSize:17,fontWeight:700,color:d.t}}>{profile?.display_name}</div>
              {profile?.handle&&<div style={{fontSize:12,color:d.t3,marginBottom:5}}>@{profile.handle}</div>}
              {profile?.bio&&<div style={{fontSize:13,color:d.t2,lineHeight:1.65,marginBottom:6}}>{profile.bio}</div>}
              {profile?.target_college&&<div style={{fontSize:12,color:d.t3,marginBottom:12}}>🎯 {profile.target_college}</div>}
              <div style={{display:"flex",borderTop:`1px solid ${d.b}`,paddingTop:12}}>
                {[
                  {val:sFmtS(stats.secs)||"0m",lbl:"studied"},
                  {val:posts.length,lbl:"posts"},
                  {val:stats.followers,lbl:"followers"},
                  {val:stats.following,lbl:"following"},
                ].map((s,i)=>(
                  <div key={s.lbl} style={{flex:1,textAlign:"center",borderRight:i<3?`1px solid ${d.b}`:"none",padding:"4px 0"}}>
                    <div style={{fontSize:18,fontWeight:700,color:d.t,letterSpacing:"-.01em"}}>{s.val}</div>
                    <div style={{fontSize:9.5,color:d.t3,textTransform:"uppercase",letterSpacing:".06em"}}>{s.lbl}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div style={{display:"flex",borderBottom:`1px solid ${d.b}`,marginBottom:12}}>
        {[["posts","Sessions"],["stats","Stats"]].map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)} style={{padding:"8px 16px",border:"none",background:"transparent",fontFamily:"inherit",fontSize:12,fontWeight:tab===v?700:400,color:tab===v?d.t:d.t3,cursor:"pointer",borderBottom:`2px solid ${tab===v?d.a1:"transparent"}`,marginBottom:-1}}>{l}</button>
        ))}
      </div>
      {tab==="posts"&&(
        posts.length===0?<SEmptySlate d={d} icon="📭" title="no sessions posted yet." sub="log sessions from the Home tab." />:
        posts.map(post=><SPostCard key={post.id} post={post} user={user} d={d} onKudos={()=>toggleKudos(post)} onOpenProfile={onOpenProfile} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={accessToken} onRefresh={load}/>)
      )}
      {tab==="stats"&&(
        <div>
          <div style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:8,padding:"16px",marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:d.t4,marginBottom:12}}>topic breakdown</div>
            {subBreakdown.filter(b=>b.secs>0).map(({sub,secs})=>{
              const pct=totalPostedSecs>0?Math.round((secs/totalPostedSecs)*100):0;
              const sc=SUBJECT_COLORS[sub]||d.a1;
              return(<div key={sub} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
                  <span style={{color:sc,fontWeight:600}}>{SUB_EMOJI[sub]} {sub}</span>
                  <span style={{color:d.t3}}>{sFmtS(secs)}</span>
                </div>
                <div style={{height:4,background:d.b,borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:sc,borderRadius:2,transition:"width .5s"}}/>
                </div>
              </div>);
            })}
          </div>
          <div style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:8,padding:"16px"}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:d.t4,marginBottom:12}}>all-time</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{label:"Total studied",val:sFmtS(stats.secs)||"0m"},{label:"Sessions posted",val:posts.length},{label:"Total kudos",val:posts.reduce((a,p)=>a+p.kudos_count,0)},{label:"Avg session",val:posts.length>0?sFmtS(Math.round(stats.secs/posts.length)):"—"}].map(s=>(
                <div key={s.label} style={{textAlign:"center",padding:"10px 8px",background:d.hover,borderRadius:4}}>
                  <div style={{fontFamily:"'DM Serif Display',serif",fontSize:22,fontWeight:400,color:d.t}}>{s.val}</div>
                  <div style={{fontSize:9.5,color:d.t4,marginTop:3,textTransform:"uppercase",letterSpacing:".06em"}}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SEditProfileForm({ user, profile, d, SB_URL, SB_ANON, accessToken, onSaved }) {
  const [form, setForm] = useState({display_name:profile?.display_name||"",handle:profile?.handle||"",bio:profile?.bio||"",target_college:profile?.target_college||""});
  const [handleState, setHandleState] = useState("ok");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  function onHandleType(v) {
    const clean = v.toLowerCase().replace(/[^a-z0-9_.]/g,"").slice(0,24);
    setForm(f=>({...f,handle:clean}));
    if (clean===profile?.handle){setHandleState("ok");return;}
    if (clean.length<3){setHandleState("short");return;}
    setHandleState("checking");
    clearTimeout(debounceRef.current);
    debounceRef.current=setTimeout(async()=>{
      const r=await sbFetch(SB_URL,SB_ANON,`profiles?handle=eq.${clean}&select=id`);
      setHandleState((r.ok?await r.json():[]).length>0?"taken":"ok");
    },350);
  }

  async function save() {
    if (handleState!=="ok") return;
    setSaving(true);
    const r = await sbFetch(SB_URL,SB_ANON,"profiles",{method:"POST",prefer:"resolution=merge-duplicates,return=representation",token:accessToken,body:JSON.stringify({id:user.id,...form,avatar_url:user.avatar||null})});
    const rows = r.ok?await r.json():[];
    setSaving(false);
    onSaved(rows[0]||{...profile,...form});
  }

  const inp = {padding:"8px 11px",border:`1px solid ${d.b}`,borderRadius:4,background:d.inp,color:d.t,fontFamily:"inherit",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",marginBottom:8};
  const hb = handleState==="ok"?d.a2:handleState==="taken"||handleState==="short"?d.danger:d.b;

  return (
    <div>
      <input style={inp} placeholder="Display name" value={form.display_name} onChange={e=>setForm(f=>({...f,display_name:e.target.value}))}/>
      <div style={{position:"relative",marginBottom:8}}>
        <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:13,color:d.t3,pointerEvents:"none"}}>@</span>
        <input style={{...inp,marginBottom:0,paddingLeft:28,border:`1px solid ${hb}`}} placeholder="handle" value={form.handle} onChange={e=>onHandleType(e.target.value)}/>
        {handleState==="ok"&&form.handle.length>=3&&<span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",color:d.a2,fontSize:14}}>✓</span>}
        {handleState==="taken"&&<span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:11,color:d.danger}}>taken</span>}
      </div>
      <input style={inp} placeholder="Target — e.g. CFA Level II, Nov 2026" value={form.target_college} onChange={e=>setForm(f=>({...f,target_college:e.target.value}))}/>
      <textarea style={{...inp,minHeight:54,resize:"vertical"}} placeholder="Bio" value={form.bio} onChange={e=>setForm(f=>({...f,bio:e.target.value}))}/>
      <button className="btn btn-d" onClick={save} disabled={saving||handleState!=="ok"} style={{fontSize:12,opacity:saving||handleState!=="ok"?.4:1,letterSpacing:".03em"}}>
        {saving?"saving…":"save changes"}
      </button>
    </div>
  );
}

// ── Search View ───────────────────────────────────────────────────────────────
function SSearchView({ user, d, SB_URL, SB_ANON, accessToken, onOpenProfile }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [all, setAll] = useState([]);
  const [followingSet, setFollowingSet] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); fetchAll(); }, []);

  async function fetchAll() {
    const [ar,fr] = await Promise.all([
      sbFetch(SB_URL,SB_ANON,`profiles?id=neq.${user?.id||"none"}&select=id,display_name,handle,avatar_url,target_college&order=display_name`),
      user?.id?sbFetch(SB_URL,SB_ANON,`social_follows?follower_id=eq.${user.id}&select=following_id`):Promise.resolve({ok:true,json:()=>[]}),
    ]);
    const users = ar.ok?await ar.json():[];
    const follows = fr.ok?await fr.json():[];
    setAll(users); setResults(users);
    setFollowingSet(new Set(follows.map(f=>f.following_id)));
    setLoading(false);
  }

  function search(q) {
    setQuery(q);
    if (!q.trim()){setResults(all);return;}
    const lq = q.toLowerCase();
    setResults(all.filter(u=>u.handle?.toLowerCase().includes(lq)||u.display_name?.toLowerCase().includes(lq)||u.target_college?.toLowerCase().includes(lq)));
  }

  async function toggleFollow(uid) {
    if (!user?.id) return;
    if (followingSet.has(uid)) {
      await sbFetch(SB_URL,SB_ANON,`social_follows?follower_id=eq.${user.id}&following_id=eq.${uid}`,{method:"DELETE",token:accessToken});
      setFollowingSet(prev=>{const s=new Set(prev);s.delete(uid);return s;});
    } else {
      await sbFetch(SB_URL,SB_ANON,"social_follows",{method:"POST",prefer:"return=minimal",token:accessToken,body:JSON.stringify({follower_id:user.id,following_id:uid})});
      setFollowingSet(prev=>new Set([...prev,uid]));
    }
  }

  return (
    <div>
      <div style={{position:"relative",marginBottom:14}}>
        <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16,color:d.t3,pointerEvents:"none"}}>⌕</span>
        <input ref={inputRef} value={query} onChange={e=>search(e.target.value)} placeholder="search @handle, name, or target exam…"
          style={{width:"100%",boxSizing:"border-box",padding:"11px 14px 11px 36px",border:`1px solid ${d.b}`,borderRadius:5,background:d.inp,color:d.t,fontFamily:"inherit",fontSize:13,outline:"none"}}/>
        {query&&<button onClick={()=>search("")} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:d.t3,cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>}
      </div>
      {loading?<div style={{padding:32,textAlign:"center",color:d.t3,fontSize:13,fontStyle:"italic"}}>loading…</div>:
       results.length===0?<SEmptySlate d={d} icon="🔍" title="no candidates found." sub="try a different handle or name." />:
       results.map(u=>(
        <div key={u.id} style={{background:d.card,border:`1px solid ${d.b}`,borderRadius:8,display:"flex",alignItems:"center",gap:12,padding:"12px 16px",marginBottom:8}}>
          <SAv name={u.display_name} url={u.avatar_url} size={42} d={d} onClick={()=>onOpenProfile(u.id)}/>
          <div style={{flex:1,minWidth:0}}>
            <button onClick={()=>onOpenProfile(u.id)} style={{background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13.5,fontWeight:700,color:d.t,padding:0,textAlign:"left"}}>{u.display_name}</button>
            <div style={{fontSize:11,color:d.t3}}>{u.handle?`@${u.handle}`:""}{u.target_college?` · 🎯 ${u.target_college}`:""}</div>
          </div>
          <button onClick={()=>toggleFollow(u.id)} style={{padding:"6px 14px",borderRadius:3,border:`1px solid ${followingSet.has(u.id)?d.b:d.a1}`,background:followingSet.has(u.id)?"transparent":d.a1,color:followingSet.has(u.id)?d.t3:"#fff",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0,transition:"all .12s",letterSpacing:".02em"}}>
            {followingSet.has(u.id)?"following":"follow"}
          </button>
        </div>
      ))}
    </div>
  );
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
      localStorage.setItem("cfa_auth", JSON.stringify(stored));
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
            Charter<span style={{color:"#c9a84c"}}>Run</span>
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


const TABS=[
  {id:"overview",    label:"Dashboard",  icon:"⌂"},
  {id:"home",        label:"Home",       icon:"◉"},
  {id:"friends",     label:"Network",    icon:"◎"},
  {id:"leaderboard", label:"Rankings",   icon:"▲"},
  {id:"events",      label:"Events",     icon:"◈"},
  {id:"coach",       label:"AI Coach",   icon:"👁"},
  {id:"goals",       label:"Today",      icon:"✦"},
  {id:"sessions",    label:"Log",        icon:"◷"},
  {id:"streaks",     label:"Streaks",    icon:"🔥"},
  {id:"syllabus",    label:"Curriculum", icon:"📋"},
];

export default function App(){
  // Tab switch — also closes sidebar on mobile
  function switchTab(newTab){
    setTab(newTab);
    if(window.innerWidth<=900) setSideOpen(false);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [authSession,setAuthSession]=useState(()=>{
    try{
      const s=localStorage.getItem("cfa_auth");
      if(!s)return null;
      const p=JSON.parse(s);
      if(p.expires_at&&p.expires_at<Date.now()){localStorage.removeItem("cfa_auth");return null;}
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
    const prev=()=>{try{return JSON.parse(localStorage.getItem("cfa_auth"));}catch(e){return null;}};
    const p=prev();
    if(p?.user?.id&&p.user.id!==stored?.user?.id){
      ["cfa_sessions","cfa_mocks","cfa_goals","cfa_log","cfa_completed","cfa_syllabus","cfa_level"].forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
    }
    localStorage.setItem("cfa_auth",JSON.stringify(stored));
    setAuthSession(stored);
  }
  function handleSignOut(){
    if(authSession?.access_token)SB_AUTH.signOut(authSession.access_token).catch(()=>{});
    setAuthSession(null);
    setSessions([]);setMocks([]);setGoals([]);setStudyLog([]);setCompletedTests({});
    try{["cfa_auth","cfa_sessions","cfa_mocks","cfa_goals","cfa_log","cfa_completed","cfa_syllabus","cfa_level"].forEach(k=>localStorage.removeItem(k));}catch(e){}
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
  const [sideOpen,setSideOpen]=useState(()=>typeof window!=="undefined"&&window.innerWidth>900);
  const [tab,setTab]=useState("overview");
  const [cfaLevel,setCfaLevel]=useState(()=>{try{return localStorage.getItem("cfa_level")||null;}catch(e){return null;}});
  const [sessions,setSessions]=useState(()=>{try{const c=localStorage.getItem("cfa_sessions");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [mocks,setMocks]=useState(()=>{try{const c=localStorage.getItem("cfa_mocks");return c?JSON.parse(c):[];}catch(e){return [];}});

  // ── Receive completed practice test result ────────────────────────────────



  // Goals
  const [goals,setGoals]=useState(()=>{try{const c=localStorage.getItem("cfa_goals");return c?JSON.parse(c):[];}catch(e){return [];}});
  const [goalInput,setGoalInput]=useState("");
  const [goalSub,setGoalSub]=useState("Physics");
  const [goalTopic,setGoalTopic]=useState("");
  const [goalType,setGoalType]=useState("study");
  const [goalTarget,setGoalTarget]=useState("");
  const [goalLoading,setGoalLoading]=useState(false);

  // Practice log
  const [studyLog,setStudyLog]=useState(()=>{try{const c=localStorage.getItem("cfa_log");return c?JSON.parse(c):[];}catch(e){return [];}});

  // Coach
  const [syllabusStatus,setSyllabusStatus]=useState(()=>{try{const c=localStorage.getItem("cfa_syllabus");return c?JSON.parse(c):{};}catch(e){return {};}});
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
  const cfaTopics=sub=>(TOPICS[sub]?.all||[]);
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
  const practiceAccuracy=studyLog.length?Math.round((studyLog.filter(p=>p.correct).length/studyLog.length)*100):null;
  // Sync all data to localStorage
  useEffect(()=>{try{localStorage.setItem("cfa_sessions",JSON.stringify(sessions));}catch(e){}},[sessions]);
  useEffect(()=>{try{localStorage.setItem("cfa_mocks",JSON.stringify(mocks));}catch(e){}},[mocks]);
  useEffect(()=>{try{localStorage.setItem("cfa_goals",JSON.stringify(goals));}catch(e){}},[goals]);
  useEffect(()=>{try{localStorage.setItem("cfa_log",JSON.stringify(studyLog));}catch(e){}},[studyLog]);
  useEffect(()=>{try{localStorage.setItem("cfa_syllabus",JSON.stringify(syllabusStatus));}catch(e){}},[syllabusStatus]);
  // Load from Supabase on login (only if localStorage empty)
  useEffect(()=>{
    if(!authSession?.access_token||!user?.id)return;
    const token=authSession.access_token, uid=user.id;
    if(!localStorage.getItem("cfa_sessions"))SB_AUTH.loadData("user_sessions",uid,token).then(d=>{if(d?.length)setSessions(d.map(r=>r.data||r));});
    if(!localStorage.getItem("cfa_goals"))SB_AUTH.loadData("user_goals",uid,token).then(d=>{if(d?.length)setGoals(d.map(r=>r.data||r));});
    if(!localStorage.getItem("cfa_mocks"))SB_AUTH.loadData("user_mocks",uid,token).then(d=>{if(d?.length)setMocks(d.map(r=>r.data||r));});
    if(!localStorage.getItem("cfa_log"))SB_AUTH.loadData("user_study_log",uid,token).then(d=>{if(d?.length)setStudyLog(d.map(r=>r.data||r));});
    if(!localStorage.getItem("cfa_level"))fetch(`${SB_URL}/rest/v1/user_prefs?user_id=eq.${uid}&select=*`,{headers:{"apikey":SB_ANON,"Authorization":`Bearer ${token}`}}).then(r=>r.json()).then(d=>{if(d?.[0]?.cfa_level){setCfaLevel(d[0].cfa_level);try{localStorage.setItem("cfa_level",d[0].cfa_level);}catch(e){}}}).catch(()=>{});
  },[authSession?.access_token]);
  useEffect(()=>{
    setGoals(prev=>prev.map(g=>{
      if(g.date!==today()) return g;
      if(g.type==="study"){const done=sessions.filter(s=>s.date===today()&&s.subject===g.subject&&(!g.topic||s.topic===g.topic)).reduce((a,s)=>a+s.duration,0);return{...g,achieved:done>=(g.target||60)};}
      if(g.type==="questions"){const done=studyLog.filter(p=>p.date===today()&&p.subject===g.subject&&(!g.topic||p.topic===g.topic)).length;return{...g,achieved:done>=(g.target||10)};}
      return g;
    }));
  },[sessions,studyLog]);
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
    setGoals(p=>[...p,{id:Date.now(),date:today(),text:goalInput||`${goalType==="study"?"Study":"Practice questions for"} ${goalTopic||goalSub}`,subject:goalSub,topic:goalTopic,type:goalType,target:Math.max(1,parseInt(goalTarget)||(goalType==="questions"?10:60)),achieved:false,aiGenerated:false}]);
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
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${OR_KEY}`,"HTTP-Referer":"https://charterrun.app","X-Title":"CharterRun"},
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
      const ms=mocks.map(m=>`${m.name}:P=${m.physics},C=${m.chemistry},M=${m.math},T=${m.ethics+m.fi+m.equity}`).join(";");
      const tt=sessions.reduce((a,s)=>{const k=`${s.subject}-${s.topic}`;a[k]=(a[k]||0)+s.duration;return a;},{});
      const ef=Object.entries(tt).filter(([,t])=>t>120).map(([k])=>k).join(",");
      const ps=studyLog.length?`${studyLog.length} practice Qs, ${practiceAccuracy}% accuracy`:"No practice data yet";
      const cards=await callAI(`You are an elite CFA exam coach. Return ONLY valid JSON. No markdown.
{"cards":[{"type":"effort_trap","title":"Effort vs Score Gap","icon":"⚠","color":"danger","insight":"2-3 sharp sentences","topics":["t1","t2"],"action":"1 sentence"},{"type":"strengths","title":"Your Strengths","icon":"💪","color":"success","insight":"2-3 sentences","topics":["t1"],"action":"1 sentence"},{"type":"critical_gaps","title":"Critical Gaps","icon":"🎯","color":"warning","insight":"2-3 sentences","topics":["t1","t2"],"action":"1 sentence"},{"type":"time_analysis","title":"Time Analysis","icon":"⏱","color":"info","insight":"2-3 sentences","recommendation":"1 sentence"},{"type":"pyq_analysis","title":"PYQ Performance","icon":"📝","color":"info","insight":"2-3 sentences","action":"1 sentence"},{"type":"weekly_focus","title":"This Week's Focus","icon":"📅","color":"primary","insight":"2 sentences","plan":["Mon-Tue","Wed-Thu","Fri-Sun"]}]}`,
        `Level:${cfaLevel}. Study:${ss}. Mocks:${ms}. Topics>2h:${ef||"none"}. PYQs:${ps}. Streak:${streak}d. Be sharp and specific.`,true);
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
        cfaTopics(sub)
          .filter(t=>
            !sessions.some(s=>s.subject===sub&&s.topic===t) &&
            (CFA_WEIGHTAGE[sub]?.[t]||"M")==="H"
          )
          .map(t=>({subject:sub, topic:t, weight:"H"}))
      ).slice(0,6);

      // ── BUCKET B: Chapters studied but performing badly ───────────────────
      // Combines mock weakness + PYQ accuracy per topic
      const topicPyqMap=studyLog.reduce((acc,p)=>{
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
          weight: CFA_WEIGHTAGE[t.subject]?.[t.topic]||"M",
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
            .map(([t])=>`${s.sub}-${t}(mock:${s.avg}/100,${CFA_WEIGHTAGE[s.sub]?.[t]||"M"}-weight)`);
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

        `Class: ${cfaLevel}. Streak: ${streak} days.
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
  const SW=sideOpen?220:56;
  const css=`
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&display=swap');
    html,body{overflow-x:hidden;margin:0;padding:0;width:100%;}
    *{box-sizing:border-box;}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{background:${d.bg};font-family:'DM Sans',sans-serif;color:${d.t};-webkit-font-smoothing:antialiased;}
    *{transition:background-color .18s,border-color .18s,color .12s;}
    ::-webkit-scrollbar{width:2px;} ::-webkit-scrollbar-thumb{background:${d.b};border-radius:1px;}

    /* ── LAYOUT ── */
    .layout{display:block;min-height:100vh;width:100%;background:${d.bg};}
    .sidebar{width:${SW}px;min-height:100vh;background:${d.sb};border-right:1px solid ${d.b};position:fixed;top:0;left:0;display:flex;flex-direction:column;z-index:50;overflow:hidden;transition:transform .28s cubic-bezier(.16,1,.3,1),width .28s cubic-bezier(.16,1,.3,1);}
    .content{margin-left:${SW}px;min-height:100vh;overflow-x:hidden;box-sizing:border-box;width:calc(100vw - ${SW}px);}
    .inner{max-width:1060px;padding:32px 40px;width:100%;margin:0 auto;box-sizing:border-box;}
    /* ── RESPONSIVE ── */
    @media(min-width:1400px){
      .inner{padding:36px 60px;}
      .topbar{padding:0 60px;}
    }
    @media(max-width:1100px){
      .inner{padding:28px 32px;}
      .topbar{padding:0 32px;}
    }
    /* Tablet & mobile: sidebar floats over content, content is full width */
    @media(max-width:900px){
      .content{margin-left:0 !important;width:100% !important;}
      .inner{padding:20px 18px;}
      .topbar{padding:0 18px !important;}
      .g3{grid-template-columns:1fr 1fr !important;}
      .g4{grid-template-columns:1fr 1fr !important;}
      .coach-grid{grid-template-columns:1fr 1fr !important;}
      .stat-num{font-size:26px !important;}
      .sidebar{transform:translateX(${sideOpen?"0":"-100%"});width:260px !important;}
    }
    @media(max-width:600px){
      .content{margin-left:0 !important;width:100% !important;}
      .inner{padding:14px 14px !important;}
      .topbar{padding:0 14px !important;min-height:52px;}
      .g2{grid-template-columns:1fr 1fr !important;}
      .g3,.g4{grid-template-columns:1fr 1fr !important;}
      .coach-grid{grid-template-columns:1fr !important;}
      .stat-num{font-size:20px !important;}
      .ptitle{font-size:15px !important;}
      .psub{display:none !important;}
      .section-head{font-size:16px !important;}
      .snotes{display:none;}
      .sidebar{transform:translateX(${sideOpen?"0":"-100%"});width:80vw !important;max-width:280px !important;}
    }
    @media(max-width:380px){
      .g2,.g3,.g4{grid-template-columns:1fr !important;}
      .inner{padding:12px 10px !important;}
    }
    /* Overlay behind sidebar on mobile */
    .sb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:45;cursor:pointer;
      opacity:${sideOpen?1:0};pointer-events:${sideOpen?"auto":"none"};transition:opacity .25s;}
    @media(min-width:901px){.sb-overlay{display:none;}}
    /* Hamburger — only on mobile/tablet */
    .mob-btn{display:none;width:34px;height:34px;border-radius:6px;background:${d.hover};border:1px solid ${d.b};cursor:pointer;align-items:center;justify-content:center;color:${d.t};font-size:18px;flex-shrink:0;}
    @media(max-width:900px){.mob-btn{display:flex;}}

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
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0 40px;width:100%;box-sizing:border-box;border-bottom:1px solid ${d.b};background:${dark?"rgba(14,13,11,.92)":"rgba(247,244,238,.92)"};position:sticky;top:0;z-index:10;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);min-height:60px;}
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
    .coach-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:13px;margin-bottom:16px;}
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


  if(!cfaLevel) return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:9999,background:d.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px 16px",boxSizing:"border-box",overflowY:"auto",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`html,body{overflow:hidden;}@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
      <div style={{width:"100%",maxWidth:380,margin:"auto"}}>
        <div style={{fontSize:26,fontWeight:900,color:d.t,marginBottom:24,letterSpacing:"-.05em",fontFamily:"'DM Serif Display',serif"}}>
          <span style={{fontSize:32,marginRight:6}}>🦥</span>Charter<span style={{color:d.a1}}>Run</span>
        </div>
        <div style={{fontSize:20,fontWeight:600,letterSpacing:"-.02em",color:d.t,marginBottom:4}}>which level are you targeting.</div>
        <div style={{fontSize:13,color:d.t3,marginBottom:20,lineHeight:1.5}}>study less. rank more. nap often.</div>
        {CFA_LEVELS.map(c=>(
          <div key={c.id}
            style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",border:`1.5px solid ${d.b}`,borderRadius:10,cursor:"pointer",marginBottom:8,background:d.card,transition:"border-color .15s"}}
            onMouseOver={e=>e.currentTarget.style.borderColor=d.bs}
            onMouseOut={e=>e.currentTarget.style.borderColor=d.b}
            onClick={()=>{
                  setCfaLevel(c.id);
                  try{localStorage.setItem("cfa_level",c.id);}catch(e){}
                  if(authSession?.access_token&&user?.id)fetch(`${SB_URL}/rest/v1/user_prefs`,{method:"POST",headers:{"apikey":SB_ANON,"Authorization":`Bearer ${authSession.access_token}`,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"},body:JSON.stringify({user_id:user.id,cfa_level:c.id})}).catch(()=>{});
                }}>
            <div style={{width:32,height:32,borderRadius:8,background:d.hover,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{c.icon}</div>
            <div style={{fontSize:13,fontWeight:500,color:d.t}}>{c.label}</div>
          </div>
        ))}
        <div style={{fontSize:10.5,color:d.t4,textAlign:"center",marginTop:12}}>you can change this later.</div>
      </div>
    </div>
  );

  const classLabel=CFA_LEVELS.find(c=>c.id===cfaLevel)?.label||'CFA Candidate';

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
          <Select value={timerTopic} onChange={setTimerTopic} options={[{value:"",label:"General Study"},...cfaTopics(timerSub).map(t=>({value:t,label:t}))]} disabled={timerOn} d={d}/>
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
      <style>{css}</style>
      <div className="layout" style={{visibility:fullscreen?"hidden":"visible"}}>
      {/* ── Sticky Banner Ad ── */}

        <div className="sb-overlay" onClick={()=>setSideOpen(false)}/>
        <aside className="sidebar">
          <div className="s-logo">
            <button className="s-toggle" onClick={()=>setSideOpen(p=>!p)}>{sideOpen?"‹":"›"}</button>
            <div className="s-brand">
              <span style={{fontSize:14,marginRight:4}}>🦥</span><span style={{fontWeight:800,letterSpacing:"-.04em",fontSize:15}}>Charter</span><span style={{fontWeight:800,letterSpacing:"-.04em",fontSize:15,color:d.a1}}>Run</span>
            </div>
          </div>
          <nav className="s-nav">
            <div className="s-sec" style={{marginTop:6}}>navigation</div>
            {TABS.map(t=>(
              <React.Fragment key={t.id}>
                {t.id==="home"&&<div className="s-sec">community</div>}
                {t.id==="coach"&&<div className="s-sec">study tools</div>}
                <div className={`s-item${tab===t.id?" active":""}`} onClick={()=>switchTab(t.id)} title={!sideOpen?t.label:""}>
                  <span className="s-icon">{t.icon}</span>
                  <span className="s-label">{t.label}</span>
                </div>
              </React.Fragment>
            ))}
            {sideOpen&&(
              <div style={{margin:"10px 4px 0",padding:"10px 11px",background:d.sa,borderRadius:3,border:`1px solid ${d.sab}`}}>
                <div style={{fontSize:9,color:d.t4,letterSpacing:".1em",textTransform:"uppercase",marginBottom:4}}>today</div>
                <div style={{fontSize:11.5,color:d.t2,marginBottom:5}}>{todayTime>0?`${fmt(todayTime)} today`:"0m today. the exam doesn't care."}</div>
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
                <div style={{fontSize:10,color:d.a1}}>{classLabel||'CFA Candidate'}</div>
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
          {true&&<div className="topbar">
            {/* App logo */}
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,flex:1}}>
              <button className="mob-btn" onClick={()=>setSideOpen(p=>!p)} aria-label="menu">☰</button>
              <div style={{minWidth:0}}>
                <div className="ptitle">{TABS.find(t=>t.id===tab)?.label}</div>
                <div className="psub">
                  {tab==="overview"&&`${new Date().toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})} · ${Math.max(0,Math.ceil((new Date("2026-11-18")-new Date())/86400000))}d to the exam.`}
                  {tab==="coach"&&"your personal CFA exam coach. i know where you're leaking marks."}
                  {tab==="goals"&&(todayGoals.length===0?"no goals. bold strategy.":todayGoals.filter(g=>g.achieved).length===todayGoals.length?`all ${todayGoals.length} done.`:`${todayGoals.filter(g=>g.achieved).length}/${todayGoals.length} done.`)}
                  
                  {tab==="sessions"&&`${sessions.length} study sessions · ${fmt(totalTime)} total.`}
                  {tab==="streaks"&&`${streak} day streak${currentMilestone?" · "+currentMilestone.icon+" "+currentMilestone.label:""}`}
                  {tab==="syllabus"&&"full CFA curriculum tracker. don't leave gaps."}
                </div>
              </div>
            </div>
            <div className="tbr">
              <button className="icon-btn" onClick={()=>setDark(p=>!p)}>{dark?"☀":"◑"}</button>
              <button className="ghost-sm" onClick={()=>setCfaLevel(null)}>switch class</button>
            </div>
          </div>}



          <div className="inner" style={{display:"block"}}>

            {/* ── SOCIAL TABS ── */}
            {tab==="home"&&<HomeGate user={user} d={d} dark={dark} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={authSession?.access_token} sessions={sessions} streak={streak} fmt={fmt} today={today} view="home"/>}
            {tab==="friends"&&<HomeGate user={user} d={d} dark={dark} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={authSession?.access_token} sessions={sessions} streak={streak} fmt={fmt} today={today} view="friends"/>}
            {tab==="leaderboard"&&<HomeGate user={user} d={d} dark={dark} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={authSession?.access_token} sessions={sessions} streak={streak} fmt={fmt} today={today} view="leaderboard"/>}
            {tab==="events"&&<HomeGate user={user} d={d} dark={dark} SB_URL={SB_URL} SB_ANON={SB_ANON} accessToken={authSession?.access_token} sessions={sessions} streak={streak} fmt={fmt} today={today} view="events"/>}

            {/* ── OVERVIEW ── */}
            {tab==="overview"&&(
              <div className="pin">
                {/* ── Hero stats — editorial wide layout ── */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:1,border:`1px solid ${d.b}`,borderRadius:2,overflow:"hidden",marginBottom:32,background:d.b}}>
                  {[
                    {lbl:"This Week",    val:fmt(weekTime),  hint:`${sessions.filter(s=>s.date>=weekStart).length} sessions. i saw every one. don't think i didn't notice.`,     color:d.a1},
                    {lbl:"Today",        val:fmt(todayTime), hint:todayTime===0?"oh you studied 0m? cute.":todayTime>=360?"okay you're actually good. don't let it go to your head.":`${fmt(todayTime)} logged. i saw every minute.`,color:todayTime>=360?d.a2:d.t},
                    {lbl:"Goals",        val:`${todayGoals.filter(g=>g.achieved).length}/${todayGoals.length||0}`, hint:todayGoals.filter(g=>g.achieved).length===todayGoals.length&&todayGoals.length>0?"i knew you had it. always did. 😏":"goals set. bold of you.", color:d.a2},
                    {lbl:"PYQ Accuracy", val:practiceAccuracy!==null?`${practiceAccuracy}%`:"—", hint:practiceAccuracy===null?"uncharted territory.":practiceAccuracy>=80?"okay you're actually good. don't let it go to your head.":"yeah we're fixing this. together.", color:d.a3},
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
                      const total=m.ethics+m.fi+m.equity;
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
                    <div className="field"><label className="fl">Topic</label><Select value={goalTopic} onChange={setGoalTopic} options={[{value:"",label:"All topics"},...cfaTopics(goalSub).map(t=>({value:t,label:t}))]} d={d}/></div>
                    <div className="field"><label className="fl">Type</label><Select value={goalType} onChange={setGoalType} options={[{value:"study",label:"Study (time)"},{value:"pyq",label:"Solve PYQs (count)"},{value:"revision",label:"Revision"}]} d={d}/></div>
                    <div className="field"><label className="fl">{goalType==="questions"?"Questions target":"Minutes target"}</label><input className="inp" type="number" placeholder={goalType==="questions"?"e.g. 15":"e.g. 90"} min="1" max={goalType==="questions"?"50":"480"} value={goalTarget} onChange={e=>setGoalTarget(e.target.value)}/></div>
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
                        const hGaps=Object.keys(TOPICS).flatMap(sub=>cfaTopics(sub).filter(t=>!sessions.some(s=>s.subject===sub&&s.topic===t)&&(CFA_WEIGHTAGE[sub]?.[t]||"M")==="H")).length;
                        const weakPyqs=studyLog.length;
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
                    const prog=g.type==="study"?sessions.filter(s=>s.date===today()&&s.subject===g.subject&&(!g.topic||s.topic===g.topic)).reduce((a,s)=>a+s.duration,0):g.type==="questions"?studyLog.filter(p=>p.date===today()&&p.subject===g.subject&&(!g.topic||p.topic===g.topic)).length:g.achieved?g.target:0;
                    const pct=Math.min((prog/g.target)*100,100);
                    return(
                      <div key={g.id} className={`goal-item${g.achieved?" achieved":""}`}>
                        <div className={`goal-check${g.achieved?" done":""}`} onClick={()=>setGoals(p=>p.map(x=>x.id===g.id?{...x,achieved:!x.achieved}:x))}>{g.achieved?"✓":""}</div>
                        <div className="f1">
                          <div className="rowb">
                            <div className={`goal-text${g.achieved?" done":""}`}>{g.text}</div>
                            {g.aiGenerated&&<div className="goal-ai-badge">AI</div>}
                          </div>
                          <div className="goal-meta"><span style={{color:SUBJECT_COLORS[g.subject]}}>{g.subject}</span>{g.topic&&<span> · {g.topic}</span>}<span> · {g.type==="questions"?`${prog}/${g.target} Qs`:`${fmt(prog)} / ${fmt(g.target)}`}</span>{g.reasoning&&<span style={{color:d.t4}}> — {g.reasoning}</span>}</div>
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
              const sorted=sub=>[...allChapters(sub)].sort((a,b)=>(WT_ORDER[CFA_WEIGHTAGE[sub]?.[a]||"M"]||1)-(WT_ORDER[CFA_WEIGHTAGE[sub]?.[b]||"M"]||1));
              const chHrs=(sub,t)=>sessions.filter(s=>s.subject===sub&&s.topic===t).reduce((a,s)=>a+(s.duration||0),0);
              const chAcc=(sub,t)=>{const qs=studyLog.filter(p=>p.subject===sub&&p.topic===t);return qs.length?Math.round(qs.filter(p=>p.correct).length/qs.length*100):null;};
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
                        <div style={{fontSize:16,fontWeight:700,color:d.t}}>{Math.max(0,Math.ceil((new Date("2026-11-18")-new Date())/86400000))}d left</div>
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
                          const wtCh=chapters.filter(t=>(CFA_WEIGHTAGE[sub]?.[t]||"M")===wt);
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
                      {[{lbl:"streak",val:`${streak}d`,c:d.a1},{lbl:"study days",val:new Set(sessions.map(s=>s.date)).size,c:d.a2},{lbl:"total sessions",val:sessions.length,c:d.a3},{lbl:"PYQs solved",val:studyLog.length,c:d.gold}].map(s=>(
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

    </>
  );
}

