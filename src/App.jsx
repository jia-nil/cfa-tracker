import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import './App.css'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SUBJECTS = ['Physics', 'Mathematics', 'Chemistry']

const CHAPTER_DATA = {
  Physics: [
    'Kinematics', 'Laws of Motion', 'Work, Energy & Power', 'Rotational Motion',
    'Gravitation', 'Properties of Matter', 'SHM & Waves', 'Thermodynamics',
    'Electrostatics', 'Current Electricity', 'Magnetism', 'EMI & AC Circuits',
    'Optics', 'Modern Physics', 'Semiconductors',
  ],
  Mathematics: [
    'Complex Numbers', 'Quadratic Equations', 'Sequences & Series', 'Binomial Theorem',
    'Permutation & Combination', 'Probability', 'Matrices & Determinants',
    'Straight Lines', 'Circles', 'Conic Sections', 'Limits & Continuity',
    'Differentiation', 'Applications of Derivatives', 'Indefinite Integrals',
    'Definite Integrals', 'Differential Equations', 'Vectors', '3D Geometry',
  ],
  Chemistry: [
    'Mole Concept', 'Atomic Structure', 'Chemical Bonding', 'States of Matter',
    'Thermodynamics', 'Equilibrium', 'Redox Reactions', 'Electrochemistry',
    'Chemical Kinetics', 'Nuclear Chemistry', 'GOC', 'Hydrocarbons',
    'Halides & Alcohols', 'Carbonyl Compounds', 'Coordination Compounds',
    'p-Block Elements', 'd-Block Elements', 'Biomolecules',
  ],
}

const STATUS_CONFIG = {
  todo:      { label: 'Not started', color: '#888780', bg: '#F1EFE8' },
  progress:  { label: 'In Progress', color: '#BA7517', bg: '#FAEEDA' },
  revision:  { label: 'Revision',    color: '#534AB7', bg: '#EEEDFE' },
  done:      { label: 'Done ✓',      color: '#0F6E56', bg: '#E1F5EE' },
}

// ─── ROOT ────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) return
    fetchOrCreateProfile(session.user)
  }, [session])

  async function fetchOrCreateProfile(user) {
    let { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!data) {
      const handle = user.email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase()
      const { data: created } = await supabase.from('profiles').insert({
        id: user.id,
        full_name: user.user_metadata?.full_name || user.email.split('@')[0],
        avatar_url: user.user_metadata?.avatar_url || null,
        handle,
        target_college: 'IIT Bombay',
        bio: 'JEE Aspirant 🚀',
      }).select().single()
      data = created
    }
    setProfile(data)
  }

  if (loading) return <Splash />
  if (!session) return <AuthPage />
  if (!profile) return <Splash />
  return <MainApp session={session} profile={profile} setProfile={setProfile} />
}

// ─── SPLASH ───────────────────────────────────────────────────────────────────

