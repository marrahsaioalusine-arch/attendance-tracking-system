/* Rollcall — Class Attendance Management System
 * Vanilla JS single-page app. Data lives in a real relational database (SQLite compiled to WebAssembly via sql.js)
 * running in the browser and saved to localStorage, so it works on GitHub Pages with no server or cloud service.
 */
(async function () {
  'use strict';

  // =====================================================================
  // Storage (safe wrappers — some embedded previews block storage)
  // =====================================================================
  const STORE_KEY = 'rollcall_db_v1';
  const SESSION_KEY = 'rollcall_session_v1';
  const mem = {};
  const store = {
    get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return mem[k] ?? null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { mem[k] = v; } },
    del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch { delete mem[k]; } },
  };
  const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (b) => { const s = atob(b); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; };

  // =====================================================================
  // Database
  // =====================================================================
  let SQL, db;
  async function initDb() {
    SQL = await initSqlJs({ locateFile: (f) => 'vendor/' + f });
    const saved = store.get(STORE_KEY);
    if (saved) {
      try { db = new SQL.Database(fromB64(saved)); db.exec('SELECT 1 FROM users LIMIT 1'); }
      catch (e) { console.warn('Saved DB unreadable, rebuilding', e); db = null; }
    }
    if (!db) freshDb();
    db.exec('PRAGMA foreign_keys = ON');
  }
  function freshDb() {
    if (db) db.close();
    db = new SQL.Database();
    db.exec(CAMS_SCHEMA);
    db.exec('BEGIN');
    CAMS_SEED(db);
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');
    persist();
  }
  function persist() {
    try { store.set(STORE_KEY, toB64(db.export())); } catch (e) { console.warn('persist failed', e); }
    db.exec('PRAGMA foreign_keys = ON');
  }
  function q(sql, params = []) {
    const st = db.prepare(sql);
    try { st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
    finally { st.free(); }
  }
  const one = (sql, p) => q(sql, p)[0];
  const val = (sql, p) => { const r = one(sql, p); return r ? Object.values(r)[0] : null; };
  const run = (sql, p = []) => db.run(sql, p);
  const lastId = () => val('SELECT last_insert_rowid() AS id');
  function tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); persist(); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch { } throw e; }
  }
  function friendly(err) {
    const m = String(err && err.message || err);
    const map = [
      [/enrollments\.student_id, enrollments\.section_id/, 'This student is already enrolled in this class section.'],
      [/attendance_records\.session_id, attendance_records\.student_id/, 'Attendance for this student and session already exists.'],
      [/users\.username/, 'That username is already taken.'],
      [/students\.student_no/, 'That student number already exists.'],
      [/instructors\.staff_no/, 'That staff number already exists.'],
      [/\.email/, 'That email address is already in use.'],
      [/courses\.course_code/, 'That course code already exists.'],
      [/class_sections\.course_id, class_sections\.term_id, class_sections\.section_code/, 'That section code already exists for this course and term.'],
      [/class_sessions\.section_id, class_sessions\.session_date, class_sessions\.start_time/, 'A session already exists for this section at that date and time.'],
      [/classrooms\.building, classrooms\.room_number/, 'That room already exists in this building.'],
      [/academic_terms\.term_name/, 'A term with that name already exists.'],
      [/FOREIGN KEY constraint failed/, 'This record is still referenced by other records, so it cannot be removed.'],
      [/CHECK constraint failed: (\w+)/, 'A value is outside the allowed range.'],
      [/NOT NULL constraint failed: \w+\.(\w+)/, 'A required field is missing.'],
    ];
    for (const [re, msg] of map) if (re.test(m)) return msg;
    return m.replace(/^Error:\s*/, '');
  }

  // =====================================================================
  // Utilities
  // =====================================================================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const localYmd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const TODAY = localYmd();
  const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const STATUSES = ['Present', 'Late', 'Absent', 'Excused'];
  const COLORS = { Present: 'var(--present)', Late: 'var(--late)', Absent: 'var(--absent)', Excused: 'var(--excused)' };
  const fmtDate = (s, opt) => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return d.toLocaleDateString('en-GB', opt || { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
  const fmtDT = (s) => s ? `${fmtDate(s, { day: 'numeric', month: 'short', year: 'numeric' })} ${String(s).slice(11, 16)}` : '—';
  const initials = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const num = (v) => (v == null ? 0 : Number(v));
  const threshold = () => Number(val(`SELECT setting_value FROM system_settings WHERE setting_key='attendance_threshold'`) || 75);
  const setting = (k) => val(`SELECT setting_value FROM system_settings WHERE setting_key=?`, [k]);
  const currentTerm = () => one(`SELECT * FROM academic_terms WHERE is_current = 1 ORDER BY start_date DESC LIMIT 1`) || one(`SELECT * FROM academic_terms ORDER BY start_date DESC LIMIT 1`);

  function pctCell(v) {
    if (v == null) return '<span class="faint">—</span>';
    const t = threshold(); v = Number(v);
    const cls = v < t ? 'bad' : v < t + 10 ? 'warn' : '';
    return `<div class="pct ${cls}"><span class="v tnum">${v.toFixed(1)}%</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span></div>`;
  }
  const badge = (status) => status ? `<span class="badge ${esc(status)}"><span class="dot"></span>${esc(status)}</span>` : '<span class="badge off">Not recorded</span>';
  const roleBadge = (r) => `<span class="badge role-${esc(r)}">${esc(r)}</span>`;

  function table(cols, rows, opts = {}) {
    if (!rows.length) return `<div class="empty">${esc(opts.empty || 'No records found.')}</div>`;
    const head = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
    const body = rows.map((r) => {
      const href = opts.href ? opts.href(r) : null;
      return `<tr ${href ? `class="clickable" data-href="${esc(href)}"` : ''}>${cols.map((c) => {
        const v = r[c.k];
        const html = c.fmt ? c.fmt(v, r) : esc(v ?? '—');
        return `<td class="${c.num ? 'num' : ''}">${html}</td>`;
      }).join('')}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function sqlBlock(sql) {
    const kw = /\b(SELECT|FROM|WHERE|JOIN|LEFT|ON|GROUP BY|ORDER BY|AND|OR|AS|CASE|WHEN|THEN|ELSE|END|SUM|COUNT|ROUND|NULLIF|DESC|ASC|LIMIT|IN|IS|NOT|NULL|DISTINCT|HAVING|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|VIEW|TABLE|TRIGGER|INDEX|BEGIN|COMMIT|ROLLBACK|BETWEEN|LIKE|ON CONFLICT|DO)\b/g;
    return `<details class="sql"><summary>Show SQL</summary><pre class="sql-box">${esc(sql.trim()).replace(kw, '<span class="kw">$1</span>')}</pre></details>`;
  }

  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`; el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function download(name, content, type = 'text/csv') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function toCsv(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  }

  // ---------- Icons ----------
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    users: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .7 3.2 2.4 3.6 5.2"/>'),
    student: I('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>'),
    teacher: I('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    book: I('<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/>'),
    layers: I('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
    cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    link: I('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
    check: I('<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 12.5l3 3 5-6"/>'),
    chart: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    code: I('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
    db: I('<ellipse cx="12" cy="5.5" rx="8" ry="2.5"/><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13"/><path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"/>'),
    gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    out: I('<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3"/>'),
    menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    dl: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    key: I('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>'),
    history: I('<path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  };
  const LOGO = `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="Rollcall logo" role="img"><rect x="3" y="3" width="26" height="26" rx="7" stroke="currentColor" stroke-width="2"/><path d="M9 16.5l4.5 4.5L23 11.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // =====================================================================
  // Auth
  // =====================================================================
  let ME = null;
  function loadMe(userId) {
    const u = one(`SELECT user_id, username, role, is_active, last_login_at FROM users WHERE user_id = ?`, [userId]);
    if (!u || !u.is_active) return null;
    if (u.role === 'Instructor') {
      const i = one(`SELECT instructor_id, first_name || ' ' || last_name AS name FROM instructors WHERE user_id = ?`, [u.user_id]);
      Object.assign(u, { instructor_id: i ? i.instructor_id : -1, name: i ? i.name : u.username });
    } else if (u.role === 'Student') {
      const s = one(`SELECT student_id, first_name || ' ' || last_name AS name FROM students WHERE user_id = ?`, [u.user_id]);
      Object.assign(u, { student_id: s ? s.student_id : -1, name: s ? s.name : u.username });
    } else u.name = 'System Administrator';
    return u;
  }
  function login(username, password) {
    const u = one(`SELECT user_id, password_hash, is_active FROM users WHERE username = ?`, [String(username).trim().toLowerCase()]);
    if (!u || !CAMS_CRYPTO.verifyHash(password, u.password_hash)) throw new Error('Incorrect username or password.');
    if (!u.is_active) throw new Error('This account has been deactivated. Contact the administrator.');
    tx(() => run(`UPDATE users SET last_login_at = datetime('now','localtime') WHERE user_id = ?`, [u.user_id]));
    ME = loadMe(u.user_id);
    store.set(SESSION_KEY, String(u.user_id), true);
  }
  function logout() { ME = null; store.del(SESSION_KEY, true); location.hash = '#/login'; render(); }
  const isAdmin = () => ME && ME.role === 'Administrator';
  const isInstructor = () => ME && ME.role === 'Instructor';
  const isStudent = () => ME && ME.role === 'Student';
  // SQL scope fragment restricting class sections to the signed-in instructor
  const secScope = (alias = 'sec') => (isInstructor() ? ` AND ${alias}.instructor_id = ${Number(ME.instructor_id)}` : '');
  function canManageSection(sectionId) {
    if (isAdmin()) return true;
    if (isInstructor()) return !!one(`SELECT 1 FROM class_sections WHERE section_id = ? AND instructor_id = ?`, [sectionId, ME.instructor_id]);
    return false;
  }
  function canViewStudent(studentId) {
    if (isAdmin()) return true;
    if (isStudent()) return Number(studentId) === Number(ME.student_id);
    if (isInstructor()) return !!one(`SELECT 1 FROM enrollments e JOIN class_sections sec ON sec.section_id = e.section_id WHERE e.student_id = ? AND sec.instructor_id = ?`, [studentId, ME.instructor_id]);
    return false;
  }

  // =====================================================================
  // Modal
  // =====================================================================
  function openModal({ title, sub, body, submitLabel = 'Save', wide = false, onSubmit, onMount, danger = false, noFoot = false }) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-close-backdrop>
      <form class="modal ${wide ? 'wide' : ''}" id="mform" novalidate>
        <div class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
          <button type="button" class="btn ghost sm" data-close aria-label="Close">✕</button></div>
        <div class="card-body">${body}<p class="error-text" id="merr"></p></div>
        ${noFoot ? '' : `<div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button></div>`}
      </form></div>`;
    const form = $('#mform');
    const close = () => { root.innerHTML = ''; };
    $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
    $('[data-close-backdrop]', root).addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try { const r = onSubmit ? onSubmit(data, form) : true; if (r !== false) { close(); render(); } }
      catch (err) { $('#merr').textContent = friendly(err); }
    });
    if (onMount) onMount(form);
    const first = form.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function confirmModal(title, message, onYes, label = 'Delete') {
    openModal({ title, body: `<p class="muted">${message}</p>`, submitLabel: label, danger: true, onSubmit: () => { onYes(); } });
  }
  const opt = (value, label, selected) => `<option value="${esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
  const field = (label, html, full) => `<div class="field ${full ? 'full' : ''}"><label>${esc(label)}</label>${html}</div>`;
  const inp = (name, value = '', attrs = '') => `<input class="input" name="${name}" value="${esc(value)}" ${attrs}>`;
  const req = (d, keys) => { for (const k of keys) if (!String(d[k] ?? '').trim()) throw new Error('Please fill in all required fields.'); };

  // =====================================================================
  // Router & shell
  // =====================================================================
  const state = { studentSearch: '', studentProgram: '', userRole: '', termFilter: '', enrollSection: '', attSection: '', attWhen: 'recent', reportTab: 'history', rep: {} };
  const NAV = {
    Administrator: [
      ['Overview', [['dashboard', 'Dashboard', ICON.home]]],
      ['Manage', [['users', 'Users & access', ICON.users], ['students', 'Students', ICON.student], ['instructors', 'Instructors', ICON.teacher], ['courses', 'Courses', ICON.book], ['sections', 'Class sections', ICON.layers], ['terms', 'Terms & rooms', ICON.cal], ['enrollments', 'Enrollment', ICON.link]]],
      ['Attendance', [['attendance', 'Sessions & attendance', ICON.check], ['reports', 'Reports', ICON.chart]]],
      ['Database', [['schema', 'Schema', ICON.db], ['sql', 'SQL console', ICON.code], ['settings', 'Settings', ICON.gear]]],
    ],
    Instructor: [
      ['Overview', [['dashboard', 'Dashboard', ICON.home]]],
      ['Teaching', [['sections', 'My sections', ICON.layers], ['enrollments', 'Class rosters', ICON.link], ['attendance', 'Take attendance', ICON.check], ['reports', 'Reports', ICON.chart]]],
    ],
    Student: [
      ['Overview', [['dashboard', 'My attendance', ICON.home], ['history', 'Attendance history', ICON.history]]],
    ],
  };
  const ROUTES = {
    Administrator: ['dashboard', 'users', 'students', 'student', 'instructors', 'courses', 'sections', 'terms', 'enrollments', 'attendance', 'session', 'reports', 'schema', 'sql', 'settings'],
    Instructor: ['dashboard', 'sections', 'enrollments', 'attendance', 'session', 'reports', 'student'],
    Student: ['dashboard', 'history'],
  };
  const TITLES = { dashboard: 'Dashboard', users: 'Users & access', students: 'Students', student: 'Student profile', instructors: 'Instructors', courses: 'Courses', sections: 'Class sections', terms: 'Terms & rooms', enrollments: 'Enrollment', attendance: 'Sessions & attendance', session: 'Attendance session', reports: 'Reports', schema: 'Database schema', sql: 'SQL console', settings: 'Settings', history: 'Attendance history' };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [route, id] = h.split('/');
    return { route: route || 'dashboard', id };
  }
  const go = (path) => { location.hash = '#/' + path; };

  function render() {
    const app = $('#app');
    if (!ME) { app.innerHTML = loginView(); bindLogin(); return; }
    let { route, id } = parseHash();
    if (route === 'login' || !ROUTES[ME.role].includes(route)) { route = 'dashboard'; history.replaceState(null, '', '#/dashboard'); }
    if (ME.role === 'Instructor' && route === 'sections') TITLES.sections = 'My sections';
    let html;
    try { html = PAGES[route](id); }
    catch (e) { console.error(e); html = `<div class="card"><div class="empty">Something went wrong: ${esc(friendly(e))}</div></div>`; }
    const navLabel = route === 'student' ? (isAdmin() ? 'students' : 'reports') : route === 'session' ? 'attendance' : route;
    const term = currentTerm();
    app.innerHTML = `<div class="shell" id="shell">
      <aside class="sidebar" aria-label="Main navigation">
        <a class="brand" href="#/dashboard">${LOGO}<span><span class="word">Rollcall</span><span class="sub">Attendance Management</span></span></a>
        <nav class="nav">${NAV[ME.role].map(([g, items]) => `<div class="group">${esc(g)}</div>` + items.map(([r, label, icon]) => `<a href="#/${r}" class="${navLabel === r ? 'active' : ''}">${icon}<span>${esc(label)}</span></a>`).join('')).join('')}</nav>
        <div class="me"><div class="who"><span class="avatar">${esc(initials(ME.name))}</span><div><div class="name">${esc(ME.name)}</div><div class="role">${esc(ME.role)} · ${esc(ME.username)}</div></div></div>
          <div class="actions"><button class="btn sm" data-action="change-password">${ICON.key}Password</button><button class="btn sm ghost" data-action="logout">${ICON.out}Sign out</button></div></div>
      </aside>
      <div class="main">
        <header class="topbar"><div class="crumbs"><button class="btn ghost sm menu-btn" data-action="menu" aria-label="Open menu">${ICON.menu}</button><h1>${esc(TITLES[route])}</h1></div>
          <div class="crumbs"><span class="term">${esc(term ? term.term_name : 'No term')} · ${esc(fmtDate(TODAY, { weekday: 'short', day: 'numeric', month: 'short' }))}</span></div></header>
        <main class="content" id="content">${html}</main>
      </div></div>`;
    if (AFTER[route]) AFTER[route](id);
    window.scrollTo(0, 0);
  }

  // Global click delegation
  document.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('button, a, input, select')) { go(row.dataset.href); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) { e.preventDefault(); try { fn(el, e); } catch (err) { toast(friendly(err), 'err'); } }
  });
  window.addEventListener('hashchange', render);

  // =====================================================================
  // Login
  // =====================================================================
  function loginView() {
    const inst = setting('institution_name') || 'Riverside University';
    return `<div class="login">
      <section class="login-hero"><div class="grid-bg"></div>
        <a class="brand" href="#/login">${LOGO}<span><span class="word">Rollcall</span><span class="sub">${esc(inst)}</span></span></a>
        <div>
          <h1>Every class, every student, accounted for.</h1>
          <p class="lede">A database-driven system for recording, managing, monitoring and reporting student attendance — with role-based access for administrators, instructors and students.</p>
          <div class="hero-roll" aria-hidden="true">
            <div class="row"><span class="avatar">AS</span><span class="name">Aminata Sesay</span>${badge('Present')}</div>
            <div class="row"><span class="avatar">HL</span><span class="name">Hoi Yan Lau</span>${badge('Late')}</div>
            <div class="row"><span class="avatar">KM</span><span class="name">Kwame Mensah</span>${badge('Excused')}</div>
          </div>
        </div>
        <div class="hero-flow">${['Users', 'Authentication', 'Courses', 'Enrollment', 'Sessions', 'Attendance', 'Reports'].map((s) => `<span class="step">${s}</span>`).join('<span>→</span>')}</div>
      </section>
      <section class="login-panel">
        <form class="login-card" id="login-form" novalidate>
          <h2>Sign in</h2><p class="muted" style="margin-bottom:22px">Use your account or pick a demo role below.</p>
          <div class="grid" style="gap:14px">
            ${field('Username', '<input class="input" name="username" autocomplete="username" required>')}
            ${field('Password', '<input class="input" type="password" name="password" autocomplete="current-password" required>')}
            <p class="error-text" id="login-err"></p>
            <button class="btn primary block" type="submit">Sign in</button>
          </div>
          <div class="demo-accounts"><div class="label">Demo accounts (sample data)</div><div class="demo-grid">
            ${[['Administrator', 'admin', 'admin123'], ['Instructor — Grace Chan', 'gchan', 'teach123'], ['Student — Aminata Sesay', 's2026001', 'student123']].map(([who, u, p]) =>
      `<button type="button" class="demo-btn" data-demo="${u}:${p}"><span class="who">${esc(who)}</span><span class="cred">${u} / ${p}</span></button>`).join('')}
          </div></div>
        </form>
      </section></div>`;
  }
  function bindLogin() {
    const f = $('#login-form');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      try { login(d.username, d.password); location.hash = '#/dashboard'; render(); }
      catch (err) { $('#login-err').textContent = err.message; }
    });
    $$('[data-demo]').forEach((b) => b.addEventListener('click', () => {
      const [u, p] = b.dataset.demo.split(':');
      f.username.value = u; f.password.value = p; f.requestSubmit();
    }));
  }

  // =====================================================================
  // Shared queries / components
  // =====================================================================
  const SECTION_LABEL = `c.course_code || '-' || sec.section_code`;
  function sectionOptions(where = '', selected) {
    const rows = q(`SELECT sec.section_id, ${SECTION_LABEL} AS label, c.course_title, t.term_name, t.is_current
      FROM class_sections sec JOIN courses c ON c.course_id = sec.course_id JOIN academic_terms t ON t.term_id = sec.term_id
      WHERE 1=1 ${secScope()} ${where} ORDER BY t.is_current DESC, t.start_date DESC, c.course_code, sec.section_code`);
    return { rows, html: rows.map((r) => opt(r.section_id, `${r.label} · ${r.course_title} (${r.term_name})`, selected)).join('') };
  }
  const scheduleText = (sectionId) => q(`SELECT day_of_week, start_time, end_time FROM section_schedules WHERE section_id = ? ORDER BY day_of_week`, [sectionId])
    .map((s) => `${DAYS[s.day_of_week]} ${s.start_time}–${s.end_time}`).join(', ') || '—';

  function statusTotals(where, params = []) {
    return one(`SELECT COUNT(*) AS total, SUM(ar.status='Present') AS Present, SUM(ar.status='Late') AS Late, SUM(ar.status='Absent') AS Absent, SUM(ar.status='Excused') AS Excused,
      ROUND(100.0 * SUM(ar.status IN ('Present','Late')) / NULLIF(COUNT(*) - SUM(ar.status='Excused'), 0), 1) AS pct
      FROM attendance_records ar JOIN class_sessions cs ON cs.session_id = ar.session_id JOIN class_sections sec ON sec.section_id = cs.section_id
      WHERE 1=1 ${where}`, params) || {};
  }
  function stackBar(t) {
    const total = num(t.total) || 1;
    return `<div class="stack">${STATUSES.map((s) => `<i style="width:${(num(t[s]) / total) * 100}%;background:${COLORS[s]}" title="${s}: ${num(t[s])}"></i>`).join('')}</div>
      <div class="legend">${STATUSES.map((s) => `<span><b style="background:${COLORS[s]}"></b>${s} <strong class="tnum">${num(t[s])}</strong> <span class="faint">(${((num(t[s]) / total) * 100).toFixed(1)}%)</span></span>`).join('')}</div>`;
  }
  function trendChart(rows) {
    if (!rows.length) return '<div class="empty">No attendance recorded yet.</div>';
    const max = Math.max(...rows.map((r) => num(r.records)), 1);
    return `<div class="cols">${rows.map((r) => {
      const segs = ['Excused', 'Absent', 'Late', 'Present'].map((s) => `<div class="seg" style="height:${(num(r[s]) / max) * 100}%;background:${COLORS[s]}"></div>`).join('');
      const pct = r.records ? ((num(r.Present) + num(r.Late)) / Math.max(1, num(r.records) - num(r.Excused)) * 100).toFixed(0) : 0;
      return `<div class="col"><div class="tip">${esc(fmtDate(r.session_date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${pct}% attended<br>${STATUSES.map((s) => `${s[0]}:${num(r[s])}`).join(' ')}</div>
        <div style="display:flex;flex-direction:column;justify-content:flex-end;height:100%">${segs}</div>
        <div class="x">${esc(fmtDate(r.session_date, { day: 'numeric', month: 'short' }))}</div></div>`;
    }).join('')}</div>`;
  }
  function sessionItem(s) {
    const d = new Date(s.session_date + 'T00:00:00');
    const complete = num(s.recorded) >= num(s.enrolled) && num(s.enrolled) > 0;
    const status = num(s.recorded) === 0 ? (s.session_date > TODAY ? '<span class="badge off">Upcoming</span>' : '<span class="badge Late">Pending</span>')
      : complete ? `<span class="badge Present">Recorded ${s.recorded}/${s.enrolled}</span>` : `<span class="badge Late">Partial ${s.recorded}/${s.enrolled}</span>`;
    return `<div class="session-item" data-action="open-session" data-id="${s.session_id}" role="link" tabindex="0">
      <div class="date-chip ${s.session_date === TODAY ? 'today' : ''}"><div class="m">${d.toLocaleDateString('en-GB', { month: 'short' })}</div><div class="d">${d.getDate()}</div><div class="m">${d.toLocaleDateString('en-GB', { weekday: 'short' })}</div></div>
      <div><div style="font-weight:600">${esc(s.course_code)}-${esc(s.section_code)} <span class="muted" style="font-weight:400">· ${esc(s.topic || 'Class session')}</span></div>
        <div class="muted" style="font-size:var(--text-xs)">${esc(s.start_time)}–${esc(s.end_time)}${num(s.recorded) ? ` · P ${num(s.present_count)} · L ${num(s.late_count)} · A ${num(s.absent_count)} · E ${num(s.excused_count)}` : ''}</div></div>
      <div>${status}</div></div>`;
  }

  // =====================================================================
  // Pages
  // =====================================================================
  const PAGES = {}, AFTER = {}, ACTIONS = {};

  ACTIONS.logout = logout;
  ACTIONS.menu = () => $('#shell').classList.toggle('nav-open');
  ACTIONS['open-session'] = (el) => go('session/' + el.dataset.id);
  ACTIONS['change-password'] = () => openModal({
    title: 'Change password', body: `<div class="grid" style="gap:14px">${field('Current password', '<input class="input" type="password" name="cur" required>')}${field('New password (min. 6 characters)', '<input class="input" type="password" name="n1" required>')}${field('Confirm new password', '<input class="input" type="password" name="n2" required>')}</div>`,
    onSubmit: (d) => {
      const u = one(`SELECT password_hash FROM users WHERE user_id = ?`, [ME.user_id]);
      if (!CAMS_CRYPTO.verifyHash(d.cur, u.password_hash)) throw new Error('Current password is incorrect.');
      if (String(d.n1).length < 6) throw new Error('New password must be at least 6 characters.');
      if (d.n1 !== d.n2) throw new Error('New passwords do not match.');
      tx(() => run(`UPDATE users SET password_hash = ? WHERE user_id = ?`, [CAMS_CRYPTO.makeHash(d.n1), ME.user_id]));
      toast('Password updated.');
    },
  });

  // ---------------------------------------------------------------- Dashboard
  PAGES.dashboard = () => {
    if (isStudent()) return studentOverview(ME.student_id, true);
    const term = currentTerm();
    const tid = term ? term.term_id : -1;
    const scope = secScope();
    const t = statusTotals(`AND sec.term_id = ${tid} ${scope}`);
    const low = q(`SELECT v.* FROM v_low_attendance v JOIN class_sections sec ON sec.section_id = v.section_id WHERE sec.term_id = ${tid} ${scope} ORDER BY v.attendance_pct ASC LIMIT 8`);
    const trend = q(`SELECT cs.session_date, COUNT(ar.attendance_id) AS records, SUM(ar.status='Present') AS Present, SUM(ar.status='Late') AS Late, SUM(ar.status='Absent') AS Absent, SUM(ar.status='Excused') AS Excused
      FROM class_sessions cs JOIN class_sections sec ON sec.section_id = cs.section_id JOIN attendance_records ar ON ar.session_id = cs.session_id
      WHERE sec.term_id = ${tid} ${scope} GROUP BY cs.session_date ORDER BY cs.session_date DESC LIMIT 16`).reverse();
    const today = q(`SELECT v.* FROM v_session_summary v JOIN class_sections sec ON sec.section_id = v.section_id WHERE v.session_date = ? ${scope} ORDER BY v.start_time`, [TODAY]);
    const pending = val(`SELECT COUNT(*) FROM v_session_summary v JOIN class_sections sec ON sec.section_id = v.section_id WHERE v.session_date <= ? AND v.recorded = 0 AND sec.term_id = ${tid} ${scope}`, [TODAY]);
    const sections = q(`SELECT sec.section_id, ${SECTION_LABEL} AS label, c.course_title, (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.section_id AND e.status='Active') AS enrolled, sec.max_capacity,
        (SELECT ROUND(100.0*SUM(ar.status IN ('Present','Late'))/NULLIF(COUNT(*)-SUM(ar.status='Excused'),0),1) FROM attendance_records ar JOIN class_sessions cs ON cs.session_id=ar.session_id WHERE cs.section_id=sec.section_id) AS pct,
        (SELECT COUNT(*) FROM class_sessions cs WHERE cs.section_id = sec.section_id AND cs.session_date <= '${TODAY}') AS held
      FROM class_sections sec JOIN courses c ON c.course_id = sec.course_id WHERE sec.term_id = ${tid} ${scope} ORDER BY c.course_code, sec.section_code`);

    let kpis;
    if (isAdmin()) {
      kpis = [
        ['Students', val(`SELECT COUNT(*) FROM students`), `${val(`SELECT COUNT(DISTINCT e.student_id) FROM enrollments e JOIN class_sections sec ON sec.section_id=e.section_id WHERE sec.term_id=${tid} AND e.status='Active'`)} enrolled this term`],
        ['Instructors', val(`SELECT COUNT(*) FROM instructors`), `${val(`SELECT COUNT(DISTINCT instructor_id) FROM class_sections WHERE term_id=${tid}`)} teaching this term`],
        ['Class sections', sections.length, `${val(`SELECT COUNT(*) FROM courses`)} courses in catalogue`],
        ['Term attendance', t.pct != null ? t.pct + '%' : '—', `${num(t.total)} records · threshold ${threshold()}%`],
        ['Below threshold', low.length === 8 ? val(`SELECT COUNT(*) FROM v_low_attendance v JOIN class_sections sec ON sec.section_id=v.section_id WHERE sec.term_id=${tid}`) : low.length, 'student–section pairs'],
        ['Pending sessions', pending, 'held but not yet recorded'],
      ];
    } else {
      kpis = [
        ['My sections', sections.length, term ? term.term_name : ''],
        ['Students taught', val(`SELECT COUNT(DISTINCT e.student_id) FROM enrollments e JOIN class_sections sec ON sec.section_id=e.section_id WHERE sec.term_id=${tid} AND e.status='Active' ${scope}`), 'active enrollments'],
        ['Attendance rate', t.pct != null ? t.pct + '%' : '—', `${num(t.total)} records`],
        ['Below threshold', val(`SELECT COUNT(*) FROM v_low_attendance v JOIN class_sections sec ON sec.section_id=v.section_id WHERE sec.term_id=${tid} ${scope}`), `under ${threshold()}%`],
        ['Pending sessions', pending, 'need attendance'],
      ];
    }
    return `
      <div class="page-head"><div><h1>${isAdmin() ? 'Institution overview' : 'Welcome back, ' + esc(ME.name.split(' ')[0])}</h1><p>${esc(term ? `${term.term_name} · ${fmtDate(term.start_date)} – ${fmtDate(term.end_date)}` : '')}</p></div>
        <div class="actions"><a class="btn" href="#/reports">${ICON.chart}Reports</a><a class="btn primary" href="#/attendance">${ICON.check}${isAdmin() ? 'Sessions' : 'Take attendance'}</a></div></div>
      <div class="grid kpis">${kpis.map(([l, v, d]) => `<div class="card kpi"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div><div class="delta">${esc(d)}</div></div>`).join('')}</div>
      <div class="grid two">
        <div class="card"><div class="card-head"><div><h2>Attendance trend</h2><p>Last ${trend.length} class days · stacked by status</p></div></div><div class="card-body">${trendChart(trend)}</div></div>
        <div class="card"><div class="card-head"><div><h2>Status breakdown</h2><p>All records this term</p></div></div><div class="card-body">${stackBar(t)}
          <div class="spacer"></div><div class="note">Attendance % = (Present + Late) ÷ (Sessions recorded − Excused). Excused absences don't count against a student.</div></div></div>
      </div>
      <div class="spacer"></div>
      <div class="grid two">
        <div class="card"><div class="card-head"><div><h2>${isAdmin() ? 'Class sections' : 'My sections'}</h2><p>Current term</p></div></div>
          ${table([
      { k: 'label', label: 'Section', fmt: (v, r) => `<strong>${esc(v)}</strong><span class="sub">${esc(r.course_title)}</span>` },
      { k: 'enrolled', label: 'Enrolled', num: true, fmt: (v, r) => `${v}/${r.max_capacity}` },
      { k: 'held', label: 'Sessions held', num: true },
      { k: 'pct', label: 'Attendance', num: true, fmt: pctCell },
    ], sections, { href: (r) => 'enrollments/' + r.section_id, empty: 'No sections this term.' })}</div>
        <div class="card"><div class="card-head"><div><h2>Below ${threshold()}% threshold</h2><p>Lowest attendance first</p></div><a class="btn sm" href="#/reports" data-action="goto-report" data-tab="threshold">View all</a></div>
          ${table([
      { k: 'student_name', label: 'Student', fmt: (v, r) => `${esc(v)}<span class="sub">${esc(r.student_no)} · ${esc(r.course_code)}-${esc(r.section_code)}</span>` },
      { k: 'absent_count', label: 'Absent', num: true },
      { k: 'attendance_pct', label: '%', num: true, fmt: pctCell },
    ], low, { href: (r) => 'student/' + r.student_id, empty: 'Everyone is above the threshold.' })}</div>
      </div>
      <div class="spacer"></div>
      <div class="card"><div class="card-head"><div><h2>Today's sessions</h2><p>${esc(fmtDate(TODAY))}</p></div></div>
        ${today.length ? `<div class="session-list">${today.map(sessionItem).join('')}</div>` : '<div class="empty">No classes scheduled today.</div>'}</div>`;
  };
  ACTIONS['goto-report'] = (el) => { state.reportTab = el.dataset.tab; go('reports'); };

  // ---------------------------------------------------------------- Student overview (student role + profile)
  function studentOverview(studentId, self) {
    const s = one(`SELECT s.*, p.program_name, u.username FROM students s JOIN programs p ON p.program_id = s.program_id LEFT JOIN users u ON u.user_id = s.user_id WHERE s.student_id = ?`, [studentId]);
    if (!s) return '<div class="card"><div class="empty">Student not found.</div></div>';
    const term = currentTerm(); const tid = term ? term.term_id : -1;
    const t = statusTotals(`AND ar.student_id = ? AND sec.term_id = ${tid}`, [studentId]);
    const enr = q(`SELECT v.*, sec.section_id, i.first_name || ' ' || i.last_name AS instructor, r.building || ' ' || r.room_number AS room, e.enrolled_on, e.status AS enr_status, e.enrollment_id
      FROM enrollments e JOIN class_sections sec ON sec.section_id = e.section_id
      LEFT JOIN v_student_section_attendance v ON v.section_id = e.section_id AND v.student_id = e.student_id
      LEFT JOIN instructors i ON i.instructor_id = sec.instructor_id LEFT JOIN classrooms r ON r.room_id = sec.room_id
      JOIN academic_terms t ON t.term_id = sec.term_id
      WHERE e.student_id = ? ORDER BY t.start_date DESC, v.course_code`, [studentId]);
    const recent = q(`SELECT cs.session_date, cs.start_time, c.course_code, sec.section_code, cs.topic, ar.status, ar.check_in_time, ar.remarks
      FROM attendance_records ar JOIN class_sessions cs ON cs.session_id = ar.session_id JOIN class_sections sec ON sec.section_id = cs.section_id JOIN courses c ON c.course_id = sec.course_id
      WHERE ar.student_id = ? ORDER BY cs.session_date DESC, cs.start_time DESC LIMIT ${self ? 12 : 40}`, [studentId]);
    const lowCount = enr.filter((e) => e.attendance_pct != null && e.attendance_pct < threshold() && e.term_name === (term && term.term_name)).length;
    const adminBtns = isAdmin() && !self ? `<div class="actions"><button class="btn" data-action="edit-student" data-id="${s.student_id}">Edit</button><button class="btn primary" data-action="enroll-student" data-id="${s.student_id}">${ICON.plus}Enroll in section</button></div>` : '';
    return `
      <div class="page-head"><div style="display:flex;gap:14px;align-items:center"><span class="avatar" style="width:48px;height:48px;font-size:var(--text-base)">${esc(initials(s.first_name + ' ' + s.last_name))}</span>
        <div><h1>${esc(s.first_name + ' ' + s.last_name)}</h1><p>${esc(s.student_no)} · ${esc(s.program_name)} · Year ${s.year_level}</p></div></div>${adminBtns}</div>
      ${lowCount ? `<div class="note" style="border-color:rgba(240,113,103,.5);color:var(--absent);margin-bottom:16px">Attendance is below the ${threshold()}% threshold in ${lowCount} ${lowCount === 1 ? 'class' : 'classes'} this term.</div>` : ''}
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Attendance (${esc(term ? term.term_name : '')})</div><div class="value">${t.pct != null ? t.pct + '%' : '—'}</div><div class="delta">${num(t.total)} sessions recorded</div></div>
        ${STATUSES.map((st) => `<div class="card kpi"><div class="label"><span class="badge ${st}" style="height:18px"><span class="dot"></span>${st}</span></div><div class="value">${num(t[st])}</div><div class="delta">this term</div></div>`).join('')}
      </div>
      <div class="grid two">
        <div class="card"><div class="card-head"><div><h2>Enrolled classes</h2><p>Attendance per class section</p></div></div>
          ${table([
      { k: 'course_code', label: 'Class', fmt: (v, r) => `<strong>${esc(v)}-${esc(r.section_code)}</strong><span class="sub">${esc(r.course_title)} · ${esc(r.term_name)}</span>` },
      { k: 'instructor', label: 'Instructor / schedule', fmt: (v, r) => `${esc(v || '—')}<span class="sub">${esc(scheduleText(r.section_id))} · ${esc(r.room || '')}</span>` },
      { k: 'sessions_recorded', label: 'P / L / A / E', num: true, fmt: (v, r) => r.enr_status === 'Dropped' ? '<span class="badge off">Dropped</span>' : `<span class="tnum">${num(r.present_count)} / ${num(r.late_count)} / ${num(r.absent_count)} / ${num(r.excused_count)}</span>` },
      { k: 'attendance_pct', label: 'Attendance', num: true, fmt: pctCell },
    ], enr, { empty: 'Not enrolled in any class sections.' })}</div>
        <div class="card"><div class="card-head"><div><h2>Profile</h2></div></div><div class="card-body"><dl class="kv">
          <dt>Student no.</dt><dd class="mono">${esc(s.student_no)}</dd><dt>Email</dt><dd>${esc(s.email)}</dd><dt>Phone</dt><dd>${esc(s.phone || '—')}</dd>
          <dt>Program</dt><dd>${esc(s.program_name)}</dd><dt>Year level</dt><dd>${s.year_level}</dd><dt>Admitted</dt><dd>${esc(fmtDate(s.admitted_on))}</dd><dt>Login</dt><dd class="mono">${esc(s.username || 'No account')}</dd></dl></div></div>
      </div>
      <div class="spacer"></div>
      <div class="card"><div class="card-head"><div><h2>${self ? 'Recent attendance' : 'Attendance history'}</h2><p>${self ? 'Latest 12 sessions' : 'Latest 40 sessions'}</p></div>${self ? '<a class="btn sm" href="#/history">Full history</a>' : ''}</div>
        ${historyTable(recent)}</div>`;
  }
  const historyTable = (rows) => table([
    { k: 'session_date', label: 'Date', fmt: (v, r) => `${esc(fmtDate(v))}<span class="sub">${esc(r.start_time)}</span>` },
    { k: 'course_code', label: 'Class', fmt: (v, r) => `${esc(v)}-${esc(r.section_code)}<span class="sub">${esc(r.topic || '')}</span>` },
    { k: 'status', label: 'Status', fmt: (v) => badge(v) },
    { k: 'check_in_time', label: 'Check-in', fmt: (v) => esc(v || '—') },
    { k: 'remarks', label: 'Remarks', fmt: (v) => `<span class="muted">${esc(v || '')}</span>` },
  ], rows, { empty: 'No attendance recorded yet.' });

  PAGES.history = () => {
    const rows = q(`SELECT cs.session_date, cs.start_time, c.course_code, sec.section_code, cs.topic, ar.status, ar.check_in_time, ar.remarks, t.term_name
      FROM attendance_records ar JOIN class_sessions cs ON cs.session_id = ar.session_id JOIN class_sections sec ON sec.section_id = cs.section_id
      JOIN courses c ON c.course_id = sec.course_id JOIN academic_terms t ON t.term_id = sec.term_id
      WHERE ar.student_id = ? ORDER BY cs.session_date DESC, cs.start_time DESC`, [ME.student_id]);
    state.lastExport = { name: 'my-attendance-history.csv', rows };
    return `<div class="page-head"><div><h1>Attendance history</h1><p>${rows.length} recorded sessions across all terms</p></div><button class="btn" data-action="export-csv">${ICON.dl}Export CSV</button></div>
      <div class="card">${historyTable(rows)}</div>`;
  };
  ACTIONS['export-csv'] = () => { const e = state.lastExport; if (!e || !e.rows.length) return toast('Nothing to export.', 'err'); download(e.name, toCsv(e.rows)); };

  PAGES.student = (id) => {
    if (!canViewStudent(id)) return '<div class="card"><div class="empty">You do not have permission to view this student.</div></div>';
    return `<a class="btn ghost sm" href="#/${isAdmin() ? 'students' : 'reports'}" style="margin-bottom:12px">← Back</a>` + studentOverview(Number(id), false);
  };

  // ---------------------------------------------------------------- Users
  PAGES.users = () => {
    const rows = q(`SELECT u.user_id, u.username, u.role, u.is_active, u.created_at, u.last_login_at,
        COALESCE(s.first_name || ' ' || s.last_name, i.first_name || ' ' || i.last_name, CASE WHEN u.role='Administrator' THEN 'System Administrator' END) AS person,
        COALESCE(s.student_no, i.staff_no) AS ref
      FROM users u LEFT JOIN students s ON s.user_id = u.user_id LEFT JOIN instructors i ON i.user_id = u.user_id
      WHERE (? = '' OR u.role = ?) ORDER BY CASE u.role WHEN 'Administrator' THEN 0 WHEN 'Instructor' THEN 1 ELSE 2 END, u.username`, [state.userRole, state.userRole]);
    const counts = q(`SELECT role, COUNT(*) AS n FROM users GROUP BY role`).reduce((a, r) => (a[r.role] = r.n, a), {});
    return `<div class="page-head"><div><h1>Users & access</h1><p>Accounts, roles and role-based permissions</p></div><button class="btn primary" data-action="add-user">${ICON.plus}New user</button></div>
      <div class="grid halves" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><h2>Role permissions</h2></div><div class="card-body" style="padding:0">${table([
      { k: 'role', label: 'Role', fmt: (v) => roleBadge(v) }, { k: 'n', label: 'Accounts', num: true }, { k: 'can', label: 'Permissions', fmt: (v) => `<span class="muted">${esc(v)}</span>` }],
      [{ role: 'Administrator', n: counts.Administrator || 0, can: 'Manage users, students, instructors, courses, sections, terms, enrollment, all attendance & reports, database tools' },
      { role: 'Instructor', n: counts.Instructor || 0, can: 'Record and update attendance for assigned sections; view rosters and reports for those sections' },
      { role: 'Student', n: counts.Student || 0, can: 'View own enrollment and attendance information only' }])}</div></div>
        <div class="card"><div class="card-head"><h2>Security notes</h2></div><div class="card-body"><ul class="muted" style="margin:0;padding-left:18px;font-size:var(--text-sm);display:grid;gap:6px">
          <li>Passwords are stored as salted SHA-256 hashes, never in plain text.</li><li>Deactivated accounts cannot sign in.</li>
          <li>Every page and query is filtered by the signed-in user's role.</li><li>Attendance changes are logged by a database trigger (<span class="mono">attendance_audit</span>).</li></ul></div></div>
      </div>
      <div class="toolbar"><select class="input" data-action-change="user-role">${opt('', 'All roles', state.userRole)}${['Administrator', 'Instructor', 'Student'].map((r) => opt(r, r, state.userRole)).join('')}</select><span class="muted" style="font-size:var(--text-sm)">${rows.length} accounts</span></div>
      <div class="card">${table([
        { k: 'username', label: 'Username', fmt: (v) => `<span class="mono">${esc(v)}</span>` },
        { k: 'role', label: 'Role', fmt: (v) => roleBadge(v) },
        { k: 'person', label: 'Linked record', fmt: (v, r) => v ? `${esc(v)}<span class="sub">${esc(r.ref || '')}</span>` : '<span class="faint">Not linked</span>' },
        { k: 'is_active', label: 'Status', fmt: (v) => v ? '<span class="badge Present"><span class="dot"></span>Active</span>' : '<span class="badge off">Inactive</span>' },
        { k: 'last_login_at', label: 'Last sign-in', fmt: (v) => esc(v ? fmtDT(v) : 'Never') },
        { k: 'user_id', label: '', num: true, fmt: (v, r) => r.user_id === ME.user_id ? '<span class="faint">You</span>' : `<div class="row-actions"><button class="btn sm" data-action="reset-pw" data-id="${v}">Reset password</button><button class="btn sm" data-action="toggle-user" data-id="${v}">${r.is_active ? 'Deactivate' : 'Activate'}</button><button class="btn sm ghost danger" data-action="delete-user" data-id="${v}">Delete</button></div>` },
      ], rows)}</div>`;
  };
  AFTER.users = () => bindChange('user-role', (v) => { state.userRole = v; render(); });
  function bindChange(key, fn) { $$(`[data-action-change="${key}"]`).forEach((el) => el.addEventListener('change', () => fn(el.value, el))); }
  ACTIONS['toggle-user'] = (el) => { tx(() => run(`UPDATE users SET is_active = 1 - is_active WHERE user_id = ?`, [el.dataset.id])); toast('Account status updated.'); render(); };
  ACTIONS['delete-user'] = (el) => confirmModal('Delete user account?', 'The login account will be removed. The linked student or instructor record is kept.', () => { tx(() => run(`DELETE FROM users WHERE user_id = ?`, [el.dataset.id])); toast('User deleted.'); });
  ACTIONS['reset-pw'] = (el) => openModal({
    title: 'Reset password', sub: one(`SELECT username FROM users WHERE user_id=?`, [el.dataset.id]).username, body: field('New password (min. 6 characters)', inp('pw', '', 'type="text" required')),
    onSubmit: (d) => { if (String(d.pw).length < 6) throw new Error('Password must be at least 6 characters.'); tx(() => run(`UPDATE users SET password_hash = ? WHERE user_id = ?`, [CAMS_CRYPTO.makeHash(d.pw), el.dataset.id])); toast('Password reset.'); },
  });
  ACTIONS['add-user'] = () => {
    const us = q(`SELECT student_id, student_no, first_name || ' ' || last_name AS n FROM students WHERE user_id IS NULL ORDER BY student_no`);
    const ui = q(`SELECT instructor_id, staff_no, first_name || ' ' || last_name AS n FROM instructors WHERE user_id IS NULL ORDER BY staff_no`);
    openModal({
      title: 'New user account', body: `<div class="form-grid">
        ${field('Username', inp('username', '', 'required autocomplete="off"'))}${field('Password (min. 6)', inp('password', '', 'required'))}
        ${field('Role', `<select class="input" name="role">${['Student', 'Instructor', 'Administrator'].map((r) => opt(r, r)).join('')}</select>`)}
        ${field('Link to record', `<select class="input" name="link"><option value="">— None —</option><optgroup label="Students without account">${us.map((s) => opt('s' + s.student_id, `${s.student_no} · ${s.n}`)).join('')}</optgroup><optgroup label="Instructors without account">${ui.map((s) => opt('i' + s.instructor_id, `${s.staff_no} · ${s.n}`)).join('')}</optgroup></select>`)}
        <p class="note full">To create a student or instructor together with their login, use the Students or Instructors pages.</p></div>`,
      onSubmit: (d) => {
        req(d, ['username', 'password']);
        if (String(d.password).length < 6) throw new Error('Password must be at least 6 characters.');
        if (d.link && ((d.link[0] === 's' && d.role !== 'Student') || (d.link[0] === 'i' && d.role !== 'Instructor'))) throw new Error('The linked record must match the selected role.');
        tx(() => {
          run(`INSERT INTO users (username, password_hash, role) VALUES (?,?,?)`, [d.username.trim().toLowerCase(), CAMS_CRYPTO.makeHash(d.password), d.role]);
          const uid = lastId();
          if (d.link) run(`UPDATE ${d.link[0] === 's' ? 'students' : 'instructors'} SET user_id = ? WHERE ${d.link[0] === 's' ? 'student_id' : 'instructor_id'} = ?`, [uid, d.link.slice(1)]);
        });
        toast('User created.');
      },
    });
  };

  // ---------------------------------------------------------------- Students
  PAGES.students = () => {
    const term = currentTerm(); const tid = term ? term.term_id : -1;
    const sTerm = `%${state.studentSearch.trim()}%`;
    const rows = q(`SELECT s.student_id, s.student_no, s.first_name || ' ' || s.last_name AS name, s.email, p.program_code, s.year_level, s.user_id,
        (SELECT COUNT(*) FROM enrollments e JOIN class_sections sec ON sec.section_id = e.section_id WHERE e.student_id = s.student_id AND sec.term_id = ${tid} AND e.status='Active') AS classes,
        (SELECT ROUND(100.0*SUM(ar.status IN ('Present','Late'))/NULLIF(COUNT(*)-SUM(ar.status='Excused'),0),1) FROM attendance_records ar JOIN class_sessions cs ON cs.session_id=ar.session_id JOIN class_sections sec ON sec.section_id=cs.section_id WHERE ar.student_id=s.student_id AND sec.term_id=${tid}) AS pct
      FROM students s JOIN programs p ON p.program_id = s.program_id
      WHERE (s.student_no LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.email LIKE ? OR (s.first_name || ' ' || s.last_name) LIKE ?)
        AND (? = '' OR s.program_id = ?)
      ORDER BY s.student_no`, [sTerm, sTerm, sTerm, sTerm, sTerm, state.studentProgram, state.studentProgram]);
    const programs = q(`SELECT program_id, program_code, program_name FROM programs ORDER BY program_code`);
    return `<div class="page-head"><div><h1>Students</h1><p>${val('SELECT COUNT(*) FROM students')} registered students</p></div><button class="btn primary" data-action="add-student">${ICON.plus}Register student</button></div>
      <div class="toolbar"><div class="search">${ICON.search}<input class="input" id="stu-search" placeholder="Search by name, student no. or email" value="${esc(state.studentSearch)}"></div>
        <select class="input" data-action-change="stu-program">${opt('', 'All programs', state.studentProgram)}${programs.map((p) => opt(p.program_id, `${p.program_code} · ${p.program_name}`, state.studentProgram)).join('')}</select>
        <span class="muted" style="font-size:var(--text-sm)">${rows.length} shown</span></div>
      <div class="card">${table([
      { k: 'student_no', label: 'Student no.', fmt: (v) => `<span class="mono">${esc(v)}</span>` },
      { k: 'name', label: 'Name', fmt: (v, r) => `<strong>${esc(v)}</strong><span class="sub">${esc(r.email)}</span>` },
      { k: 'program_code', label: 'Program' }, { k: 'year_level', label: 'Year', num: true },
      { k: 'classes', label: 'Classes', num: true },
      { k: 'pct', label: 'Attendance', num: true, fmt: pctCell },
      { k: 'student_id', label: '', num: true, fmt: (v) => `<div class="row-actions"><button class="btn sm" data-action="edit-student" data-id="${v}">Edit</button><button class="btn sm ghost danger" data-action="delete-student" data-id="${v}">Delete</button></div>` },
    ], rows, { href: (r) => 'student/' + r.student_id, empty: 'No students match your search.' })}</div>`;
  };
  AFTER.students = () => {
    const s = $('#stu-search'); let t;
    s.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.studentSearch = s.value; render(); const n = $('#stu-search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 220); });
    bindChange('stu-program', (v) => { state.studentProgram = v; render(); });
  };
  function studentForm(s = {}) {
    const programs = q(`SELECT program_id, program_code, program_name FROM programs ORDER BY program_code`);
    const nextNo = s.student_no || ('S2026' + String(num(val(`SELECT MAX(CAST(SUBSTR(student_no, 6) AS INTEGER)) FROM students WHERE student_no LIKE 'S2026%'`)) + 1).padStart(3, '0'));
    return `<div class="form-grid">
      ${field('Student no.', inp('student_no', nextNo, 'required'))}${field('Admitted on', inp('admitted_on', s.admitted_on || TODAY, 'type="date" required'))}
      ${field('First name', inp('first_name', s.first_name, 'required'))}${field('Last name', inp('last_name', s.last_name, 'required'))}
      ${field('Email', inp('email', s.email, 'type="email" required'))}${field('Phone', inp('phone', s.phone))}
      ${field('Program', `<select class="input" name="program_id">${programs.map((p) => opt(p.program_id, `${p.program_code} · ${p.program_name}`, s.program_id)).join('')}</select>`)}
      ${field('Year level', `<select class="input" name="year_level">${[1, 2, 3, 4, 5, 6].map((y) => opt(y, 'Year ' + y, s.year_level || 1)).join('')}</select>`)}
      ${!s.student_id ? `<label class="check full"><input type="checkbox" name="create_login" checked> Create a login account (username = student no., password = <span class="mono">student123</span>)</label>` : ''}
    </div>`;
  }
  ACTIONS['add-student'] = () => openModal({
    title: 'Register student', body: studentForm(), wide: true,
    onSubmit: (d) => {
      req(d, ['student_no', 'first_name', 'last_name', 'email', 'admitted_on']);
      tx(() => {
        let uid = null;
        if (d.create_login) { run(`INSERT INTO users (username, password_hash, role) VALUES (?,?, 'Student')`, [d.student_no.trim().toLowerCase(), CAMS_CRYPTO.makeHash('student123')]); uid = lastId(); }
        run(`INSERT INTO students (user_id, student_no, first_name, last_name, email, phone, program_id, year_level, admitted_on) VALUES (?,?,?,?,?,?,?,?,?)`,
          [uid, d.student_no.trim().toUpperCase(), d.first_name.trim(), d.last_name.trim(), d.email.trim().toLowerCase(), d.phone || null, d.program_id, d.year_level, d.admitted_on]);
      });
      toast('Student registered.');
    },
  });
  ACTIONS['edit-student'] = (el) => {
    const s = one(`SELECT * FROM students WHERE student_id = ?`, [el.dataset.id]);
    openModal({
      title: 'Edit student', sub: s.student_no, body: studentForm(s), wide: true,
      onSubmit: (d) => {
        req(d, ['student_no', 'first_name', 'last_name', 'email', 'admitted_on']);
        tx(() => run(`UPDATE students SET student_no=?, first_name=?, last_name=?, email=?, phone=?, program_id=?, year_level=?, admitted_on=? WHERE student_id=?`,
          [d.student_no.trim().toUpperCase(), d.first_name.trim(), d.last_name.trim(), d.email.trim().toLowerCase(), d.phone || null, d.program_id, d.year_level, d.admitted_on, s.student_id]));
        toast('Student updated.');
      },
    });
  };
  ACTIONS['delete-student'] = (el) => {
    const s = one(`SELECT student_id, user_id, first_name || ' ' || last_name AS n, (SELECT COUNT(*) FROM attendance_records WHERE student_id = students.student_id) AS recs FROM students WHERE student_id = ?`, [el.dataset.id]);
    confirmModal(`Delete ${s.n}?`, `This permanently removes the student, their enrollments and ${s.recs} attendance records (ON DELETE CASCADE), and their login account.`, () => {
      tx(() => { run(`DELETE FROM students WHERE student_id = ?`, [s.student_id]); if (s.user_id) run(`DELETE FROM users WHERE user_id = ?`, [s.user_id]); });
      toast('Student deleted.'); if (parseHash().route === 'student') go('students');
    });
  };
  ACTIONS['enroll-student'] = (el) => {
    const sid = el.dataset.id;
    const secs = sectionOptions(`AND t.is_current = 1 AND sec.section_id NOT IN (SELECT section_id FROM enrollments WHERE student_id = ${Number(sid)})`);
    openModal({
      title: 'Enroll in class section', body: secs.rows.length ? field('Class section', `<select class="input" name="section_id">${secs.html}</select>`) : '<p class="muted">Already enrolled in every current section.</p>',
      submitLabel: 'Enroll',
      onSubmit: (d) => { if (!d.section_id) return; tx(() => run(`INSERT INTO enrollments (student_id, section_id, enrolled_on) VALUES (?,?,?)`, [sid, d.section_id, TODAY])); toast('Student enrolled.'); },
    });
  };

  // ---------------------------------------------------------------- Instructors
  PAGES.instructors = () => {
    const term = currentTerm(); const tid = term ? term.term_id : -1;
    const rows = q(`SELECT i.*, i.first_name || ' ' || i.last_name AS name, d.department_code, u.username,
        (SELECT group_concat(c.course_code || '-' || sec.section_code, ', ') FROM class_sections sec JOIN courses c ON c.course_id = sec.course_id WHERE sec.instructor_id = i.instructor_id AND sec.term_id = ${tid}) AS teaching
      FROM instructors i JOIN departments d ON d.department_id = i.department_id LEFT JOIN users u ON u.user_id = i.user_id ORDER BY i.staff_no`);
    return `<div class="page-head"><div><h1>Instructors</h1><p>${rows.length} instructors · assignments for ${esc(term ? term.term_name : '')}</p></div><button class="btn primary" data-action="add-instructor">${ICON.plus}Add instructor</button></div>
      <div class="card">${table([
      { k: 'staff_no', label: 'Staff no.', fmt: (v) => `<span class="mono">${esc(v)}</span>` },
      { k: 'name', label: 'Name', fmt: (v, r) => `<strong>${esc(v)}</strong><span class="sub">${esc(r.email)}</span>` },
      { k: 'department_code', label: 'Dept.' },
      { k: 'teaching', label: 'Sections this term', fmt: (v) => v ? `<div class="pill-list">${v.split(', ').map((x) => `<span class="badge">${esc(x)}</span>`).join('')}</div>` : '<span class="faint">None</span>' },
      { k: 'username', label: 'Login', fmt: (v) => v ? `<span class="mono">${esc(v)}</span>` : '<span class="faint">No account</span>' },
      { k: 'instructor_id', label: '', num: true, fmt: (v) => `<div class="row-actions"><button class="btn sm" data-action="edit-instructor" data-id="${v}">Edit</button><button class="btn sm ghost danger" data-action="delete-instructor" data-id="${v}">Delete</button></div>` },
    ], rows)}</div>`;
  };
  function instructorForm(i = {}) {
    const depts = q(`SELECT * FROM departments ORDER BY department_code`);
    return `<div class="form-grid">
      ${field('Staff no.', inp('staff_no', i.staff_no || 'T-' + (1000 + num(val('SELECT COUNT(*) FROM instructors')) + 1), 'required'))}
      ${field('Department', `<select class="input" name="department_id">${depts.map((d) => opt(d.department_id, d.department_name, i.department_id)).join('')}</select>`)}
      ${field('First name', inp('first_name', i.first_name, 'required'))}${field('Last name', inp('last_name', i.last_name, 'required'))}
      ${field('Email', inp('email', i.email, 'type="email" required'))}${field('Phone', inp('phone', i.phone))}
      ${!i.instructor_id ? `${field('Login username', inp('username', '', 'placeholder="e.g. jdoe"'))}<p class="muted" style="font-size:var(--text-xs);align-self:end">Leave blank for no login. Default password: <span class="mono">teach123</span></p>` : ''}
    </div>`;
  }
  ACTIONS['add-instructor'] = () => openModal({
    title: 'Add instructor', body: instructorForm(), wide: true,
    onSubmit: (d) => {
      req(d, ['staff_no', 'first_name', 'last_name', 'email']);
      tx(() => {
        let uid = null;
        if (d.username && d.username.trim()) { run(`INSERT INTO users (username, password_hash, role) VALUES (?,?, 'Instructor')`, [d.username.trim().toLowerCase(), CAMS_CRYPTO.makeHash('teach123')]); uid = lastId(); }
        run(`INSERT INTO instructors (user_id, staff_no, first_name, last_name, email, phone, department_id) VALUES (?,?,?,?,?,?,?)`, [uid, d.staff_no.trim(), d.first_name.trim(), d.last_name.trim(), d.email.trim().toLowerCase(), d.phone || null, d.department_id]);
      });
      toast('Instructor added.');
    },
  });
  ACTIONS['edit-instructor'] = (el) => {
    const i = one(`SELECT * FROM instructors WHERE instructor_id = ?`, [el.dataset.id]);
    openModal({
      title: 'Edit instructor', sub: i.staff_no, body: instructorForm(i), wide: true,
      onSubmit: (d) => {
        req(d, ['staff_no', 'first_name', 'last_name', 'email']);
        tx(() => run(`UPDATE instructors SET staff_no=?, first_name=?, last_name=?, email=?, phone=?, department_id=? WHERE instructor_id=?`, [d.staff_no.trim(), d.first_name.trim(), d.last_name.trim(), d.email.trim().toLowerCase(), d.phone || null, d.department_id, i.instructor_id]));
        toast('Instructor updated.');
      },
    });
  };
  ACTIONS['delete-instructor'] = (el) => {
    const i = one(`SELECT instructor_id, user_id, first_name || ' ' || last_name AS n FROM instructors WHERE instructor_id = ?`, [el.dataset.id]);
    confirmModal(`Delete ${i.n}?`, 'Their class sections will become unassigned (ON DELETE SET NULL) and their login account will be removed.', () => {
      tx(() => { run(`DELETE FROM instructors WHERE instructor_id = ?`, [i.instructor_id]); if (i.user_id) run(`DELETE FROM users WHERE user_id = ?`, [i.user_id]); });
      toast('Instructor deleted.');
    });
  };

  // ---------------------------------------------------------------- Courses
  PAGES.courses = () => {
    const rows = q(`SELECT c.*, d.department_code, (SELECT COUNT(*) FROM class_sections sec WHERE sec.course_id = c.course_id) AS sections,
      v.attendance_pct FROM courses c JOIN departments d ON d.department_id = c.department_id LEFT JOIN v_course_statistics v ON v.course_id = c.course_id ORDER BY c.course_code`);
    return `<div class="page-head"><div><h1>Courses</h1><p>Course catalogue</p></div><button class="btn primary" data-action="add-course">${ICON.plus}New course</button></div>
      <div class="card">${table([
      { k: 'course_code', label: 'Code', fmt: (v) => `<strong class="mono">${esc(v)}</strong>` },
      { k: 'course_title', label: 'Title' }, { k: 'department_code', label: 'Dept.' },
      { k: 'credits', label: 'Credits', num: true }, { k: 'sections', label: 'Sections', num: true },
      { k: 'attendance_pct', label: 'Attendance (all terms)', num: true, fmt: pctCell },
      { k: 'course_id', label: '', num: true, fmt: (v) => `<div class="row-actions"><button class="btn sm" data-action="edit-course" data-id="${v}">Edit</button><button class="btn sm ghost danger" data-action="delete-course" data-id="${v}">Delete</button></div>` },
    ], rows)}</div>`;
  };
  function courseForm(c = {}) {
    const depts = q(`SELECT * FROM departments ORDER BY department_code`);
    return `<div class="form-grid">${field('Course code', inp('course_code', c.course_code, 'required placeholder="e.g. CS401"'))}${field('Credits', inp('credits', c.credits || 3, 'type="number" min="1" max="6" required'))}
      ${field('Title', inp('course_title', c.course_title, 'required'), true)}${field('Department', `<select class="input" name="department_id">${depts.map((d) => opt(d.department_id, d.department_name, c.department_id)).join('')}</select>`, true)}</div>`;
  }
  ACTIONS['add-course'] = () => openModal({ title: 'New course', body: courseForm(), onSubmit: (d) => { req(d, ['course_code', 'course_title']); tx(() => run(`INSERT INTO courses (course_code, course_title, credits, department_id) VALUES (?,?,?,?)`, [d.course_code.trim().toUpperCase(), d.course_title.trim(), d.credits, d.department_id])); toast('Course created.'); } });
  ACTIONS['edit-course'] = (el) => { const c = one(`SELECT * FROM courses WHERE course_id=?`, [el.dataset.id]); openModal({ title: 'Edit course', body: courseForm(c), onSubmit: (d) => { req(d, ['course_code', 'course_title']); tx(() => run(`UPDATE courses SET course_code=?, course_title=?, credits=?, department_id=? WHERE course_id=?`, [d.course_code.trim().toUpperCase(), d.course_title.trim(), d.credits, d.department_id, c.course_id])); toast('Course updated.'); } }); };
  ACTIONS['delete-course'] = (el) => confirmModal('Delete course?', 'All of its class sections, sessions, enrollments and attendance records will also be removed (ON DELETE CASCADE).', () => { tx(() => run(`DELETE FROM courses WHERE course_id=?`, [el.dataset.id])); toast('Course deleted.'); });

  // ---------------------------------------------------------------- Sections
  PAGES.sections = () => {
    const terms = q(`SELECT * FROM academic_terms ORDER BY start_date DESC`);
    if (!state.termFilter) { const ct = currentTerm(); state.termFilter = ct ? String(ct.term_id) : ''; }
    const rows = q(`SELECT sec.*, ${SECTION_LABEL} AS label, c.course_title, t.term_name, i.first_name || ' ' || i.last_name AS instructor, r.building || ' ' || r.room_number AS room,
        (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.section_id AND e.status='Active') AS enrolled
      FROM class_sections sec JOIN courses c ON c.course_id = sec.course_id JOIN academic_terms t ON t.term_id = sec.term_id
      LEFT JOIN instructors i ON i.instructor_id = sec.instructor_id LEFT JOIN classrooms r ON r.room_id = sec.room_id
      WHERE (? = 'all' OR sec.term_id = ?) ${secScope()} ORDER BY c.course_code, sec.section_code`, [state.termFilter, state.termFilter]);
    return `<div class="page-head"><div><h1>${isAdmin() ? 'Class sections' : 'My sections'}</h1><p>Sections, instructors, classrooms and weekly schedules</p></div>${isAdmin() ? `<button class="btn primary" data-action="add-section">${ICON.plus}New section</button>` : ''}</div>
      <div class="toolbar"><select class="input" data-action-change="term-filter">${opt('all', 'All terms', state.termFilter)}${terms.map((t) => opt(t.term_id, t.term_name + (t.is_current ? ' (current)' : ''), state.termFilter)).join('')}</select></div>
      <div class="card">${table([
      { k: 'label', label: 'Section', fmt: (v, r) => `<strong>${esc(v)}</strong><span class="sub">${esc(r.course_title)}</span>` },
      { k: 'term_name', label: 'Term' },
      { k: 'instructor', label: 'Instructor', fmt: (v) => v ? esc(v) : '<span class="badge Late">Unassigned</span>' },
      { k: 'room', label: 'Room', fmt: (v) => esc(v || '—') },
      { k: 'section_id', label: 'Schedule', fmt: (v) => `<span class="muted">${esc(scheduleText(v))}</span>` },
      { k: 'enrolled', label: 'Enrolled', num: true, fmt: (v, r) => `${v}/${r.max_capacity}` },
      { k: 'section_id', label: '', num: true, fmt: (v) => `<div class="row-actions"><a class="btn sm" href="#/enrollments/${v}">Roster</a>${isAdmin() ? `<button class="btn sm" data-action="edit-section" data-id="${v}">Edit</button><button class="btn sm ghost danger" data-action="delete-section" data-id="${v}">Delete</button>` : ''}</div>` },
    ], rows, { empty: 'No sections for this term.' })}</div>`;
  };
  AFTER.sections = () => bindChange('term-filter', (v) => { state.termFilter = v; render(); });
  function sectionForm(s = {}) {
    const courses = q(`SELECT course_id, course_code, course_title FROM courses ORDER BY course_code`);
    const terms = q(`SELECT * FROM academic_terms ORDER BY start_date DESC`);
    const ins = q(`SELECT instructor_id, first_name || ' ' || last_name AS n FROM instructors ORDER BY last_name`);
    const rooms = q(`SELECT room_id, building || ' ' || room_number || ' (cap. ' || capacity || ')' AS n FROM classrooms ORDER BY building, room_number`);
    const sch = s.section_id ? q(`SELECT * FROM section_schedules WHERE section_id=? ORDER BY day_of_week`, [s.section_id]) : [];
    const ct = currentTerm();
    const schRow = (i, r = {}) => `<div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px">
      <select class="input" name="day${i}">${opt('', '— Day —', r.day_of_week || '')}${[1, 2, 3, 4, 5, 6, 7].map((d) => opt(d, DAYS[d], r.day_of_week)).join('')}</select>
      <input class="input" type="time" name="start${i}" value="${esc(r.start_time || '')}"><input class="input" type="time" name="end${i}" value="${esc(r.end_time || '')}"></div>`;
    return `<div class="form-grid">
      ${field('Course', `<select class="input" name="course_id">${courses.map((c) => opt(c.course_id, `${c.course_code} · ${c.course_title}`, s.course_id)).join('')}</select>`, true)}
      ${field('Term', `<select class="input" name="term_id">${terms.map((t) => opt(t.term_id, t.term_name, s.term_id || (ct && ct.term_id))).join('')}</select>`)}
      ${field('Section code', inp('section_code', s.section_code || 'A', 'required maxlength="4"'))}
      ${field('Instructor', `<select class="input" name="instructor_id">${opt('', '— Unassigned —', s.instructor_id || '')}${ins.map((i) => opt(i.instructor_id, i.n, s.instructor_id)).join('')}</select>`)}
      ${field('Classroom', `<select class="input" name="room_id">${opt('', '— None —', s.room_id || '')}${rooms.map((r) => opt(r.room_id, r.n, s.room_id)).join('')}</select>`)}
      ${field('Max capacity', inp('max_capacity', s.max_capacity || 30, 'type="number" min="1" required'))}
      <div class="field full"><label>Weekly schedule (day · start · end)</label><div class="grid" style="gap:8px">${[0, 1, 2].map((i) => schRow(i, sch[i])).join('')}</div></div></div>`;
  }
  function saveSchedules(sectionId, d) {
    run(`DELETE FROM section_schedules WHERE section_id = ?`, [sectionId]);
    for (const i of [0, 1, 2]) {
      if (!d['day' + i]) continue;
      if (!d['start' + i] || !d['end' + i]) throw new Error('Each schedule row needs a start and end time.');
      if (d['end' + i] <= d['start' + i]) throw new Error('Schedule end time must be after start time.');
      run(`INSERT INTO section_schedules (section_id, day_of_week, start_time, end_time) VALUES (?,?,?,?)`, [sectionId, d['day' + i], d['start' + i], d['end' + i]]);
    }
  }
  ACTIONS['add-section'] = () => openModal({
    title: 'New class section', body: sectionForm(), wide: true,
    onSubmit: (d) => {
      req(d, ['section_code', 'max_capacity']);
      tx(() => { run(`INSERT INTO class_sections (course_id, term_id, section_code, instructor_id, room_id, max_capacity) VALUES (?,?,?,?,?,?)`, [d.course_id, d.term_id, d.section_code.trim().toUpperCase(), d.instructor_id || null, d.room_id || null, d.max_capacity]); saveSchedules(lastId(), d); });
      toast('Section created.');
    },
  });
  ACTIONS['edit-section'] = (el) => {
    const s = one(`SELECT * FROM class_sections WHERE section_id=?`, [el.dataset.id]);
    openModal({
      title: 'Edit class section', body: sectionForm(s), wide: true,
      onSubmit: (d) => {
        req(d, ['section_code', 'max_capacity']);
        tx(() => { run(`UPDATE class_sections SET course_id=?, term_id=?, section_code=?, instructor_id=?, room_id=?, max_capacity=? WHERE section_id=?`, [d.course_id, d.term_id, d.section_code.trim().toUpperCase(), d.instructor_id || null, d.room_id || null, d.max_capacity, s.section_id]); saveSchedules(s.section_id, d); });
        toast('Section updated.');
      },
    });
  };
  ACTIONS['delete-section'] = (el) => confirmModal('Delete class section?', 'Its schedule, sessions, enrollments and attendance records will also be removed (ON DELETE CASCADE).', () => { tx(() => run(`DELETE FROM class_sections WHERE section_id=?`, [el.dataset.id])); toast('Section deleted.'); });

  // ---------------------------------------------------------------- Terms & rooms
  PAGES.terms = () => {
    const terms = q(`SELECT t.*, (SELECT COUNT(*) FROM class_sections WHERE term_id = t.term_id) AS sections FROM academic_terms t ORDER BY start_date DESC`);
    const rooms = q(`SELECT r.*, (SELECT COUNT(*) FROM class_sections sec WHERE sec.room_id = r.room_id) AS sections FROM classrooms r ORDER BY building, room_number`);
    const depts = q(`SELECT d.*, (SELECT COUNT(*) FROM programs WHERE department_id = d.department_id) AS programs, (SELECT COUNT(*) FROM courses WHERE department_id = d.department_id) AS courses FROM departments d ORDER BY department_code`);
    return `<div class="page-head"><div><h1>Terms & rooms</h1><p>Academic terms, classrooms and departments</p></div></div>
      <div class="grid halves">
        <div class="card"><div class="card-head"><h2>Academic terms</h2><button class="btn sm primary" data-action="add-term">${ICON.plus}Add term</button></div>${table([
      { k: 'term_name', label: 'Term', fmt: (v, r) => `<strong>${esc(v)}</strong>${r.is_current ? ' <span class="badge Present">Current</span>' : ''}` },
      { k: 'start_date', label: 'Dates', fmt: (v, r) => `<span class="muted">${esc(fmtDate(v, { day: 'numeric', month: 'short', year: 'numeric' }))} – ${esc(fmtDate(r.end_date, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>` },
      { k: 'sections', label: 'Sections', num: true },
      { k: 'term_id', label: '', num: true, fmt: (v, r) => r.is_current ? '' : `<button class="btn sm" data-action="set-term" data-id="${v}">Set current</button>` },
    ], terms)}</div>
        <div class="card"><div class="card-head"><h2>Classrooms</h2><button class="btn sm primary" data-action="add-room">${ICON.plus}Add room</button></div>${table([
      { k: 'building', label: 'Building' }, { k: 'room_number', label: 'Room', fmt: (v) => `<span class="mono">${esc(v)}</span>` },
      { k: 'capacity', label: 'Capacity', num: true }, { k: 'sections', label: 'Sections', num: true },
    ], rooms)}</div>
      </div><div class="spacer"></div>
      <div class="card"><div class="card-head"><h2>Departments</h2></div>${table([{ k: 'department_code', label: 'Code', fmt: (v) => `<span class="mono">${esc(v)}</span>` }, { k: 'department_name', label: 'Department' }, { k: 'programs', label: 'Programs', num: true }, { k: 'courses', label: 'Courses', num: true }], depts)}</div>`;
  };
  ACTIONS['add-term'] = () => openModal({
    title: 'Add academic term', body: `<div class="form-grid">${field('Term name', inp('term_name', '', 'required placeholder="e.g. Spring 2027"'), true)}${field('Start date', inp('start_date', '', 'type="date" required'))}${field('End date', inp('end_date', '', 'type="date" required'))}<label class="check full"><input type="checkbox" name="is_current"> Make this the current term</label></div>`,
    onSubmit: (d) => { req(d, ['term_name', 'start_date', 'end_date']); if (d.end_date <= d.start_date) throw new Error('End date must be after the start date.'); tx(() => { if (d.is_current) run(`UPDATE academic_terms SET is_current = 0`); run(`INSERT INTO academic_terms (term_name, start_date, end_date, is_current) VALUES (?,?,?,?)`, [d.term_name.trim(), d.start_date, d.end_date, d.is_current ? 1 : 0]); }); toast('Term added.'); },
  });
  ACTIONS['set-term'] = (el) => { tx(() => { run(`UPDATE academic_terms SET is_current = 0`); run(`UPDATE academic_terms SET is_current = 1 WHERE term_id = ?`, [el.dataset.id]); }); state.termFilter = ''; toast('Current term updated.'); render(); };
  ACTIONS['add-room'] = () => openModal({
    title: 'Add classroom', body: `<div class="form-grid">${field('Building', inp('building', '', 'required'))}${field('Room number', inp('room_number', '', 'required'))}${field('Capacity', inp('capacity', 30, 'type="number" min="1" required'))}</div>`,
    onSubmit: (d) => { req(d, ['building', 'room_number', 'capacity']); tx(() => run(`INSERT INTO classrooms (building, room_number, capacity) VALUES (?,?,?)`, [d.building.trim(), d.room_number.trim().toUpperCase(), d.capacity])); toast('Classroom added.'); },
  });

  // ---------------------------------------------------------------- Enrollment
  PAGES.enrollments = (id) => {
    const secs = sectionOptions();
    if (id) state.enrollSection = String(id);
    if (!secs.rows.find((r) => String(r.section_id) === String(state.enrollSection))) state.enrollSection = secs.rows[0] ? String(secs.rows[0].section_id) : '';
    const sid = Number(state.enrollSection);
    if (!sid) return '<div class="card"><div class="empty">No class sections available.</div></div>';
    const sec = one(`SELECT sec.*, ${SECTION_LABEL} AS label, c.course_title, t.term_name, i.first_name || ' ' || i.last_name AS instructor, r.building || ' ' || r.room_number AS room
      FROM class_sections sec JOIN courses c ON c.course_id = sec.course_id JOIN academic_terms t ON t.term_id = sec.term_id LEFT JOIN instructors i ON i.instructor_id = sec.instructor_id LEFT JOIN classrooms r ON r.room_id = sec.room_id WHERE sec.section_id = ?`, [sid]);
    const roster = q(`SELECT e.enrollment_id, e.enrolled_on, e.status, s.student_id, s.student_no, s.first_name || ' ' || s.last_name AS name, s.email, v.attendance_pct, v.absent_count, v.late_count
      FROM enrollments e JOIN students s ON s.student_id = e.student_id LEFT JOIN v_student_section_attendance v ON v.student_id = e.student_id AND v.section_id = e.section_id
      WHERE e.section_id = ? ORDER BY e.status, s.last_name, s.first_name`, [sid]);
    const active = roster.filter((r) => r.status === 'Active').length;
    const available = isAdmin() ? q(`SELECT student_id, student_no, first_name || ' ' || last_name AS n FROM students WHERE student_id NOT IN (SELECT student_id FROM enrollments WHERE section_id = ?) ORDER BY student_no`, [sid]) : [];
    state.lastExport = { name: `roster-${sec.label}.csv`, rows: roster.map(({ student_no, name, email, enrolled_on, status, attendance_pct }) => ({ student_no, name, email, enrolled_on, status, attendance_pct })) };
    return `<div class="page-head"><div><h1>${isAdmin() ? 'Enrollment' : 'Class roster'}</h1><p>Enroll students in class sections. Duplicate enrollment and over-capacity enrollment are blocked by the database.</p></div>
        <div class="actions"><button class="btn" data-action="export-csv">${ICON.dl}Export roster</button></div></div>
      <div class="toolbar"><select class="input" style="min-width:320px" data-action-change="enroll-section">${secs.html.replace(`value="${sid}"`, `value="${sid}" selected`)}</select></div>
      <div class="grid two">
        <div class="card"><div class="card-head"><div><h2>${esc(sec.label)} · ${esc(sec.course_title)}</h2><p>${active} of ${sec.max_capacity} seats filled</p></div></div>
          ${table([
      { k: 'student_no', label: 'Student no.', fmt: (v) => `<span class="mono">${esc(v)}</span>` },
      { k: 'name', label: 'Name', fmt: (v, r) => `<strong>${esc(v)}</strong><span class="sub">Enrolled ${esc(fmtDate(r.enrolled_on, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>` },
      { k: 'status', label: 'Status', fmt: (v) => v === 'Active' ? '<span class="badge Present"><span class="dot"></span>Active</span>' : '<span class="badge off">Dropped</span>' },
      { k: 'attendance_pct', label: 'Attendance', num: true, fmt: pctCell },
      ...(isAdmin() ? [{ k: 'enrollment_id', label: '', num: true, fmt: (v, r) => `<div class="row-actions"><button class="btn sm" data-action="toggle-enroll" data-id="${v}">${r.status === 'Active' ? 'Drop' : 'Reactivate'}</button><button class="btn sm ghost danger" data-action="remove-enroll" data-id="${v}">Remove</button></div>` }] : []),
    ], roster, { href: (r) => 'student/' + r.student_id, empty: 'No students enrolled yet.' })}</div>
        <div class="grid" style="align-content:start">
          <div class="card"><div class="card-head"><h2>Section details</h2></div><div class="card-body"><dl class="kv">
            <dt>Term</dt><dd>${esc(sec.term_name)}</dd><dt>Instructor</dt><dd>${esc(sec.instructor || 'Unassigned')}</dd><dt>Room</dt><dd>${esc(sec.room || '—')}</dd>
            <dt>Schedule</dt><dd>${esc(scheduleText(sid))}</dd><dt>Capacity</dt><dd>${active}/${sec.max_capacity}</dd></dl>
            <div class="stack" style="margin-top:14px"><i style="width:${(active / sec.max_capacity) * 100}%;background:var(--accent)"></i></div></div></div>
          ${isAdmin() ? `<div class="card"><div class="card-head"><h2>Enroll a student</h2></div><div class="card-body grid" style="gap:10px">
            ${available.length ? `<select class="input" id="enroll-pick">${available.map((s) => opt(s.student_id, `${s.student_no} · ${s.n}`)).join('')}</select><button class="btn primary" data-action="do-enroll">${ICON.plus}Enroll student</button>` : '<p class="muted">Every student is already in this section.</p>'}
            <p class="faint" style="font-size:var(--text-xs)">Enforced by <span class="mono">UNIQUE (student_id, section_id)</span> and trigger <span class="mono">trg_enrollment_capacity</span>.</p></div></div>` : ''}
        </div></div>`;
  };
  AFTER.enrollments = () => bindChange('enroll-section', (v) => { state.enrollSection = v; go('enrollments/' + v); });
  ACTIONS['do-enroll'] = () => { const sid = $('#enroll-pick').value; tx(() => run(`INSERT INTO enrollments (student_id, section_id, enrolled_on) VALUES (?,?,?)`, [sid, state.enrollSection, TODAY])); toast('Student enrolled.'); render(); };
  ACTIONS['toggle-enroll'] = (el) => { tx(() => run(`UPDATE enrollments SET status = CASE status WHEN 'Active' THEN 'Dropped' ELSE 'Active' END WHERE enrollment_id = ?`, [el.dataset.id])); toast('Enrollment updated.'); render(); };
  ACTIONS['remove-enroll'] = (el) => confirmModal('Remove enrollment?', 'The enrollment record is deleted. Existing attendance records for this student remain in the database.', () => { tx(() => run(`DELETE FROM enrollments WHERE enrollment_id = ?`, [el.dataset.id])); toast('Enrollment removed.'); });

  // ---------------------------------------------------------------- Sessions list
  PAGES.attendance = () => {
    const secs = sectionOptions('AND t.is_current = 1');
    const when = state.attWhen;
    const where = [];
    if (state.attSection) where.push(`v.section_id = ${Number(state.attSection)}`);
    if (when === 'recent') where.push(`v.session_date BETWEEN date('${TODAY}','-14 day') AND date('${TODAY}','+7 day')`);
    if (when === 'pending') where.push(`v.session_date <= '${TODAY}' AND v.recorded < v.enrolled`);
    if (when === 'upcoming') where.push(`v.session_date > '${TODAY}'`);
    const rows = q(`SELECT v.* FROM v_session_summary v JOIN class_sections sec ON sec.section_id = v.section_id JOIN academic_terms t ON t.term_id = sec.term_id
      WHERE t.is_current = 1 ${secScope()} ${where.length ? 'AND ' + where.join(' AND ') : ''}
      ORDER BY v.session_date ${when === 'upcoming' ? 'ASC' : 'DESC'}, v.start_time LIMIT 200`);
    const todays = rows.filter((r) => r.session_date === TODAY);
    const rest = rows.filter((r) => r.session_date !== TODAY);
    return `<div class="page-head"><div><h1>${isAdmin() ? 'Sessions & attendance' : 'Take attendance'}</h1><p>Class sessions are created from each section's weekly schedule. Open a session to record attendance.</p></div>
        <div class="actions"><button class="btn" data-action="gen-sessions">${ICON.cal}Generate from schedule</button><button class="btn primary" data-action="new-session">${ICON.plus}New session</button></div></div>
      <div class="toolbar"><select class="input" data-action-change="att-section">${opt('', isAdmin() ? 'All current sections' : 'All my sections', state.attSection)}${secs.html.replace(`value="${state.attSection}"`, `value="${state.attSection}" selected`)}</select>
        <div class="seg-ctl" role="tablist">${[['recent', 'Recent'], ['pending', 'Needs attendance'], ['upcoming', 'Upcoming'], ['all', 'All']].map(([k, l]) => `<button type="button" class="${when === k ? 'on Present' : ''}" data-action="att-when" data-v="${k}">${l}</button>`).join('')}</div>
        <span class="muted" style="font-size:var(--text-sm)">${rows.length} sessions</span></div>
      ${todays.length ? `<div class="card" style="margin-bottom:16px;border-color:rgba(95,212,166,.35)"><div class="card-head"><div><h2>Today</h2><p>${esc(fmtDate(TODAY))}</p></div></div><div class="session-list">${todays.map(sessionItem).join('')}</div></div>` : ''}
      <div class="card">${rest.length ? `<div class="session-list">${rest.map(sessionItem).join('')}</div>` : '<div class="empty">No sessions match these filters.</div>'}</div>`;
  };
  AFTER.attendance = () => bindChange('att-section', (v) => { state.attSection = v; render(); });
  ACTIONS['att-when'] = (el) => { state.attWhen = el.dataset.v; render(); };
  ACTIONS['new-session'] = () => {
    const secs = sectionOptions('AND t.is_current = 1', state.attSection);
    openModal({
      title: 'New class session', body: `<div class="form-grid">${field('Class section', `<select class="input" name="section_id" id="ns-sec">${secs.html}</select>`, true)}
        ${field('Date', inp('session_date', TODAY, 'type="date" required'))}${field('Topic', inp('topic', '', 'placeholder="Optional"'))}
        ${field('Start time', inp('start_time', '09:00', 'type="time" required id="ns-start"'))}${field('End time', inp('end_time', '10:30', 'type="time" required id="ns-end"'))}</div>`,
      onMount: (f) => {
        const fill = () => { const s = one(`SELECT start_time, end_time FROM section_schedules WHERE section_id = ? ORDER BY day_of_week LIMIT 1`, [f.section_id.value]); if (s) { f.start_time.value = s.start_time; f.end_time.value = s.end_time; } };
        f.section_id.addEventListener('change', fill); fill();
      },
      onSubmit: (d) => {
        req(d, ['section_id', 'session_date', 'start_time', 'end_time']);
        if (!canManageSection(d.section_id)) throw new Error('You can only create sessions for your own sections.');
        if (d.end_time <= d.start_time) throw new Error('End time must be after start time.');
        const sch = one(`SELECT schedule_id FROM section_schedules WHERE section_id = ? AND start_time = ?`, [d.section_id, d.start_time]);
        let newId;
        tx(() => { run(`INSERT INTO class_sessions (section_id, schedule_id, session_date, start_time, end_time, topic) VALUES (?,?,?,?,?,?)`, [d.section_id, sch ? sch.schedule_id : null, d.session_date, d.start_time, d.end_time, d.topic || null]); newId = lastId(); });
        toast('Session created.'); setTimeout(() => go('session/' + newId), 0);
      },
    });
  };
  ACTIONS['gen-sessions'] = () => {
    const secs = sectionOptions('AND t.is_current = 1', state.attSection);
    const term = currentTerm();
    openModal({
      title: 'Generate sessions from schedule', sub: 'Creates one session for every scheduled class meeting in the date range. Existing sessions are skipped.',
      body: `<div class="form-grid">${field('Class section', `<select class="input" name="section_id"><option value="all">All ${isAdmin() ? 'current' : 'my'} sections</option>${secs.html}</select>`, true)}
        ${field('From', inp('from', TODAY, 'type="date" required'))}${field('To', inp('to', term ? term.end_date : TODAY, 'type="date" required'))}</div>`,
      submitLabel: 'Generate',
      onSubmit: (d) => {
        if (d.to < d.from) throw new Error('"To" date must be on or after "From".');
        const ids = d.section_id === 'all' ? secs.rows.map((r) => r.section_id) : [Number(d.section_id)];
        let created = 0;
        tx(() => {
          for (const sid of ids) {
            if (!canManageSection(sid)) continue;
            const sch = q(`SELECT * FROM section_schedules WHERE section_id = ?`, [sid]);
            for (let dt = new Date(d.from + 'T00:00:00'); localYmd(dt) <= d.to; dt.setDate(dt.getDate() + 1)) {
              const dow = ((dt.getDay() + 6) % 7) + 1;
              for (const s of sch.filter((x) => x.day_of_week === dow)) {
                run(`INSERT OR IGNORE INTO class_sessions (section_id, schedule_id, session_date, start_time, end_time) VALUES (?,?,?,?,?)`, [sid, s.schedule_id, localYmd(dt), s.start_time, s.end_time]);
                created += db.getRowsModified();
              }
            }
          }
        });
        toast(`${created} new session${created === 1 ? '' : 's'} created.`);
      },
    });
  };

  // ---------------------------------------------------------------- Session (take attendance)
  let MARKS = {};
  PAGES.session = (id) => {
    const s = one(`SELECT cs.*, sec.section_id, sec.instructor_id, ${SECTION_LABEL} AS label, c.course_title, t.term_name, i.first_name || ' ' || i.last_name AS instructor, r.building || ' ' || r.room_number AS room
      FROM class_sessions cs JOIN class_sections sec ON sec.section_id = cs.section_id JOIN courses c ON c.course_id = sec.course_id JOIN academic_terms t ON t.term_id = sec.term_id
      LEFT JOIN instructors i ON i.instructor_id = sec.instructor_id LEFT JOIN classrooms r ON r.room_id = sec.room_id WHERE cs.session_id = ?`, [id]);
    if (!s || !canManageSection(s.section_id)) return '<div class="card"><div class="empty">Session not found or you do not have access to it.</div></div>';
    const roster = q(`SELECT s.student_id, s.student_no, s.first_name || ' ' || s.last_name AS name, ar.attendance_id, ar.status, ar.check_in_time, ar.remarks
      FROM enrollments e JOIN students s ON s.student_id = e.student_id LEFT JOIN attendance_records ar ON ar.student_id = s.student_id AND ar.session_id = ?
      WHERE e.section_id = ? AND e.status = 'Active' ORDER BY s.last_name, s.first_name`, [id, s.section_id]);
    MARKS = { _session: s };
    roster.forEach((r) => { MARKS[r.student_id] = { status: r.status || '', check: r.check_in_time || '', remarks: r.remarks || '', existing: !!r.attendance_id }; });
    const future = s.session_date > TODAY;
    const dis = future ? 'disabled' : '';
    const audit = q(`SELECT a.*, st.first_name || ' ' || st.last_name AS name, u.username FROM attendance_audit a JOIN attendance_records ar ON ar.attendance_id = a.attendance_id
      JOIN students st ON st.student_id = ar.student_id LEFT JOIN users u ON u.user_id = a.changed_by WHERE ar.session_id = ? ORDER BY a.changed_at DESC, a.audit_id DESC LIMIT 30`, [id]);
    const key = s.session_date + ' ' + s.start_time;
    const prev = one(`SELECT session_id FROM class_sessions WHERE section_id = ? AND (session_date || ' ' || start_time) < ? ORDER BY session_date DESC, start_time DESC LIMIT 1`, [s.section_id, key]);
    const next = one(`SELECT session_id FROM class_sessions WHERE section_id = ? AND (session_date || ' ' || start_time) > ? ORDER BY session_date, start_time LIMIT 1`, [s.section_id, key]);
    return `<div class="actions" style="margin-bottom:12px;justify-content:space-between"><a class="btn ghost sm" href="#/attendance">← All sessions</a>
        <div class="actions">${prev ? `<a class="btn sm" href="#/session/${prev.session_id}">‹ Previous</a>` : ''}${next ? `<a class="btn sm" href="#/session/${next.session_id}">Next ›</a>` : ''}</div></div>
      <div class="page-head"><div><h1>${esc(s.label)} · ${esc(s.course_title)}</h1><p>${esc(fmtDate(s.session_date))} · ${esc(s.start_time)}–${esc(s.end_time)} · ${esc(s.room || 'No room')} · ${esc(s.instructor || 'Unassigned')}${s.topic ? ' · ' + esc(s.topic) : ''}</p></div>
        <div class="actions">${isAdmin() ? `<button class="btn ghost danger" data-action="delete-session" data-id="${s.session_id}">Delete session</button>` : ''}</div></div>
      ${future ? `<div class="note" style="margin-bottom:14px">This session is scheduled for a future date. Attendance can be recorded on or after ${esc(fmtDate(s.session_date))}.</div>` : ''}
      <div class="grid two">
        <div class="card">
          <div class="card-head"><div><h2>Roster</h2><p>${roster.length} enrolled students</p></div>
            ${future ? '' : `<div class="actions"><button class="btn sm" data-action="mark-all" data-v="Present">Mark all present</button><button class="btn sm ghost" data-action="mark-all" data-v="">Clear</button></div>`}</div>
          <div class="roster">${roster.map((r) => `<div class="roster-row" data-sid="${r.student_id}">
              <span class="avatar">${esc(initials(r.name))}</span>
              <div><div style="font-weight:600">${esc(r.name)}</div><div class="muted mono" style="font-size:var(--text-xs)">${esc(r.student_no)}</div></div>
              <div class="seg-ctl">${STATUSES.map((st) => `<button type="button" class="${st} ${r.status === st ? 'on' : ''}" data-action="mark" data-sid="${r.student_id}" data-v="${st}" ${dis}>${st}</button>`).join('')}</div>
              <div class="extra"><input class="input mono" type="time" data-f="check" data-sid="${r.student_id}" value="${esc(r.check_in_time || '')}" title="Check-in time" aria-label="Check-in time for ${esc(r.name)}" style="max-width:130px" ${dis}>
                <input class="input" data-f="remarks" data-sid="${r.student_id}" value="${esc(r.remarks || '')}" placeholder="Remarks (optional)" aria-label="Remarks for ${esc(r.name)}" ${dis}></div>
            </div>`).join('') || '<div class="empty">No active students in this section.</div>'}</div>
          ${future || !roster.length ? '' : `<div class="sticky-foot"><span class="muted" id="mark-summary" style="font-size:var(--text-sm)"></span><button class="btn primary" data-action="save-attendance">Save attendance</button></div>`}
        </div>
        <div class="grid" style="align-content:start">
          <div class="card"><div class="card-head"><div><h2>Session summary</h2><p>Updates as you mark</p></div></div><div class="card-body" id="live-summary"></div></div>
          <div class="card"><div class="card-head"><div><h2>Change log</h2><p>Written by the <span class="mono">trg_attendance_audit</span> trigger</p></div></div>
            ${audit.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Change</th><th>When</th></tr></thead><tbody>${audit.map((a) => `<tr><td>${esc(a.name)}<span class="sub">by ${esc(a.username || 'system')}</span></td><td>${badge(a.old_status)} → ${badge(a.new_status)}</td><td class="muted" style="font-size:var(--text-xs)">${esc(fmtDT(a.changed_at))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No changes to recorded attendance yet.</div>'}
          </div>
        </div>
      </div>`;
  };
  function updateMarkSummary() {
    const ids = Object.keys(MARKS).filter((k) => k !== '_session');
    const t = { total: 0 }; STATUSES.forEach((s) => (t[s] = 0));
    ids.forEach((k) => { const st = MARKS[k].status; if (st) { t[st]++; t.total++; } });
    const unmarked = ids.length - t.total;
    const el = $('#mark-summary'); if (el) el.textContent = unmarked ? `${unmarked} of ${ids.length} students not yet marked` : `All ${ids.length} students marked`;
    const pct = t.total - t.Excused > 0 ? (((t.Present + t.Late) / (t.total - t.Excused)) * 100).toFixed(1) + '%' : '—';
    const box = $('#live-summary');
    if (box) box.innerHTML = `<div class="kpi" style="padding:0 0 12px"><div class="label">Attendance rate</div><div class="value">${pct}</div><div class="delta">${t.total} of ${ids.length} marked</div></div>${stackBar(t)}`;
  }
  AFTER.session = () => {
    $$('[data-f]').forEach((el) => el.addEventListener('input', () => { const m = MARKS[el.dataset.sid]; if (m) m[el.dataset.f] = el.value; }));
    updateMarkSummary();
  };
  function setMark(sid, v) {
    const m = MARKS[sid]; if (!m) return;
    const s = MARKS._session;
    m.status = v;
    if (v === 'Present' || v === 'Late') { if (!m.check) m.check = s.session_date === TODAY && v === 'Late' ? nowHm() : s.start_time; }
    else m.check = '';
    const row = $(`.roster-row[data-sid="${sid}"]`);
    if (row) {
      $$('.seg-ctl button', row).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      const c = $('[data-f="check"]', row); if (c) c.value = m.check;
    }
  }
  ACTIONS.mark = (el) => { setMark(el.dataset.sid, el.dataset.v); updateMarkSummary(); };
  ACTIONS['mark-all'] = (el) => { Object.keys(MARKS).filter((k) => k !== '_session').forEach((k) => { if (!el.dataset.v || !MARKS[k].status) setMark(k, el.dataset.v); }); updateMarkSummary(); };
  ACTIONS['save-attendance'] = () => {
    const s = MARKS._session;
    if (!s || !canManageSection(s.section_id)) throw new Error('You are not authorised to record attendance for this section.');
    if (s.session_date > TODAY) throw new Error('Attendance cannot be recorded for a future session.');
    let saved = 0, removed = 0;
    tx(() => {
      for (const [sid, m] of Object.entries(MARKS)) {
        if (sid === '_session') continue;
        if (m.status) {
          run(`INSERT INTO attendance_records (session_id, student_id, status, check_in_time, remarks, recorded_by, recorded_at)
               VALUES (?,?,?,?,?,?, datetime('now','localtime'))
               ON CONFLICT (session_id, student_id) DO UPDATE SET status = excluded.status, check_in_time = excluded.check_in_time,
                 remarks = excluded.remarks, recorded_by = excluded.recorded_by, updated_at = datetime('now','localtime')`,
            [s.session_id, Number(sid), m.status, m.check || null, m.remarks.trim() || null, ME.user_id]);
          saved++;
        } else if (m.existing) {
          run(`DELETE FROM attendance_records WHERE session_id = ? AND student_id = ?`, [s.session_id, Number(sid)]);
          removed++;
        }
      }
    });
    toast(`Attendance saved for ${saved} student${saved === 1 ? '' : 's'}${removed ? `, ${removed} cleared` : ''}.`);
    render();
  };
  ACTIONS['delete-session'] = (el) => confirmModal('Delete session?', 'This removes the class session and all attendance recorded for it. This cannot be undone.', () => {
    tx(() => run(`DELETE FROM class_sessions WHERE session_id = ?`, [el.dataset.id]));
    toast('Session deleted.'); setTimeout(() => go('attendance'), 0);
  });

  // ---------------------------------------------------------------- Reports
  const REPORT_TABS = [['history', 'Student history'], ['class', 'Class summary'], ['daily', 'Daily report'], ['course', 'Course statistics'], ['pct', 'Attendance %'], ['absence', 'Absence & lateness'], ['threshold', 'Below threshold']];
  const statusCols = [
    { k: 'present_count', label: 'Present', num: true }, { k: 'late_count', label: 'Late', num: true },
    { k: 'absent_count', label: 'Absent', num: true }, { k: 'excused_count', label: 'Excused', num: true },
  ];
  function termSelect() {
    const terms = q(`SELECT term_id, term_name FROM academic_terms ORDER BY start_date DESC`);
    const cur = state.rep.term || (currentTerm() || {}).term_id;
    state.rep.term = cur;
    return `<select class="input" data-action-change="rep-term" aria-label="Term">${terms.map((t) => opt(t.term_id, t.term_name, cur)).join('')}</select>`;
  }
  function reportBody(tab) {
    const scope = secScope();
    const T = Number(state.rep.term || (currentTerm() || {}).term_id || 0);
    let sql, rows, filters = '', extra = '', cols, name, href;

    if (tab === 'history') {
      const studs = q(`SELECT DISTINCT s.student_id, s.student_no, s.first_name || ' ' || s.last_name AS name FROM students s
        ${isInstructor() ? 'JOIN enrollments e ON e.student_id = s.student_id JOIN class_sections sec ON sec.section_id = e.section_id WHERE 1=1' + scope : ''} ORDER BY s.last_name, s.first_name`);
      const sid = Number(state.rep.student || (studs[0] || {}).student_id || 0);
      state.rep.student = sid;
      filters = `<select class="input" data-action-change="rep-student" aria-label="Student">${studs.map((s) => opt(s.student_id, `${s.name} (${s.student_no})`, sid)).join('')}</select>`;
      sql = `SELECT cs.session_date, c.course_code || '-' || sec.section_code AS section, c.course_title,
       cs.start_time, ar.status, ar.check_in_time, ar.remarks
FROM attendance_records ar
JOIN class_sessions cs  ON cs.session_id  = ar.session_id
JOIN class_sections sec ON sec.section_id = cs.section_id
JOIN courses c          ON c.course_id    = sec.course_id
WHERE ar.student_id = ${sid}${scope}
ORDER BY cs.session_date DESC, cs.start_time DESC;`;
      rows = q(sql);
      const sum = q(`SELECT v.* FROM v_student_section_attendance v JOIN class_sections sec ON sec.section_id = v.section_id WHERE v.student_id = ${sid}${scope} ORDER BY v.term_name DESC, v.course_code`);
      extra = `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Per-section summary</h2><p>From view <span class="mono">v_student_section_attendance</span></p></div>${sid ? `<a class="btn sm" href="#/student/${sid}">Open profile</a>` : ''}</div>
        ${table([{ k: 'course_code', label: 'Course', fmt: (v, r) => `${esc(v)}-${esc(r.section_code)}<span class="sub">${esc(r.course_title)}</span>` }, { k: 'term_name', label: 'Term' }, { k: 'sessions_recorded', label: 'Sessions', num: true }, ...statusCols, { k: 'attendance_pct', label: 'Attendance', num: true, fmt: pctCell }], sum)}</div>`;
      cols = [{ k: 'session_date', label: 'Date', fmt: (v) => esc(fmtDate(v)) }, { k: 'section', label: 'Class', fmt: (v, r) => `${esc(v)}<span class="sub">${esc(r.course_title)}</span>` }, { k: 'status', label: 'Status', fmt: badge }, { k: 'check_in_time', label: 'Check-in', fmt: (v) => `<span class="mono">${esc(v || '—')}</span>` }, { k: 'remarks', label: 'Remarks', fmt: (v) => `<span class="muted">${esc(v || '')}</span>` }];
      name = `student-history-${sid}.csv`;
    }

    if (tab === 'class') {
      const secs = sectionOptions('', state.rep.section);
      const sec = Number(state.rep.section || (secs.rows[0] || {}).section_id || 0);
      state.rep.section = sec;
      filters = `<select class="input" data-action-change="rep-section" aria-label="Section">${sectionOptions('', sec).html}</select>`;
      sql = `SELECT student_no, student_name, sessions_recorded, present_count, late_count,
       absent_count, excused_count, attendance_pct
FROM v_student_section_attendance
WHERE section_id = ${sec}
ORDER BY attendance_pct ASC, student_name;`;
      rows = canManageSection(sec) ? q(sql) : [];
      const sess = canManageSection(sec) ? q(`SELECT * FROM v_session_summary WHERE section_id = ${sec} AND recorded > 0 ORDER BY session_date DESC, start_time DESC`) : [];
      const t = statusTotals(`AND sec.section_id = ${sec}`);
      extra = `<div class="grid halves" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><div><h2>Class totals</h2><p>${num(t.total)} attendance records · ${t.pct != null ? t.pct + '% attendance' : 'no data'}</p></div></div><div class="card-body">${stackBar(t)}</div></div>
        <div class="card"><div class="card-head"><div><h2>Sessions held</h2><p>From view <span class="mono">v_session_summary</span></p></div></div><div class="table-wrap" style="max-height:220px;overflow:auto">
          ${table([{ k: 'session_date', label: 'Date', fmt: (v) => esc(fmtDate(v, { day: 'numeric', month: 'short' })) }, { k: 'recorded', label: 'Rec.', num: true }, ...statusCols], sess, { href: (r) => 'session/' + r.session_id })}</div></div></div>`;
      cols = [{ k: 'student_name', label: 'Student', fmt: (v, r) => `${esc(v)}<span class="sub mono">${esc(r.student_no)}</span>` }, { k: 'sessions_recorded', label: 'Sessions', num: true }, ...statusCols, { k: 'attendance_pct', label: 'Attendance', num: true, fmt: pctCell }];
      href = (r) => 'student/' + r.student_id;
      rows = rows.map((r) => r);
      name = `class-summary-${sec}.csv`;
      if (rows.length) rows = q(sql.replace('SELECT student_no', 'SELECT student_id, student_no'));
    }

    if (tab === 'daily') {
      const latest = val(`SELECT MAX(cs.session_date) FROM class_sessions cs JOIN class_sections sec ON sec.section_id = cs.section_id JOIN attendance_records ar ON ar.session_id = cs.session_id WHERE cs.session_date <= '${TODAY}'${scope}`) || TODAY;
      const d = state.rep.date || latest; state.rep.date = d;
      filters = `<input class="input" type="date" value="${esc(d)}" data-action-change="rep-date" aria-label="Date">`;
      sql = `SELECT v.course_code || '-' || v.section_code AS section, v.start_time, v.end_time, v.topic,
       v.enrolled, v.recorded, v.present_count, v.late_count, v.absent_count, v.excused_count
FROM v_session_summary v
JOIN class_sections sec ON sec.section_id = v.section_id
WHERE v.session_date = '${d.replace(/[^0-9-]/g, '')}'${scope}
ORDER BY v.start_time;`;
      rows = q(sql);
      const exc = q(`SELECT s.student_id, s.first_name || ' ' || s.last_name AS name, ${SECTION_LABEL} AS section, ar.status, ar.check_in_time, ar.remarks
        FROM attendance_records ar JOIN class_sessions cs ON cs.session_id = ar.session_id JOIN class_sections sec ON sec.section_id = cs.section_id JOIN courses c ON c.course_id = sec.course_id JOIN students s ON s.student_id = ar.student_id
        WHERE cs.session_date = ? AND ar.status <> 'Present'${scope} ORDER BY ar.status, s.last_name`, [d]);
      const t = statusTotals(`AND cs.session_date = ?${scope}`, [d]);
      extra = `<div class="grid halves" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><div><h2>${esc(fmtDate(d))}</h2><p>${rows.length} sessions · ${num(t.total)} records · ${t.pct != null ? t.pct + '% attendance' : 'no attendance recorded'}</p></div></div><div class="card-body">${stackBar(t)}</div></div>
        <div class="card"><div class="card-head"><div><h2>Exceptions</h2><p>Absent, late and excused students that day</p></div></div><div class="table-wrap" style="max-height:240px;overflow:auto">
          ${table([{ k: 'name', label: 'Student' }, { k: 'section', label: 'Class' }, { k: 'status', label: 'Status', fmt: badge }, { k: 'remarks', label: 'Remarks', fmt: (v) => `<span class="muted">${esc(v || '')}</span>` }], exc, { empty: 'No exceptions — everyone was present.', href: (r) => 'student/' + r.student_id })}</div></div></div>`;
      cols = [{ k: 'section', label: 'Class', fmt: (v, r) => `${esc(v)}<span class="sub">${esc(r.topic || '')}</span>` }, { k: 'start_time', label: 'Time', fmt: (v, r) => `<span class="mono">${esc(v)}–${esc(r.end_time)}</span>` }, { k: 'enrolled', label: 'Enrolled', num: true }, { k: 'recorded', label: 'Recorded', num: true }, ...statusCols];
      name = `daily-report-${d}.csv`;
    }

    if (tab === 'course') {
      filters = termSelect();
      sql = `SELECT c.course_code, c.course_title,
       COUNT(DISTINCT sec.section_id) AS sections,
       COUNT(DISTINCT cs.session_id)  AS sessions,
       COUNT(ar.attendance_id)        AS records,
       SUM(ar.status = 'Present') AS present_count, SUM(ar.status = 'Late') AS late_count,
       SUM(ar.status = 'Absent')  AS absent_count,  SUM(ar.status = 'Excused') AS excused_count,
       ROUND(100.0 * SUM(ar.status IN ('Present','Late'))
             / NULLIF(COUNT(ar.attendance_id) - SUM(ar.status = 'Excused'), 0), 1) AS attendance_pct
FROM courses c
JOIN class_sections sec         ON sec.course_id = c.course_id
LEFT JOIN class_sessions cs     ON cs.section_id = sec.section_id
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id
WHERE sec.term_id = ${T}${scope}
GROUP BY c.course_id
ORDER BY attendance_pct DESC;`;
      rows = q(sql);
      cols = [{ k: 'course_code', label: 'Course', fmt: (v, r) => `${esc(v)}<span class="sub">${esc(r.course_title)}</span>` }, { k: 'sections', label: 'Sections', num: true }, { k: 'sessions', label: 'Sessions', num: true }, { k: 'records', label: 'Records', num: true }, ...statusCols, { k: 'attendance_pct', label: 'Attendance', num: true, fmt: pctCell }];
      name = `course-statistics-${T}.csv`;
    }

    if (tab === 'pct') {
      filters = termSelect();
      sql = `SELECT v.student_id, v.student_no, v.student_name, v.course_code || '-' || v.section_code AS section,
       v.sessions_recorded, v.present_count, v.late_count, v.absent_count, v.excused_count, v.attendance_pct
FROM v_student_section_attendance v
JOIN class_sections sec ON sec.section_id = v.section_id
WHERE sec.term_id = ${T}${scope}
ORDER BY v.attendance_pct ASC, v.student_name;`;
      rows = q(sql);
      extra = `<div class="note" style="margin-bottom:14px">Attendance % = (Present + Late) ÷ (Sessions recorded − Excused) × 100. Excused absences do not count against a student.</div>`;
      cols = [{ k: 'student_name', label: 'Student', fmt: (v, r) => `${esc(v)}<span class="sub mono">${esc(r.student_no)}</span>` }, { k: 'section', label: 'Class' }, { k: 'sessions_recorded', label: 'Sessions', num: true }, ...statusCols, { k: 'attendance_pct', label: 'Attendance', num: true, fmt: pctCell }];
      href = (r) => 'student/' + r.student_id;
      name = `attendance-percentages-${T}.csv`;
    }

    if (tab === 'absence') {
      filters = termSelect();
      sql = `SELECT s.student_id, s.student_no, s.first_name || ' ' || s.last_name AS student_name,
       COUNT(ar.attendance_id)      AS records,
       SUM(ar.status = 'Absent')    AS absent_count,
       SUM(ar.status = 'Late')      AS late_count,
       SUM(ar.status = 'Excused')   AS excused_count,
       MAX(CASE WHEN ar.status = 'Absent' THEN cs.session_date END) AS last_absence
FROM attendance_records ar
JOIN students s         ON s.student_id   = ar.student_id
JOIN class_sessions cs  ON cs.session_id  = ar.session_id
JOIN class_sections sec ON sec.section_id = cs.section_id
WHERE sec.term_id = ${T}${scope}
GROUP BY s.student_id
HAVING SUM(ar.status IN ('Absent','Late')) > 0
ORDER BY absent_count DESC, late_count DESC;`;
      rows = q(sql);
      cols = [{ k: 'student_name', label: 'Student', fmt: (v, r) => `${esc(v)}<span class="sub mono">${esc(r.student_no)}</span>` }, { k: 'records', label: 'Records', num: true }, { k: 'absent_count', label: 'Absences', num: true, fmt: (v) => `<span style="color:var(--absent);font-weight:600">${num(v)}</span>` }, { k: 'late_count', label: 'Lates', num: true, fmt: (v) => `<span style="color:var(--late);font-weight:600">${num(v)}</span>` }, { k: 'excused_count', label: 'Excused', num: true }, { k: 'last_absence', label: 'Last absence', fmt: (v) => esc(v ? fmtDate(v) : '—') }];
      href = (r) => 'student/' + r.student_id;
      name = `absence-lateness-${T}.csv`;
    }

    if (tab === 'threshold') {
      filters = termSelect() + (isAdmin() ? `<span class="muted" style="font-size:var(--text-sm)">Threshold</span><input class="input" type="number" min="1" max="100" value="${threshold()}" id="thr" style="min-width:0;width:84px"><button class="btn sm" data-action="save-threshold">Update</button>` : `<span class="muted" style="font-size:var(--text-sm)">Threshold: ${threshold()}%</span>`);
      sql = `SELECT v.student_id, v.student_no, v.student_name, v.course_code || '-' || v.section_code AS section,
       v.sessions_recorded, v.absent_count, v.late_count, v.attendance_pct
FROM v_low_attendance v                      -- view filters by system_settings.attendance_threshold
JOIN class_sections sec ON sec.section_id = v.section_id
WHERE sec.term_id = ${T}${scope}
ORDER BY v.attendance_pct ASC;`;
      rows = q(sql);
      cols = [{ k: 'student_name', label: 'Student', fmt: (v, r) => `${esc(v)}<span class="sub mono">${esc(r.student_no)}</span>` }, { k: 'section', label: 'Class' }, { k: 'sessions_recorded', label: 'Sessions', num: true }, { k: 'absent_count', label: 'Absent', num: true }, { k: 'late_count', label: 'Late', num: true }, { k: 'attendance_pct', label: 'Attendance', num: true, fmt: pctCell }];
      href = (r) => 'student/' + r.student_id;
      name = `below-threshold-${T}.csv`;
    }

    state.lastExport = { name, rows: rows.map((r) => { const o = { ...r }; delete o.student_id; return o; }) };
    return `<div class="toolbar">${filters}<span class="muted" style="font-size:var(--text-sm)">${rows.length} rows</span><span style="flex:1"></span><button class="btn sm" data-action="export-csv">${ICON.dl}Export CSV</button></div>
      ${extra}<div class="card">${table(cols, rows, { href, empty: 'No data for this selection.' })}</div>${sqlBlock(sql)}`;
  }
  PAGES.reports = () => {
    const tab = REPORT_TABS.some(([k]) => k === state.reportTab) ? state.reportTab : 'history';
    return `<div class="page-head"><div><h1>Attendance reports</h1><p>${isInstructor() ? 'Reports cover the class sections you teach.' : 'Every report is a SQL query over the attendance database — expand “Show SQL” to see it.'}</p></div></div>
      <div class="tabs" role="tablist">${REPORT_TABS.map(([k, l]) => `<button type="button" role="tab" class="${tab === k ? 'on' : ''}" data-action="rep-tab" data-v="${k}">${l}</button>`).join('')}</div>
      ${reportBody(tab)}`;
  };
  AFTER.reports = () => {
    bindChange('rep-student', (v) => { state.rep.student = v; render(); });
    bindChange('rep-section', (v) => { state.rep.section = v; render(); });
    bindChange('rep-date', (v) => { state.rep.date = v; render(); });
    bindChange('rep-term', (v) => { state.rep.term = v; render(); });
  };
  ACTIONS['rep-tab'] = (el) => { state.reportTab = el.dataset.v; render(); };
  ACTIONS['save-threshold'] = () => {
    const v = Number($('#thr').value);
    if (!(v >= 1 && v <= 100)) throw new Error('Threshold must be between 1 and 100.');
    tx(() => run(`UPDATE system_settings SET setting_value = ? WHERE setting_key = 'attendance_threshold'`, [String(v)]));
    toast(`Attendance threshold set to ${v}%.`); render();
  };

  // ---------------------------------------------------------------- Schema
  PAGES.schema = () => {
    const tables = q(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid`);
    const objs = q(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('view','trigger','index') AND sql IS NOT NULL ORDER BY type, name`);
    const cards = tables.map(({ name }) => {
      const cols = q(`PRAGMA table_info(${name})`);
      const fks = q(`PRAGMA foreign_key_list(${name})`);
      const fkMap = {}; fks.forEach((f) => (fkMap[f.from] = `${f.table}.${f.to}`));
      const count = val(`SELECT COUNT(*) FROM ${name}`);
      return `<div class="card schema-card"><div class="card-head"><h3>${esc(name)}</h3><span class="badge">${count} rows</span></div><ul>${cols.map((c) => `<li><span>${c.pk ? '<span class="pk">PK</span> ' : ''}${fkMap[c.name] ? '<span class="fk">FK</span> ' : ''}${esc(c.name)}${c.notnull && !c.pk ? '' : ''}</span><span class="t">${esc(c.type)}${fkMap[c.name] ? ' → ' + esc(fkMap[c.name]) : ''}</span></li>`).join('')}</ul></div>`;
    }).join('');
    const group = (type, title, sub) => {
      const list = objs.filter((o) => o.type === type);
      return `<div class="card" style="margin-top:16px"><div class="card-head"><div><h2>${title} <span class="muted" style="font-weight:400">(${list.length})</span></h2><p>${sub}</p></div></div><div class="card-body">${list.map((o) => `<details class="sql"><summary><span class="mono" style="color:var(--text)">${esc(o.name)}</span> <span class="faint">on ${esc(o.tbl_name)}</span></summary><pre class="sql-box">${esc(o.sql)}</pre></details>`).join('')}</div></div>`;
    };
    return `<div class="page-head"><div><h1>Relational schema</h1><p>${tables.length} tables normalized to 3NF, with primary/foreign keys, UNIQUE and CHECK constraints, indexes, views and triggers. Read live from the database catalogue.</p></div>
        <div class="actions"><a class="btn" href="https://github.com/marrahsaioalusine-arch/attendance-tracking-system/blob/main/docs/ERD.md" target="_blank" rel="noopener">View ERD</a><a class="btn primary" href="#/sql">Open SQL console</a></div></div>
      <div class="schema-grid">${cards}</div>
      ${group('view', 'Views', 'Reusable reporting queries')}
      ${group('trigger', 'Triggers', 'Business rules enforced inside the database')}
      ${group('index', 'Indexes', 'Speed up the most common lookups and joins')}`;
  };

  // ---------------------------------------------------------------- SQL console
  const SAMPLES = [
    ['Students below threshold', `SELECT student_name, course_code, attendance_pct\nFROM v_low_attendance\nORDER BY attendance_pct;`],
    ['Attendance by weekday', `SELECT CASE strftime('%w', cs.session_date)\n         WHEN '1' THEN 'Mon' WHEN '2' THEN 'Tue' WHEN '3' THEN 'Wed'\n         WHEN '4' THEN 'Thu' WHEN '5' THEN 'Fri' END AS weekday,\n       COUNT(*) AS records,\n       ROUND(100.0 * SUM(ar.status IN ('Present','Late')) / COUNT(*), 1) AS attended_pct\nFROM attendance_records ar\nJOIN class_sessions cs ON cs.session_id = ar.session_id\nGROUP BY strftime('%w', cs.session_date)\nORDER BY strftime('%w', cs.session_date);`],
    ['Instructor workload', `SELECT i.first_name || ' ' || i.last_name AS instructor,\n       COUNT(DISTINCT sec.section_id) AS sections,\n       COUNT(DISTINCT e.student_id)   AS students\nFROM instructors i\nLEFT JOIN class_sections sec ON sec.instructor_id = i.instructor_id\nLEFT JOIN enrollments e      ON e.section_id = sec.section_id AND e.status = 'Active'\nGROUP BY i.instructor_id\nORDER BY students DESC;`],
    ['Section capacity usage', `SELECT c.course_code || '-' || sec.section_code AS section,\n       COUNT(e.enrollment_id) AS enrolled, sec.max_capacity,\n       ROUND(100.0 * COUNT(e.enrollment_id) / sec.max_capacity, 1) AS fill_pct\nFROM class_sections sec\nJOIN courses c ON c.course_id = sec.course_id\nLEFT JOIN enrollments e ON e.section_id = sec.section_id AND e.status = 'Active'\nGROUP BY sec.section_id;`],
    ['Test: duplicate enrollment (fails)', `-- UNIQUE (student_id, section_id) blocks duplicates\nINSERT INTO enrollments (student_id, section_id) VALUES (1, 1);`],
    ['Test: invalid status (fails)', `-- CHECK constraint only allows Present / Absent / Late / Excused\nUPDATE attendance_records SET status = 'Sleeping' WHERE attendance_id = 1;`],
    ['Audit trail', `SELECT * FROM attendance_audit ORDER BY changed_at DESC LIMIT 20;`],
  ];
  PAGES.sql = () => `<div class="page-head"><div><h1>SQL console</h1><p>Run SQL directly against the live database. Write statements are saved. Press Ctrl + Enter to run.</p></div>
      <div class="actions"><select class="input" data-action-change="sql-sample" aria-label="Sample queries" style="min-width:240px"><option value="">Sample queries…</option>${SAMPLES.map((s, i) => opt(i, s[0])).join('')}</select></div></div>
    <div class="card console"><div class="card-body"><textarea class="input" id="sql-in" spellcheck="false" aria-label="SQL">${esc(state.sql || SAMPLES[0][1])}</textarea>
      <div class="actions" style="margin-top:10px;justify-content:space-between"><span class="faint" style="font-size:var(--text-xs)">SQLite dialect · foreign keys ON</span><button class="btn primary" data-action="run-sql">Run query</button></div></div></div>
    <div id="sql-out" style="margin-top:16px">${state.sqlOut || ''}</div>`;
  AFTER.sql = () => {
    const ta = $('#sql-in');
    ta.addEventListener('input', () => (state.sql = ta.value));
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ACTIONS['run-sql'](); } });
    bindChange('sql-sample', (v) => { if (v === '') return; state.sql = SAMPLES[v][1]; ta.value = state.sql; });
  };
  ACTIONS['run-sql'] = () => {
    const sqlText = $('#sql-in').value; state.sql = sqlText;
    let out;
    try {
      const t0 = performance.now();
      const res = db.exec(sqlText);
      const changed = db.getRowsModified();
      const ms = (performance.now() - t0).toFixed(1);
      if (!/^\s*(--[^\n]*\n\s*)*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sqlText)) persist();
      out = res.length ? res.map((r) => `<div class="card" style="margin-bottom:14px"><div class="card-head"><p>${r.values.length} row${r.values.length === 1 ? '' : 's'} · ${ms} ms</p></div><div class="table-wrap" style="max-height:480px;overflow:auto"><table><thead><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.values.slice(0, 500).map((row) => `<tr>${row.map((v) => `<td class="${typeof v === 'number' ? 'num' : ''}">${v === null ? '<span class="faint">NULL</span>' : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('')
        : `<div class="note">Statement executed in ${ms} ms. ${changed} row${changed === 1 ? '' : 's'} affected.</div>`;
    } catch (e) {
      out = `<div class="note" style="border-color:var(--danger);color:var(--danger)">Error: ${esc(e.message)}</div>`;
    }
    state.sqlOut = out; $('#sql-out').innerHTML = out;
  };

  // ---------------------------------------------------------------- Settings
  PAGES.settings = () => `<div class="page-head"><div><h1>Settings</h1><p>System configuration and database maintenance.</p></div></div>
    <div class="grid halves">
      <form class="card" id="settings-form"><div class="card-head"><h2>System settings</h2></div><div class="card-body grid" style="gap:14px">
        ${field('Institution name', inp('institution_name', setting('institution_name') || ''))}
        ${field('Attendance threshold (%)', inp('threshold', threshold(), 'type="number" min="1" max="100"'))}
        <p class="faint" style="font-size:var(--text-xs)">Students whose attendance falls below the threshold appear in the “Below threshold” report and on dashboards.</p>
        <div><button class="btn primary" type="submit">Save settings</button></div></div></form>
      <div class="card"><div class="card-head"><h2>Database</h2></div><div class="card-body grid" style="gap:14px">
        <p class="muted" style="font-size:var(--text-sm)">The database is stored in this browser. Export it as a SQLite file to back it up or open it in DB Browser for SQLite, DBeaver or the sqlite3 CLI.</p>
        <div class="actions"><button class="btn" data-action="export-db">${ICON.dl}Export .sqlite</button><label class="btn" style="cursor:pointer">Import .sqlite<input type="file" accept=".sqlite,.db,.sqlite3" id="import-db" hidden></label></div>
        <div style="border-top:1px solid var(--border);padding-top:14px"><p class="muted" style="font-size:var(--text-sm);margin-bottom:10px">Reset all data back to the original sample dataset.</p><button class="btn danger" data-action="reset-db">Reset sample data</button></div>
      </div></div>
    </div>`;
  AFTER.settings = () => {
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      const v = Number(d.threshold);
      if (!(v >= 1 && v <= 100)) return toast('Threshold must be between 1 and 100.', 'err');
      tx(() => {
        run(`INSERT INTO system_settings VALUES ('attendance_threshold', ?) ON CONFLICT (setting_key) DO UPDATE SET setting_value = excluded.setting_value`, [String(v)]);
        run(`INSERT INTO system_settings VALUES ('institution_name', ?) ON CONFLICT (setting_key) DO UPDATE SET setting_value = excluded.setting_value`, [d.institution_name.trim() || 'Riverside University']);
      });
      toast('Settings saved.'); render();
    });
    $('#import-db').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const next = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
        next.exec('SELECT user_id, username, role FROM users LIMIT 1; SELECT 1 FROM attendance_records LIMIT 1;');
        db.close(); db = next; db.exec('PRAGMA foreign_keys = ON'); persist();
        toast('Database imported.'); ME = loadMe(ME.user_id); if (!ME) logout(); else render();
      } catch (err) { toast('That file is not a valid Rollcall database.', 'err'); }
    });
  };
  ACTIONS['export-db'] = () => { const data = db.export(); db.exec('PRAGMA foreign_keys = ON'); download(`rollcall-${TODAY}.sqlite`, new Blob([data], { type: 'application/x-sqlite3' })); };
  ACTIONS['reset-db'] = () => confirmModal('Reset sample data?', 'All changes will be replaced with the original sample dataset. You will be signed out.', () => {
    freshDb(); ME = null; store.del(SESSION_KEY, true); setTimeout(() => { location.hash = '#/login'; render(); }, 0);
  }, 'Reset');

  // =====================================================================
  // Boot
  // =====================================================================
  try {
    await initDb();
    const sid = store.get(SESSION_KEY, true);
    if (sid) ME = loadMe(Number(sid));
    render();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="boot"><p>Could not start the database: ${esc(e.message)}</p><p class="faint">Open this site over http(s) — for local use run <span class="mono">python -m http.server</span> in the project folder.</p></div>`;
  }
})();