function Splash() {
  return (
    <div className="splash">
      <div className="splash-logo">⚡</div>
      <div className="splash-name">StudyRun</div>
      <div className="splash-loader"><div className="splash-bar" /></div>
    </div>
  )
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function AuthPage() {
  const [loading, setLoading] = useState(false)
  async function signInWithGoogle() {
    setLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">⚡ StudyRun</div>
        <div className="auth-tagline">JEE prep, social and serious.</div>
        <div className="auth-features">
          <span>📊 Track every session</span>
          <span>🏆 Compete on leaderboards</span>
          <span>⚡ Join study events</span>
          <span>👥 Follow top rankers</span>
        </div>
        <button className="google-btn" onClick={signInWithGoogle} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
          {loading ? 'Signing in…' : 'Continue with Google'}
        </button>
        <p className="auth-note">Free for JEE aspirants</p>
      </div>
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

function MainApp({ session, profile, setProfile }) {
  const [page, setPage] = useState('feed')
  const [viewingProfile, setViewingProfile] = useState(null) // userId of profile being viewed
  const [modal, setModal] = useState(null) // 'log'
  const [modalData, setModalData] = useState(null)

  // session timer
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerRef = useRef(null)
  const timerSecondsRef = useRef(0) // always-current mirror, safe to read in closures

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds(s => {
          timerSecondsRef.current = s + 1
          return s + 1
        })
      }, 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [timerRunning])

  function startTimer() { setTimerSeconds(0); timerSecondsRef.current = 0; setTimerRunning(true) }
  function stopTimer() {
    setTimerRunning(false)
    const elapsed = timerSecondsRef.current
    if (elapsed > 30) {
      setModal('log')
      setModalData({ duration: elapsed })
    }
  }

  function openProfilePage(userId) { setViewingProfile(userId); setPage('profile') }

  const nav = (pg) => { setPage(pg); setViewingProfile(null) }

  return (
    <div className="app-shell">
      <Sidebar page={page} nav={nav} profile={profile} timerRunning={timerRunning} />

      <div className="app-content">
        {page === 'feed' && (
          <FeedPage
            profile={profile}
            timerRunning={timerRunning}
            timerSeconds={timerSeconds}
            onStart={startTimer}
            onStop={stopTimer}
            onOpenProfile={openProfilePage}
          />
        )}
        {page === 'events' && <EventsPage profile={profile} onOpenProfile={openProfilePage} />}
        {page === 'leaderboard' && <LeaderboardPage profile={profile} onOpenProfile={openProfilePage} />}
        {page === 'explore' && <ExplorePage profile={profile} onOpenProfile={openProfilePage} />}
        {page === 'chapters' && <ChaptersPage profile={profile} />}
        {page === 'profile' && (
          <ProfilePage
            profile={profile}
            setProfile={setProfile}
            viewingId={viewingProfile || session.user.id}
            isOwn={!viewingProfile || viewingProfile === session.user.id}
            onOpenProfile={openProfilePage}
          />
        )}
      </div>

      {modal === 'log' && (
        <LogSessionModal
          profile={profile}
          durationSeconds={modalData?.duration || 0}
          onClose={() => setModal(null)}
          onPosted={() => { setModal(null); nav('feed') }}
        />
      )}

      {/* EditProfileModal is triggered inline inside ProfilePage, not via MainApp modal */}
    </div>
  )
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────

function Sidebar({ page, nav, profile, timerRunning }) {
  async function signOut() {
    await supabase.auth.signOut()
    window.location.reload()
  }
  const navItems = [
    { id: 'feed',        icon: 'home',          label: 'Feed' },
    { id: 'events',      icon: 'calendar-event', label: 'Events' },
    { id: 'leaderboard', icon: 'trophy',         label: 'Leaderboard' },
    { id: 'explore',     icon: 'users',          label: 'Explore' },
  ]
  const myItems = [
    { id: 'chapters', icon: 'book',  label: 'Chapters' },
    { id: 'profile',  icon: 'user',  label: 'My Profile' },
  ]
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logomark">⚡ StudyRun</span>
        <span className="sidebar-tagline">JEE social tracker</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item${page === item.id ? ' active' : ''}`}
            onClick={() => nav(item.id)}
          >
            <i className={`ti ti-${item.icon}`} aria-hidden="true" />
            {item.label}
            {item.id === 'feed' && timerRunning && <span className="timer-dot" />}
          </button>
        ))}
        <div className="nav-section-label">My Progress</div>
        {myItems.map(item => (
          <button
            key={item.id}
            className={`nav-item${page === item.id ? ' active' : ''}`}
            onClick={() => nav(item.id)}
          >
            <i className={`ti ti-${item.icon}`} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-user" onClick={() => nav('profile')}>
          <Avatar profile={profile} size={32} />
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{profile.full_name}</span>
            <span className="sidebar-user-handle">@{profile.handle}</span>
          </div>
        </button>
        <button className="signout-btn" onClick={signOut} title="Sign out">
          <i className="ti ti-logout" aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}

// ─── FEED PAGE ────────────────────────────────────────────────────────────────

function FeedPage({ profile, timerRunning, timerSeconds, onStart, onStop, onOpenProfile }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchFeed() }, [])

  async function fetchFeed() {
    setLoading(true)
    // Get people this user follows + own posts
    const { data: follows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', profile.id)

    const followIds = (follows || []).map(f => f.following_id)
    const feedIds = [profile.id, ...followIds]

    const { data } = await supabase
      .from('study_sessions')
      .select(`
        *,
        profiles:user_id ( id, full_name, handle, avatar_url, avatar_color ),
        kudos:session_kudos ( user_id )
      `)
      .in('user_id', feedIds)
      .order('created_at', { ascending: false })
      .limit(30)

    // Derive kudos count and whether current user has kudosed — from embedded rows
    setPosts((data || []).map(s => ({
      ...s,
      kudos_count: (s.kudos || []).length,
      kudos_given: (s.kudos || []).some(k => k.user_id === profile.id),
    })))
    setLoading(false)
  }

  async function toggleKudos(post) {
    if (post.user_id === profile.id) return
    if (post.kudos_given) {
      await supabase.from('session_kudos').delete()
        .eq('session_id', post.id).eq('user_id', profile.id)
    } else {
      await supabase.from('session_kudos').insert({ session_id: post.id, user_id: profile.id })
    }
    setPosts(prev => prev.map(p => p.id === post.id
      ? { ...p, kudos_given: !p.kudos_given, kudos_count: p.kudos_count + (p.kudos_given ? -1 : 1) }
      : p
    ))
  }

  return (
    <div className="page-layout two-col">
      <div className="col-main">
        <h1 className="page-title">Feed</h1>

        {/* Session starter card */}
        <div className="card session-card">
          <StreakWidget profile={profile} />
          <button
            className={`session-btn${timerRunning ? ' recording' : ''}`}
            onClick={timerRunning ? onStop : onStart}
          >
            <i className={`ti ti-${timerRunning ? 'player-stop' : 'player-play'}`} aria-hidden="true" />
            {timerRunning ? 'Stop & Log Session' : 'Start Study Session'}
          </button>
          {timerRunning && (
            <div className="timer-display">
              <span className="timer-time">{formatTime(timerSeconds)}</span>
              <span className="timer-label">session in progress</span>
            </div>
          )}
        </div>

        {loading ? <Spinner /> : posts.length === 0 ? (
          <EmptyState
            icon="users"
            title="Your feed is empty"
            desc="Follow other students to see their sessions here, or log your first session!"
          />
        ) : posts.map(post => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={profile.id}
            onKudos={() => toggleKudos(post)}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </div>

      <div className="col-side">
        <MyStatsWidget profile={profile} />
        <LiveEventsWidget />
        <SuggestionsWidget profile={profile} onOpenProfile={onOpenProfile} />
      </div>
    </div>
  )
}

// ─── POST CARD ────────────────────────────────────────────────────────────────

function PostCard({ post, currentUserId, onKudos, onOpenProfile }) {
  const user = post.profiles
  const subjectColors = {
    Physics: { bg: '#E6F1FB', color: '#0C447C' },
    Mathematics: { bg: '#E1F5EE', color: '#085041' },
    Chemistry: { bg: '#FAEEDA', color: '#633806' },
  }
  const sc = subjectColors[post.subject] || { bg: '#F1EFE8', color: '#444441' }
  const mins = Math.floor(post.duration_seconds / 60)
  const hrs = Math.floor(mins / 60)
  const displayDur = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`

  return (
    <div className="card post-card">
      <div className="post-header">
        <button className="post-avatar-btn" onClick={() => onOpenProfile(user.id)}>
          <Avatar profile={user} size={36} />
        </button>
        <div className="post-meta">
          <div className="post-meta-top">
            <button className="post-username" onClick={() => onOpenProfile(user.id)}>
              {user.full_name}
            </button>
            <span className="subject-badge" style={{ background: sc.bg, color: sc.color }}>
              {post.subject}
            </span>
          </div>
          <span className="post-time">{timeAgo(post.created_at)}</span>
        </div>
      </div>

      <div className="post-title">{post.title}</div>
      {post.notes && <div className="post-notes">{post.notes}</div>}

      <div className="post-stats-grid">
        <div className="pstat">
          <span className="pstat-val">{displayDur}</span>
          <span className="pstat-lbl">Duration</span>
        </div>
        <div className="pstat">
          <span className="pstat-val">{post.problems_solved ?? '—'}</span>
          <span className="pstat-lbl">Problems</span>
        </div>
        <div className="pstat">
          <span className="pstat-val">{post.accuracy_pct != null ? `${post.accuracy_pct}%` : '—'}</span>
          <span className="pstat-lbl">Accuracy</span>
        </div>
      </div>

      <div className="post-actions">
        <button
          className={`action-btn${post.kudos_given ? ' kudosed' : ''}`}
          onClick={onKudos}
          disabled={post.user_id === currentUserId}
        >
          <i className={`ti ti-heart${post.kudos_given ? '-filled' : ''}`} aria-hidden="true" />
          {post.kudos_count} Kudos
        </button>
        <button className="action-btn">
          <i className="ti ti-message-circle" aria-hidden="true" />
          Comment
        </button>
        <button className="action-btn" style={{ marginLeft: 'auto' }}>
          <i className="ti ti-share" aria-hidden="true" />
          Share
        </button>
      </div>
    </div>
  )
}

// ─── EVENTS PAGE ──────────────────────────────────────────────────────────────

function EventsPage({ profile, onOpenProfile }) {
  const [events, setEvents] = useState([])
  const [registered, setRegistered] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchEvents()
  }, [])

  async function fetchEvents() {
    setLoading(true)
    const { data: evts } = await supabase
      .from('events')
      .select('*, event_registrations(count)')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })

    const { data: myRegs } = await supabase
      .from('event_registrations')
      .select('event_id')
      .eq('user_id', profile.id)

    setEvents(evts || [])
    setRegistered(new Set((myRegs || []).map(r => r.event_id)))
    setLoading(false)
  }

  async function toggleRegister(eventId) {
    if (registered.has(eventId)) {
      await supabase.from('event_registrations')
        .delete().eq('event_id', eventId).eq('user_id', profile.id)
      setRegistered(prev => { const s = new Set(prev); s.delete(eventId); return s })
    } else {
      await supabase.from('event_registrations')
        .insert({ event_id: eventId, user_id: profile.id })
      setRegistered(prev => new Set([...prev, eventId]))
    }
  }

  const isLive = (evt) => {
    const now = new Date()
    return new Date(evt.starts_at) <= now && new Date(evt.ends_at) >= now
  }

  const subjectBadgeStyle = (subject) => {
    const map = {
      Physics: { bg: '#E6F1FB', color: '#0C447C' },
      Mathematics: { bg: '#E1F5EE', color: '#085041' },
      Chemistry: { bg: '#FAEEDA', color: '#633806' },
      'All Subjects': { bg: '#EEEDFE', color: '#3C3489' },
    }
    return map[subject] || { bg: '#F1EFE8', color: '#444441' }
  }

  return (
    <div className="page-layout two-col">
      <div className="col-main">
        <h1 className="page-title">Events</h1>
        <p className="page-subtitle">Compete with peers in timed study challenges</p>

        {loading ? <Spinner /> : events.length === 0 ? (
          <EmptyState icon="calendar-event" title="No upcoming events" desc="Check back soon — events are added weekly." />
        ) : events.map(evt => {
          const live = isLive(evt)
          const sc = subjectBadgeStyle(evt.subject)
          const participantCount = evt.event_registrations?.[0]?.count || 0
          return (
            <div className="card event-full-card" key={evt.id}>
              <div className="event-card-header">
                <div>
                  <div className="event-title-row">
                    <span className="event-title">{evt.name}</span>
                    {live
                      ? <span className="event-status-badge live">🔴 Live now</span>
                      : <span className="event-status-badge upcoming">Upcoming</span>}
                  </div>
                  <span className="subject-badge" style={{ background: sc.bg, color: sc.color, marginTop: 4, display: 'inline-block' }}>
                    {evt.subject}
                  </span>
                </div>
              </div>
              <p className="event-desc">{evt.description}</p>
              <div className="event-meta-row">
                <span className="event-meta-item">
                  <i className="ti ti-calendar" aria-hidden="true" />
                  {formatEventDate(evt.starts_at)}
                </span>
                <span className="event-meta-item">
                  <i className="ti ti-clock" aria-hidden="true" />
                  {durationLabel(evt.starts_at, evt.ends_at)}
                </span>
                <span className="event-meta-item">
                  <i className="ti ti-users" aria-hidden="true" />
                  {participantCount} registered
                </span>
              </div>
              <button
                className={`event-join-btn${registered.has(evt.id) ? ' registered' : ''}${live ? ' live-btn' : ''}`}
                onClick={() => toggleRegister(evt.id)}
              >
                {registered.has(evt.id)
                  ? (live ? '✓ Joined — good luck!' : '✓ Registered — cancel?')
                  : (live ? 'Join live session' : 'Register for event')}
              </button>
            </div>
          )
        })}
      </div>

      <div className="col-side">
        <MyEventsWidget profile={profile} />
        <BadgesWidget profile={profile} />
      </div>
    </div>
  )
}

// ─── LEADERBOARD PAGE ─────────────────────────────────────────────────────────

function LeaderboardPage({ profile, onOpenProfile }) {
  const [board, setBoard] = useState([])
  const [period, setPeriod] = useState('all') // 'all' | 'week' | 'month'
  const [subject, setSubject] = useState('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchBoard() }, [period, subject])

  async function fetchBoard() {
    setLoading(true)
    let query = supabase
      .from('study_sessions')
      .select('user_id, duration_seconds, subject, profiles:user_id(id, full_name, handle, avatar_url, avatar_color)')

    if (period === 'week') {
      const since = new Date(); since.setDate(since.getDate() - 7)
      query = query.gte('created_at', since.toISOString())
    } else if (period === 'month') {
      const since = new Date(); since.setMonth(since.getMonth() - 1)
      query = query.gte('created_at', since.toISOString())
    }
    if (subject !== 'All') query = query.eq('subject', subject)

    const { data } = await query

    // Aggregate by user
    const map = {}
    ;(data || []).forEach(s => {
      const uid = s.user_id
      if (!map[uid]) map[uid] = { profile: s.profiles, total_seconds: 0 }
      map[uid].total_seconds += s.duration_seconds
    })

    const sorted = Object.values(map)
      .sort((a, b) => b.total_seconds - a.total_seconds)
      .slice(0, 50)

    setBoard(sorted)
    setLoading(false)
  }

  const myRank = board.findIndex(e => e.profile?.id === profile.id) + 1

  return (
    <div className="page-layout two-col">
      <div className="col-main">
        <h1 className="page-title">Leaderboard</h1>

        <div className="lb-filters">
          <div className="pill-group">
            {['all', 'week', 'month'].map(p => (
              <button
                key={p}
                className={`pill${period === p ? ' active' : ''}`}
                onClick={() => setPeriod(p)}
              >
                {p === 'all' ? 'All time' : p === 'week' ? 'This week' : 'This month'}
              </button>
            ))}
          </div>
          <div className="pill-group">
            {['All', ...SUBJECTS].map(s => (
              <button
                key={s}
                className={`pill${subject === s ? ' active' : ''}`}
                onClick={() => setSubject(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          {loading ? <Spinner /> : board.length === 0 ? (
            <EmptyState icon="trophy" title="No data yet" desc="Be the first to log a session!" />
          ) : board.filter(entry => entry.profile != null).map((entry, i) => {
            const isMe = entry.profile.id === profile.id
            return (
              <div key={entry.profile.id} className={`lb-row${isMe ? ' lb-me' : ''}`}>
                <span className={`lb-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <button className="lb-avatar-btn" onClick={() => onOpenProfile(entry.profile.id)}>
                  <Avatar profile={entry.profile} size={32} />
                </button>
                <div className="lb-info">
                  <button className="lb-name" onClick={() => onOpenProfile(entry.profile.id)}>
                    {entry.profile.full_name} {isMe && <span className="you-tag">you</span>}
                  </button>
                  <span className="lb-handle">@{entry.profile.handle}</span>
                </div>
                <div className="lb-hours">{formatHours(entry.total_seconds)}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="col-side">
        <div className="card">
          <div className="widget-title">Your position</div>
          <div className="rank-highlight">
            <span className="rank-big">{myRank > 0 ? `#${myRank}` : '—'}</span>
            <span className="rank-sub">out of {board.filter(e => e.profile).length} students</span>
          </div>
        </div>
        <SubjectRankWidget profile={profile} />
      </div>
    </div>
  )
}

// ─── EXPLORE PAGE ─────────────────────────────────────────────────────────────

function ExplorePage({ profile, onOpenProfile }) {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [following, setFollowing] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    setLoading(true)
    const { data: all } = await supabase
      .from('profiles')
      .select('id, full_name, handle, avatar_url, avatar_color, target_college, bio')
      .neq('id', profile.id)
      .order('full_name')

    const { data: myFollows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', profile.id)

    setUsers(all || [])
    setFollowing(new Set((myFollows || []).map(f => f.following_id)))
    setLoading(false)
  }

  async function toggleFollow(userId) {
    if (following.has(userId)) {
      await supabase.from('follows').delete()
        .eq('follower_id', profile.id).eq('following_id', userId)
      setFollowing(prev => { const s = new Set(prev); s.delete(userId); return s })
    } else {
      await supabase.from('follows').insert({ follower_id: profile.id, following_id: userId })
      setFollowing(prev => new Set([...prev, userId]))
    }
  }

  const filtered = users.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.handle?.toLowerCase().includes(search.toLowerCase()) ||
    u.target_college?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="page-layout two-col">
      <div className="col-main">
        <h1 className="page-title">Explore Students</h1>
        <div className="search-wrap">
          <i className="ti ti-search search-icon" aria-hidden="true" />
          <input
            className="search-input"
            type="text"
            placeholder="Search by name, handle, or target college…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? <Spinner /> : filtered.length === 0 ? (
          <EmptyState icon="search" title="No students found" desc="Try a different search." />
        ) : filtered.map(u => (
          <div key={u.id} className="card explore-card">
            <button className="explore-avatar-btn" onClick={() => onOpenProfile(u.id)}>
              <Avatar profile={u} size={44} />
            </button>
            <div className="explore-info">
              <button className="explore-name" onClick={() => onOpenProfile(u.id)}>{u.full_name}</button>
              <span className="explore-handle">@{u.handle}</span>
              {u.target_college && <span className="explore-target">🎯 {u.target_college}</span>}
            </div>
            <button
              className={`follow-btn${following.has(u.id) ? ' following' : ''}`}
              onClick={() => toggleFollow(u.id)}
            >
              {following.has(u.id) ? 'Following' : 'Follow'}
            </button>
          </div>
        ))}
      </div>

      <div className="col-side">
        <TrendingChaptersWidget />
      </div>
    </div>
  )
}

// ─── CHAPTERS PAGE ────────────────────────────────────────────────────────────

function ChaptersPage({ profile }) {
  const [activeSubject, setActiveSubject] = useState('Physics')
  const [progress, setProgress] = useState({}) // { [subject_chapter]: status }
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchProgress() }, [])

  async function fetchProgress() {
    setLoading(true)
    const { data } = await supabase
      .from('chapter_progress')
      .select('subject, chapter, status')
      .eq('user_id', profile.id)

    const map = {}
    ;(data || []).forEach(r => { map[`${r.subject}__${r.chapter}`] = r.status })
    setProgress(map)
    setLoading(false)
  }

  async function updateStatus(subject, chapter, status) {
    const key = `${subject}__${chapter}`
    setProgress(prev => ({ ...prev, [key]: status }))

    await supabase.from('chapter_progress').upsert({
      user_id: profile.id,
      subject,
      chapter,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,subject,chapter' })
  }

  const chapters = CHAPTER_DATA[activeSubject] || []
  const done = chapters.filter(c => progress[`${activeSubject}__${c}`] === 'done').length

  return (
    <div className="page-layout two-col">
      <div className="col-main">
        <h1 className="page-title">Chapter Tracker</h1>

        <div className="tab-bar">
          {SUBJECTS.map(s => (
            <button
              key={s}
              className={`tab${activeSubject === s ? ' active' : ''}`}
              onClick={() => setActiveSubject(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="progress-header">
            <span>{done}/{chapters.length} chapters done</span>
            <span className="progress-pct">{Math.round((done / chapters.length) * 100)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round((done / chapters.length) * 100)}%` }} />
          </div>
        </div>

        {loading ? <Spinner /> : (
          <div className="card">
            {chapters.map(chapter => {
              const key = `${activeSubject}__${chapter}`
              const status = progress[key] || 'todo'
              const sc = STATUS_CONFIG[status]
              return (
                <div key={chapter} className="chapter-row">
                  <span className="chapter-name">{chapter}</span>
                  <select
                    className="status-select"
                    value={status}
                    onChange={e => updateStatus(activeSubject, chapter, e.target.value)}
                    style={{ background: sc.bg, color: sc.color }}
                  >
                    {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
                      <option key={val} value={val}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="col-side">
        <AllSubjectProgressWidget progress={progress} />
      </div>
    </div>
  )
}

// ─── PROFILE PAGE ─────────────────────────────────────────────────────────────

function ProfilePage({ profile, setProfile, viewingId, isOwn, onOpenProfile }) {
  const [viewedProfile, setViewedProfile] = useState(null)
  const [posts, setPosts] = useState([])
  const [stats, setStats] = useState({ totalHours: 0, streak: 0, followers: 0, following: 0 })
  const [isFollowing, setIsFollowing] = useState(false)
  const [tab, setTab] = useState('sessions')
  const [showEditModal, setShowEditModal] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadProfile() }, [viewingId])

  async function loadProfile() {
    setLoading(true)
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', viewingId).single()
    setViewedProfile(prof)

    // Sessions — embed kudos rows so we can count & check current user's kudos inline
    const { data: sessions } = await supabase
      .from('study_sessions')
      .select('*, kudos:session_kudos(user_id)')
      .eq('user_id', viewingId)
      .order('created_at', { ascending: false })
      .limit(20)

    // Stats
    const totalSecs = (sessions || []).reduce((sum, s) => sum + s.duration_seconds, 0)

    const { count: followers } = await supabase.from('follows')
      .select('*', { count: 'exact', head: true }).eq('following_id', viewingId)
    const { count: followingCount } = await supabase.from('follows')
      .select('*', { count: 'exact', head: true }).eq('follower_id', viewingId)

    // Is current user following this profile?
    if (!isOwn) {
      const { data: fol } = await supabase.from('follows')
        .select('id').eq('follower_id', profile.id).eq('following_id', viewingId).single()
      setIsFollowing(!!fol)
    }

    // Derive kudos count and whether current user has kudosed — from embedded rows
    setPosts((sessions || []).map(s => ({
      ...s,
      profiles: prof,
      kudos_count: (s.kudos || []).length,
      kudos_given: (s.kudos || []).some(k => k.user_id === profile.id),
    })))
    setStats({ totalHours: totalSecs / 3600, followers: followers || 0, following: followingCount || 0, streak: 0 })
    setLoading(false)
  }

  async function toggleFollow() {
    if (isFollowing) {
      await supabase.from('follows').delete()
        .eq('follower_id', profile.id).eq('following_id', viewingId)
      setIsFollowing(false)
      setStats(s => ({ ...s, followers: s.followers - 1 }))
    } else {
      await supabase.from('follows').insert({ follower_id: profile.id, following_id: viewingId })
      setIsFollowing(true)
      setStats(s => ({ ...s, followers: s.followers + 1 }))
    }
  }

  async function toggleKudos(post) {
    if (post.user_id === profile.id) return
    if (post.kudos_given) {
      await supabase.from('session_kudos').delete().eq('session_id', post.id).eq('user_id', profile.id)
    } else {
      await supabase.from('session_kudos').insert({ session_id: post.id, user_id: profile.id })
    }
    setPosts(prev => prev.map(p => p.id === post.id
      ? { ...p, kudos_given: !p.kudos_given, kudos_count: p.kudos_count + (p.kudos_given ? -1 : 1) }
      : p
    ))
  }

  if (loading || !viewedProfile) return <Spinner />

  return (
    <div className="page-layout two-col">
      <div className="col-main">
        {/* Profile header */}
        <div className="card profile-card">
          <div className="profile-banner" style={{ background: avatarBg(viewedProfile) }} />
          <div className="profile-body">
            <div className="profile-top-row">
              <Avatar profile={viewedProfile} size={56} border />
              {isOwn
                ? <button className="btn-outline" onClick={() => setShowEditModal(true)}>Edit profile</button>
                : <button className={`follow-btn${isFollowing ? ' following' : ''}`} onClick={toggleFollow}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>}
            </div>
            <div className="profile-name">{viewedProfile.full_name}</div>
            <div className="profile-handle">@{viewedProfile.handle}</div>
            {viewedProfile.bio && <div className="profile-bio">{viewedProfile.bio}</div>}
            {viewedProfile.target_college && (
              <div className="profile-target">🎯 {viewedProfile.target_college}</div>
            )}
            <div className="profile-stats-row">
              <div className="pstat-col">
                <span className="pstat-big">{stats.totalHours.toFixed(0)}h</span>
                <span className="pstat-sm">studied</span>
              </div>
              <div className="pstat-col">
                <span className="pstat-big">{stats.followers}</span>
                <span className="pstat-sm">followers</span>
              </div>
              <div className="pstat-col">
                <span className="pstat-big">{stats.following}</span>
                <span className="pstat-sm">following</span>
              </div>
              <div className="pstat-col">
                <span className="pstat-big">{posts.length}</span>
                <span className="pstat-sm">sessions</span>
              </div>
            </div>
          </div>
        </div>

        <div className="tab-bar">
          <button className={`tab${tab === 'sessions' ? ' active' : ''}`} onClick={() => setTab('sessions')}>Sessions</button>
          <button className={`tab${tab === 'stats' ? ' active' : ''}`} onClick={() => setTab('stats')}>Stats</button>
        </div>

        {tab === 'sessions' && (
          posts.length === 0
            ? <EmptyState icon="book" title="No sessions yet" desc="Sessions posted here after logging." />
            : posts.map(p => (
                <PostCard key={p.id} post={p} currentUserId={profile.id} onKudos={() => toggleKudos(p)} onOpenProfile={onOpenProfile} />
              ))
        )}
        {tab === 'stats' && <ProfileStatsTab sessions={posts} />}
      </div>

      <div className="col-side">
        <SubjectBreakdownWidget sessions={posts} />
        <BadgesWidget profile={viewedProfile} />
      </div>

      {showEditModal && (
        <EditProfileModal
          profile={profile}
          setProfile={setProfile}
          onClose={() => { setShowEditModal(false); loadProfile() }}
        />
      )}
    </div>
  )
}

// ─── MODALS ───────────────────────────────────────────────────────────────────

function LogSessionModal({ profile, durationSeconds, onClose, onPosted }) {
  const [form, setForm] = useState({
    title: '',
    subject: 'Physics',
    problems_solved: '',
    accuracy_pct: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!form.title.trim()) return
    setSaving(true)
    await supabase.from('study_sessions').insert({
      user_id: profile.id,
      title: form.title,
      subject: form.subject,
      duration_seconds: durationSeconds,
      problems_solved: form.problems_solved ? parseInt(form.problems_solved) : null,
      accuracy_pct: form.accuracy_pct ? parseInt(form.accuracy_pct) : null,
      notes: form.notes || null,
    })
    setSaving(false)
    onPosted()
  }

  return (
    <Modal title="Log study session" onClose={onClose}>
      <div className="field-group">
        <label className="field-label">Session title *</label>
        <input
          type="text"
          placeholder="e.g. Electrostatics + Current Electricity"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        />
      </div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Subject</label>
          <select value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Problems solved</label>
          <input type="number" min="0" placeholder="0" value={form.problems_solved}
            onChange={e => setForm(f => ({ ...f, problems_solved: e.target.value }))} />
        </div>
        <div className="field-group">
          <label className="field-label">Accuracy %</label>
          <input type="number" min="0" max="100" placeholder="—" value={form.accuracy_pct}
            onChange={e => setForm(f => ({ ...f, accuracy_pct: e.target.value }))} />
        </div>
      </div>
      <div className="field-group">
        <label className="field-label">Notes</label>
        <textarea
          placeholder="What did you cover? Any breakthroughs or struggles?"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
        />
      </div>
      <div className="session-summary-row">
        <i className="ti ti-clock" aria-hidden="true" />
        Duration logged: <strong>{formatTime(durationSeconds)}</strong>
      </div>
      <div className="modal-footer">
        <button className="btn-outline" onClick={onClose}>Discard</button>
        <button className="btn-primary" onClick={submit} disabled={saving || !form.title.trim()}>
          {saving ? 'Posting…' : 'Post to feed'}
        </button>
      </div>
    </Modal>
  )
}

function EditProfileModal({ profile, setProfile, onClose }) {
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    handle: profile.handle || '',
    bio: profile.bio || '',
    target_college: profile.target_college || '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const { data } = await supabase
      .from('profiles')
      .update(form)
      .eq('id', profile.id)
      .select()
      .single()
    if (data) setProfile(data)
    setSaving(false)
    onClose()
  }

  return (
    <Modal title="Edit profile" onClose={onClose}>
      <div className="field-group">
        <label className="field-label">Display name</label>
        <input type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
      </div>
      <div className="field-group">
        <label className="field-label">Handle</label>
        <input type="text" value={form.handle} onChange={e => setForm(f => ({ ...f, handle: e.target.value }))} />
      </div>
      <div className="field-group">
        <label className="field-label">Bio</label>
        <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} rows={2} />
      </div>
      <div className="field-group">
        <label className="field-label">Target college</label>
        <input type="text" placeholder="e.g. IIT Bombay" value={form.target_college}
          onChange={e => setForm(f => ({ ...f, target_college: e.target.value }))} />
      </div>
      <div className="modal-footer">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── WIDGETS ──────────────────────────────────────────────────────────────────

function StreakWidget({ profile }) {
  const [streak, setStreak] = useState(0)
  const [days, setDays] = useState([])
  useEffect(() => {
    ;(async () => {
      // Fetch sessions from the last 30 days to compute a real consecutive streak
      const since = new Date(); since.setDate(since.getDate() - 29)
      const { data } = await supabase
        .from('study_sessions')
        .select('created_at')
        .eq('user_id', profile.id)
        .gte('created_at', since.toISOString())
      const activeDays = new Set((data || []).map(s => new Date(s.created_at).toDateString()))

      // Last 7 days for visual dots
      const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i))
        return { date: d, active: activeDays.has(d.toDateString()), isToday: i === 6 }
      })
      setDays(last7)

      // Consecutive streak: count backwards from today, stop at first gap
      let streakCount = 0
      for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i)
        if (activeDays.has(d.toDateString())) {
          streakCount++
        } else {
          // Allow today to not count yet (just started) — break only if yesterday is also missing
          if (i > 0) break
        }
      }
      setStreak(streakCount)
    })()
  }, [])
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  return (
    <div className="streak-widget">
      <span className="streak-count">{streak > 0 ? `🔥 ${streak}-day streak` : 'Start your streak today!'}</span>
      <div className="streak-dots">
        {days.map((d, i) => (
          <div key={i} className={`streak-dot${d.active ? ' active' : ''}${d.isToday ? ' today' : ''}`}
            title={d.date.toDateString()}>
            {dayLabels[d.date.getDay()]}
          </div>
        ))}
      </div>
    </div>
  )
}

function MyStatsWidget({ profile }) {
  const [stats, setStats] = useState({ totalH: 0, weekH: 0 })
  useEffect(() => {
    ;(async () => {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
      const { data: all } = await supabase.from('study_sessions').select('duration_seconds, created_at').eq('user_id', profile.id)
      const total = (all || []).reduce((s, r) => s + r.duration_seconds, 0)
      const week = (all || []).filter(r => new Date(r.created_at) > weekAgo).reduce((s, r) => s + r.duration_seconds, 0)
      setStats({ totalH: total / 3600, weekH: week / 3600 })
    })()
  }, [])
  return (
    <div className="card">
      <div className="widget-title">Your stats</div>
      <div className="stats-2x2">
        <div className="stat-box"><span className="stat-val">{stats.totalH.toFixed(0)}h</span><span className="stat-lbl">Total hours</span></div>
        <div className="stat-box"><span className="stat-val">{stats.weekH.toFixed(1)}h</span><span className="stat-lbl">This week</span></div>
      </div>
    </div>
  )
}

function LiveEventsWidget() {
  const [events, setEvents] = useState([])
  useEffect(() => {
    supabase.from('events')
      .select('*')
      .lte('starts_at', new Date().toISOString())
      .gte('ends_at', new Date().toISOString())
      .then(({ data }) => setEvents(data || []))
  }, [])
  if (!events.length) return null
  return (
    <div className="card">
      <div className="widget-title">Live now</div>
      {events.map(e => (
        <div key={e.id} className="mini-event">
          <span className="live-dot" />
          <span className="mini-event-name">{e.name}</span>
        </div>
      ))}
    </div>
  )
}

function SuggestionsWidget({ profile, onOpenProfile }) {
  const [suggestions, setSuggestions] = useState([])
  const [following, setFollowing] = useState(new Set())
  useEffect(() => {
    ;(async () => {
      const { data: alreadyFollowing } = await supabase.from('follows').select('following_id').eq('follower_id', profile.id)
      const followedIds = (alreadyFollowing || []).map(f => f.following_id)
      const exclude = [profile.id, ...followedIds]
      const { data } = await supabase.from('profiles').select('id, full_name, handle, avatar_url, avatar_color, target_college')
        .not('id', 'in', `(${exclude.join(',')})`)
        .limit(4)
      setSuggestions(data || [])
      setFollowing(new Set(followedIds))
    })()
  }, [])

  async function follow(userId) {
    await supabase.from('follows').insert({ follower_id: profile.id, following_id: userId })
    setFollowing(prev => new Set([...prev, userId]))
  }

  if (!suggestions.length) return null
  return (
    <div className="card">
      <div className="widget-title">People to follow</div>
      {suggestions.map(u => (
        <div key={u.id} className="suggest-row">
          <button onClick={() => onOpenProfile(u.id)}><Avatar profile={u} size={30} /></button>
          <div className="suggest-info">
            <button className="suggest-name" onClick={() => onOpenProfile(u.id)}>{u.full_name}</button>
            <span className="suggest-meta">{u.target_college || '@' + u.handle}</span>
          </div>
          <button className="follow-btn-sm" onClick={() => follow(u.id)}>
            {following.has(u.id) ? '✓' : 'Follow'}
          </button>
        </div>
      ))}
    </div>
  )
}

function MyEventsWidget({ profile }) {
  const [history, setHistory] = useState([])
  useEffect(() => {
    supabase.from('event_registrations')
      .select('events:event_id(name, starts_at)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory(data || []))
  }, [])
  return (
    <div className="card">
      <div className="widget-title">Your registrations</div>
      {history.length === 0
        ? <p className="empty-sm">No registrations yet</p>
        : history.map((r, i) => (
            <div key={i} className="mini-event">
              <span className="mini-event-name">{r.events?.name}</span>
            </div>
          ))
      }
    </div>
  )
}

function BadgesWidget({ profile }) {
  return (
    <div className="card">
      <div className="widget-title">Badges</div>
      <div className="badges-row">
        {[['🔥','Streak'], ['⚡','Physics'], ['🏅','Top 10'], ['🧪','Chem'], ['📐','Math']].map(([icon, label]) => (
          <div key={label} className="badge-item"><div className="badge-icon">{icon}</div><div className="badge-label">{label}</div></div>
        ))}
      </div>
    </div>
  )
}

function AllSubjectProgressWidget({ progress }) {
  return (
    <div className="card">
      <div className="widget-title">Overall progress</div>
      {SUBJECTS.map(sub => {
        const chs = CHAPTER_DATA[sub]
        const done = chs.filter(c => progress[`${sub}__${c}`] === 'done').length
        const pct = Math.round((done / chs.length) * 100)
        return (
          <div key={sub} className="progress-subject-row">
            <div className="progress-subject-header">
              <span>{sub}</span><span className="progress-pct">{done}/{chs.length}</span>
            </div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          </div>
        )
      })}
    </div>
  )
}

function SubjectBreakdownWidget({ sessions }) {
  const breakdown = SUBJECTS.map(sub => ({
    subject: sub,
    secs: sessions.filter(s => s.subject === sub).reduce((t, s) => t + s.duration_seconds, 0),
  }))
  const total = breakdown.reduce((t, b) => t + b.secs, 0)
  return (
    <div className="card">
      <div className="widget-title">Subject breakdown</div>
      {breakdown.map(b => (
        <div key={b.subject} className="progress-subject-row">
          <div className="progress-subject-header">
            <span>{b.subject}</span>
            <span className="progress-pct">{(b.secs / 3600).toFixed(0)}h</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${total > 0 ? Math.round((b.secs / total) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function SubjectRankWidget({ profile }) {
  const [ranks, setRanks] = useState({})
  useEffect(() => {
    ;(async () => {
      // Single query, then aggregate client-side — 3x fewer round trips
      const { data } = await supabase
        .from('study_sessions')
        .select('user_id, duration_seconds, subject')
        .in('subject', SUBJECTS)
      const result = {}
      SUBJECTS.forEach(sub => {
        const map = {}
        ;(data || []).filter(s => s.subject === sub).forEach(s => {
          map[s.user_id] = (map[s.user_id] || 0) + s.duration_seconds
        })
        const sorted = Object.entries(map).sort((a, b) => b[1] - a[1])
        const rank = sorted.findIndex(([uid]) => uid === profile.id) + 1
        result[sub] = rank || '—'
      })
      setRanks(result)
    })()
  }, [])
  return (
    <div className="card">
      <div className="widget-title">Subject ranks</div>
      {SUBJECTS.map(sub => (
        <div key={sub} className="subject-rank-row">
          <span>{sub}</span>
          <span className="subject-rank-val">#{ranks[sub] || '—'}</span>
        </div>
      ))}
    </div>
  )
}

function TrendingChaptersWidget() {
  const [chapters, setChapters] = useState([])
  useEffect(() => {
    supabase.from('study_sessions')
      .select('subject')
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .then(({ data }) => {
        const counts = {}
        ;(data || []).forEach(s => { counts[s.subject] = (counts[s.subject] || 0) + 1 })
        setChapters(Object.entries(counts).sort((a, b) => b[1] - a[1]))
      })
  }, [])
  return (
    <div className="card">
      <div className="widget-title">Trending subjects (7d)</div>
      {chapters.map(([sub, count]) => (
        <div key={sub} className="subject-rank-row">
          <span>{sub}</span>
          <span className="subject-rank-val">{count} sessions</span>
        </div>
      ))}
    </div>
  )
}

function ProfileStatsTab({ sessions }) {
  const weeklyData = {}
  sessions.forEach(s => {
    const week = getWeekLabel(s.created_at)
    weeklyData[week] = (weeklyData[week] || 0) + s.duration_seconds / 3600
  })
  const totalH = sessions.reduce((t, s) => t + s.duration_seconds, 0) / 3600
  const avgH = sessions.length ? totalH / sessions.length : 0
  const totalProbs = sessions.reduce((t, s) => t + (s.problems_solved || 0), 0)
  return (
    <div className="card">
      <div className="widget-title" style={{ marginBottom: '1rem' }}>All-time stats</div>
      <div className="stats-2x2" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="stat-box"><span className="stat-val">{totalH.toFixed(0)}h</span><span className="stat-lbl">Total hours</span></div>
        <div className="stat-box"><span className="stat-val">{sessions.length}</span><span className="stat-lbl">Sessions</span></div>
        <div className="stat-box"><span className="stat-val">{avgH.toFixed(1)}h</span><span className="stat-lbl">Avg per session</span></div>
        <div className="stat-box"><span className="stat-val">{totalProbs}</span><span className="stat-lbl">Problems solved</span></div>
      </div>
    </div>
  )
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────

function Avatar({ profile, size = 36, border = false }) {
  const initials = (profile?.full_name || profile?.handle || '?')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const bg = profile?.avatar_color || avatarBg(profile)
  const style = {
    width: size, height: size, borderRadius: '50%',
    background: bg, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: Math.round(size * 0.38), fontWeight: 500, flexShrink: 0,
    overflow: 'hidden',
    ...(border ? { border: '3px solid #fff' } : {}),
  }
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt={initials} style={{ ...style, objectFit: 'cover' }} />
  }
  return <div style={style}>{initials}</div>
}

function Spinner() {
  return <div className="spinner"><div className="spinner-inner" /></div>
}

function EmptyState({ icon, title, desc }) {
  return (
    <div className="empty-state">
      <i className={`ti ti-${icon}`} aria-hidden="true" />
      <div className="empty-title">{title}</div>
      <div className="empty-desc">{desc}</div>
    </div>
  )
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatTime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function formatHours(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatEventDate(iso) {
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function durationLabel(start, end) {
  const mins = Math.round((new Date(end) - new Date(start)) / 60000)
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}` : `${m}m`
}

function getWeekLabel(iso) {
  const d = new Date(iso)
  const week = Math.floor(d.getDate() / 7)
  return `${d.toLocaleString('default', { month: 'short' })} W${week + 1}`
}

const AVATAR_COLORS = ['#185FA5', '#0F6E56', '#993C1D', '#534AB7', '#BA7517', '#3B6D11']
function avatarBg(profile) {
  if (!profile) return AVATAR_COLORS[0]
  const str = profile.handle || profile.full_name || profile.id || ''
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
