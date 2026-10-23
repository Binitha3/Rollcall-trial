import QRCode from 'qrcode';
import './style.css';

const STORAGE_KEY = 'rollcall-demo-state';
const CODE_INTERVAL = 30_000;

const courses = [
  { id: 'cs204', name: 'Data Structures', code: 'CS 204', room: 'Room 302', time: '10:30 AM' },
  { id: 'ma102', name: 'Applied Mathematics', code: 'MA 102', room: 'Room 108', time: '12:00 PM' },
  { id: 'ec110', name: 'Digital Electronics', code: 'EC 110', room: 'Lab 2', time: '2:00 PM' },
];

const students = [
  { id: 'AIML2401', name: 'Aarav Mehta', initials: 'AM', color: 'lavender', attended: 36, missed: 4 },
  { id: 'AIML2402', name: 'Ananya Rao', initials: 'AR', color: 'peach', attended: 28, missed: 12 },
  { id: 'AIML2403', name: 'Dev Patel', initials: 'DP', color: 'mint', attended: 25, missed: 15 },
  { id: 'AIML2404', name: 'Isha Nair', initials: 'IN', color: 'blue', attended: 30, missed: 10 },
];

const attendanceThreshold = 75;
const timetable = [
  { time: '9:00 – 10:00', monday: 'Mathematics for AI', tuesday: 'Python Programming', wednesday: 'Data Structures', thursday: 'Mathematics for AI', friday: 'Machine Learning' },
  { time: '10:00 – 11:00', monday: 'Python Programming', tuesday: 'Data Structures', wednesday: 'Machine Learning', thursday: 'Python Programming', friday: 'Data Structures' },
  { time: '11:00 – 11:15', break: 'Short break' },
  { time: '11:15 – 12:15', monday: 'Data Structures', tuesday: 'Mathematics for AI', wednesday: 'Python Programming', thursday: 'Machine Learning', friday: 'Mathematics for AI' },
  { time: '12:15 – 1:15', monday: 'Machine Learning', tuesday: 'AI Lab', wednesday: 'Database Systems', thursday: 'Data Structures', friday: 'AI Lab' },
  { time: '1:15 – 2:00', break: 'Lunch break' },
  { time: '2:00 – 3:00', monday: 'AI Lab', tuesday: 'Database Systems', wednesday: 'Mathematics for AI', thursday: 'AI Lab', friday: 'Database Systems' },
  { time: '3:00 – 4:00', monday: 'Database Systems', tuesday: 'Machine Learning', wednesday: 'AI Lab', thursday: 'Database Systems', friday: 'Project / Tutorial' },
];

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createSession(seedDemoAttendance = false) {
  const now = Date.now();
  return {
    id: `sess-${now}`,
    courseId: courses[0].id,
    startedAt: now,
    code: randomCode(),
    codeExpiresAt: now + CODE_INTERVAL,
    attendance: seedDemoAttendance ? {
      ST2401: { status: 'verified', checkedInAt: now - 5 * 60_000 },
      ST2402: { status: 'pending', checkedInAt: now - 4 * 60_000 },
      ST2403: { status: 'verified', checkedInAt: now - 3 * 60_000 },
      ST2404: { status: 'pending', checkedInAt: now - 2 * 60_000 },
      ST2405: { status: 'verified', checkedInAt: now - 60_000 },
      ST2406: { status: 'pending', checkedInAt: now - 30_000 },
      ST2407: { status: 'absent' },
      ST2408: { status: 'absent' },
    } : {},
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && ['faculty', 'student'].includes(saved.role)) {
      const previousStudentIds = ['ST2401', 'ST2402', 'ST2403', 'ST2404'];
      if (saved.activeSession?.attendance) {
        previousStudentIds.forEach((previousId, index) => {
          const student = students[index];
          if (!saved.activeSession.attendance[student.id] && saved.activeSession.attendance[previousId]) {
            saved.activeSession.attendance[student.id] = saved.activeSession.attendance[previousId];
          }
          delete saved.activeSession.attendance[previousId];
        });
      }
      return {
        ...saved,
        view: ['overview', 'timetable', 'attendance', 'notifications'].includes(saved.view) ? saved.view : 'overview',
        selectedStudentId: students.some((student) => student.id === saved.selectedStudentId)
          ? saved.selectedStudentId
          : students[0].id,
      };
    }
  } catch (error) {
    console.warn('Could not read the saved demo session.', error);
  }
  return { role: 'faculty', view: 'overview', activeSession: createSession(true), selectedStudentId: students[0].id };
}

const state = loadState();
let cameraStream = null;
let countdownTimer = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function icon(name, size = 18) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7-.1.1a7.7 7.7 0 0 1-1.7 1l-.2 1.8h-2.8l-.2-1.8a7.7 7.7 0 0 1-1.7-1l-1.8.7-1.4-2.4 1.5-1.1a7 7 0 0 1 0-2l-1.5-1.1 1.4-2.4 1.8.7a7.7 7.7 0 0 1 1.7-1l.2-1.8h2.8l.2 1.8a7.7 7.7 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    camera: '<path d="M14 5h-4l-2 2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function activeCourse() {
  return courses.find((course) => course.id === state.activeSession?.courseId);
}

function getCounts() {
  const attendance = state.activeSession?.attendance ?? {};
  const verified = Object.values(attendance).filter((entry) => entry.status === 'verified').length;
  const pending = Object.values(attendance).filter((entry) => entry.status === 'pending').length;
  return { verified, pending, total: students.length };
}

function getAttendanceSummary(student) {
  const total = student.attended + student.missed;
  const percentage = total ? student.attended / total * 100 : 0;
  const classesToAttend = percentage < attendanceThreshold
    ? Math.ceil((attendanceThreshold / 100 * total - student.attended) / (1 - attendanceThreshold / 100))
    : 0;
  return { total, percentage, classesToAttend };
}

function getLowAttendanceStudents() {
  return students.filter((student) => getAttendanceSummary(student).percentage < attendanceThreshold);
}

function renderSidebar() {
  const selectedStudent = students.find((student) => student.id === state.selectedStudentId) ?? students[0];
  const lowAttendanceCount = state.role === 'student'
    ? Number(getAttendanceSummary(selectedStudent).percentage < attendanceThreshold)
    : getLowAttendanceStudents().length;
  const navItems = [
    { view: 'overview', label: 'Overview', icon: 'grid' },
    { view: 'timetable', label: 'Timetable', icon: 'book' },
    { view: 'attendance', label: 'Attendance', icon: 'check' },
    { view: 'notifications', label: 'Notifications', icon: 'bell', count: lowAttendanceCount },
  ];
  return `
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="Rollcall home">
        <span class="brand-mark">${icon('check', 19)}</span>
        <span>rollcall<span class="brand-period">.</span></span>
      </a>
      <div class="nav-label">WORKSPACE</div>
      <nav class="side-nav" aria-label="Main navigation">
        ${navItems.map((item) => `<button class="nav-link ${state.view === item.view ? 'active' : ''}" type="button" data-action="navigate" data-view="${item.view}">${icon(item.icon)}<span>${item.label}</span>${item.count ? `<span class="nav-count">${item.count}</span>` : ''}</button>`).join('')}
      </nav>
      <div class="sidebar-bottom">
        <div class="semester-card">
          <span class="semester-icon">${icon('book', 16)}</span>
          <span><strong>Fall semester</strong><small>Academic year 2026</small></span>
          <span class="semester-dot"></span>
        </div>
        <button class="nav-link settings-link" type="button">${icon('settings')}<span>Settings</span></button>
        <div class="profile">
          <span class="avatar avatar-faculty">AR</span>
          <span class="profile-copy"><strong>Alex Rivera</strong><small>Faculty</small></span>
          <button class="icon-button profile-menu" type="button" aria-label="Profile options">···</button>
        </div>
      </div>
    </aside>`;
}

function renderHeader() {
  const selectedStudentId = state.selectedStudentId;
  return `
    <header class="topbar">
      <div class="breadcrumb">Workspace <span>/</span> <strong>${state.view === 'overview' ? (state.role === 'faculty' ? 'Overview' : 'Student check-in') : state.view[0].toUpperCase() + state.view.slice(1)}</strong></div>
      <div class="topbar-actions">
        <span class="today-label">${new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
        <span class="topbar-divider"></span>
        <button class="role-switch" type="button" data-action="switch-role">
          <span class="role-switch-icon">${icon(state.role === 'faculty' ? 'users' : 'book', 15)}</span>
          <span>View as ${state.role === 'faculty' ? 'student' : 'faculty'}</span>
          ${icon('arrow', 15)}
        </button>
        ${state.role === 'student' ? `<select class="profile-student-select" id="student-profile-select" aria-label="Select simulated student">${students.map((student) => `<option value="${student.id}" ${student.id === selectedStudentId ? 'selected' : ''}>${escapeHtml(student.name)}</option>`).join('')}</select>` : ''}
        <span class="avatar avatar-faculty top-avatar">AR</span>
      </div>
    </header>`;
}

function renderFaculty() {
  const session = state.activeSession;
  const course = activeCourse();
  const counts = getCounts();
  const pending = students.filter((student) => session?.attendance[student.id]?.status === 'pending');
  const verified = students.filter((student) => session?.attendance[student.id]?.status === 'verified');
  if (state.view === 'timetable') return renderTimetablePage();
  if (state.view === 'attendance') return renderFacultyAttendance();
  if (state.view === 'notifications') return renderNotificationsPage();

  return `
    <main class="main-content">
      <section class="welcome-row">
        <div>
          <p class="eyebrow">THURSDAY, OCTOBER 22, 2026</p>
          <h1>Good morning, Alex <span class="wave">✳</span></h1>
          <p class="welcome-subtitle">Here's what's happening with your classes today.</p>
        </div>
        <button class="button button-dark" type="button" data-action="${session ? 'end-session' : 'start-session'}">
          ${session ? '<span class="live-dot"></span> End session' : `${icon('check', 16)} Start attendance`}
        </button>
      </section>

      <section class="stats-grid" aria-label="Attendance overview">
        <article class="stat-card">
          <div class="stat-heading"><span>Present today</span><span class="stat-icon icon-mint">${icon('check', 17)}</span></div>
          <div class="stat-value">${counts.verified}<span class="stat-total"> / ${counts.total}</span></div>
          <div class="stat-foot"><span class="trend-up">↗ ${Math.round(counts.verified / counts.total * 100)}%</span><span>of this class verified present</span></div>
        </article>
        <article class="stat-card">
          <div class="stat-heading"><span>Needs verification</span><span class="stat-icon icon-amber">${icon('clock', 17)}</span></div>
          <div class="stat-value">${counts.pending.toString().padStart(2, '0')}</div>
          <div class="stat-foot"><span>Quick review</span><span>before marking present</span></div>
        </article>
        <article class="stat-card stat-card-accent">
          <div class="stat-heading"><span>Next class</span><span class="stat-icon icon-blue">${icon('book', 17)}</span></div>
          <div class="stat-value stat-next">${courses[1].time}</div>
          <div class="stat-foot"><strong>${courses[1].name}</strong><span>${courses[1].code} · ${courses[1].room}</span></div>
        </article>
      </section>

      <div class="section-heading">
        <div><h2>Live attendance</h2><p>Keep check-in quick, then verify students in the room.</p></div>
        ${session ? '<span class="live-pill"><span class="live-dot"></span> SESSION LIVE</span>' : ''}
      </div>

      ${session ? `
        <section class="live-grid">
          <article class="session-card">
            <div class="session-card-top">
              <div>
                <span class="course-chip">${escapeHtml(course.code)}</span>
                <h3>${escapeHtml(course.name)}</h3>
                <p>${escapeHtml(course.room)} <span class="bullet">·</span> Started ${formatTime(session.startedAt)}</p>
              </div>
              <button class="icon-button more-button" type="button" aria-label="More session options">···</button>
            </div>
            <div class="session-divider"></div>
            <div class="qr-layout">
              <div class="qr-frame"><img id="session-qr" alt="Rotating attendance QR code" /><span class="qr-corner qr-corner-tl"></span><span class="qr-corner qr-corner-tr"></span><span class="qr-corner qr-corner-bl"></span><span class="qr-corner qr-corner-br"></span></div>
              <div class="qr-info">
                <span class="qr-overline">STUDENT CHECK-IN</span>
                <strong>Scan to check in</strong>
                <p>Show this code to your class. It refreshes every 30 seconds.</p>
                <div class="code-row"><span class="code-label">BACKUP CODE</span><strong class="one-time-code">${escapeHtml(session.code)}</strong></div>
                <span class="countdown"><span class="countdown-dot"></span> New code in <strong id="countdown">30s</strong></span>
              </div>
            </div>
            <div class="session-note">${icon('shield', 15)}<span>Only enrolled students can check in. You verify each student before attendance is finalized.</span></div>
          </article>

          <article class="review-card">
            <div class="review-header">
              <div><span class="card-kicker">QUICK REVIEW</span><h3>Verify check-ins</h3></div>
              <span class="pending-badge">${counts.pending} pending</span>
            </div>
            <p class="review-help">Confirm students are in the room before marking them present.</p>
            <div class="review-list">
              ${pending.length ? pending.map((student) => renderStudentRow(student, 'pending')).join('') : '<div class="empty-review"><span class="empty-check">✓</span><strong>All caught up</strong><span>No check-ins need review.</span></div>'}
            </div>
            <div class="review-footer"><span>${verified.length} of ${students.length} students verified</span><span class="mini-progress"><i style="width:${verified.length / students.length * 100}%"></i></span></div>
          </article>
        </section>

        <section class="roster-section" id="attendance">
          <div class="roster-heading"><div><h2>Class roster</h2><p>Today's attendance · ${escapeHtml(course.code)}</p></div><button type="button" class="button button-light" data-action="download-csv">Export list ${icon('arrow', 15)}</button></div>
          <div class="roster-table">
            <div class="roster-table-head"><span>STUDENT</span><span>STUDENT ID</span><span>CHECK-IN</span><span>STATUS</span></div>
            ${students.map((student) => renderRosterRow(student, session.attendance[student.id])).join('')}
          </div>
        </section>
      ` : renderNoSession()}
      <p class="demo-disclaimer">Demo mode · Attendance is stored in this browser only. Use campus sign-in and a secure server before real use.</p>
    </main>`;
}

function renderTimetablePage() {
  return `
    <main class="main-content">
      <section class="welcome-row">
        <div><p class="eyebrow">AIML · WEEKDAY SCHEDULE</p><h1>Class timetable</h1><p class="welcome-subtitle">A sample Monday–Friday schedule, 9:00 AM to 4:00 PM.</p></div>
        <span class="timetable-total">${icon('clock', 16)} 6 class hours / day</span>
      </section>
      <section class="timetable-card">
        <div class="timetable-heading"><div><h2>Artificial Intelligence &amp; Machine Learning</h2><p>Sample timetable · Adjust course rooms and faculty to match your college.</p></div></div>
        <div class="timetable-scroll">
          <table class="timetable-table">
            <thead><tr><th>TIME</th><th>MONDAY</th><th>TUESDAY</th><th>WEDNESDAY</th><th>THURSDAY</th><th>FRIDAY</th></tr></thead>
            <tbody>${timetable.map((row) => row.break
              ? `<tr class="break-row"><th>${row.time}</th><td colspan="5">${row.break}</td></tr>`
              : `<tr><th>${row.time}</th>${['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => `<td>${escapeHtml(row[day])}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="timetable-footnote">Breaks: 11:00–11:15 AM · Lunch: 1:15–2:00 PM</p>
      </section>
      <p class="demo-disclaimer">Sample schedule for planning purposes; confirm the final timetable with your department.</p>
    </main>`;
}

function renderAttendanceRow(student) {
  const summary = getAttendanceSummary(student);
  const stateLabel = summary.percentage < attendanceThreshold ? 'Low attendance' : summary.percentage === attendanceThreshold ? 'At threshold' : 'On track';
  return `
    <div class="attendance-row">
      <span class="roster-person"><span class="avatar avatar-${student.color}">${student.initials}</span><strong>${escapeHtml(student.name)}</strong></span>
      <span class="roster-id">${student.attended}</span>
      <span class="roster-id">${student.missed}</span>
      <span class="attendance-percent"><strong>${summary.percentage.toFixed(1)}%</strong><i><b class="${summary.percentage < attendanceThreshold ? 'progress-low' : ''}" style="width:${Math.min(summary.percentage, 100)}%"></b></i></span>
      <span><span class="status-pill ${summary.percentage < attendanceThreshold ? 'status-pending' : summary.percentage === attendanceThreshold ? 'status-absent' : 'status-verified'}"><i></i>${stateLabel}</span></span>
    </div>`;
}

function renderAttendanceAlert(student, compact = false) {
  const summary = getAttendanceSummary(student);
  if (summary.percentage >= attendanceThreshold) return '';
  return `
    <article class="attendance-alert ${compact ? 'alert-compact' : ''}">
      <span class="alert-icon">${icon('bell', 17)}</span>
      <div class="alert-copy">
        <strong>Low attendance · ${escapeHtml(student.name)} (${summary.percentage.toFixed(1)}%)</strong>
        <p>${escapeHtml(student.name)} has attended ${student.attended} of ${summary.total} classes and missed ${student.missed}. Attend the next <b>${summary.classesToAttend} consecutive classes</b> to reach 75%.</p>
      </div>
    </article>`;
}

function renderFacultyAttendance() {
  const lowAttendanceStudents = getLowAttendanceStudents();
  return `
    <main class="main-content">
      <section class="welcome-row"><div><p class="eyebrow">AIML · ATTENDANCE OVERVIEW</p><h1>Attendance &amp; alerts</h1><p class="welcome-subtitle">Attendance totals across 40 sample classes, with a 75% minimum target.</p></div></section>
      <section class="attendance-summary-grid">
        <article class="stat-card"><div class="stat-heading"><span>Students tracked</span><span class="stat-icon icon-blue">${icon('users', 17)}</span></div><div class="stat-value">${students.length}</div><div class="stat-foot"><span>Simulated AIML student records</span></div></article>
        <article class="stat-card"><div class="stat-heading"><span>Below 75%</span><span class="stat-icon icon-amber">${icon('bell', 17)}</span></div><div class="stat-value">${lowAttendanceStudents.length}</div><div class="stat-foot"><span>Students need an attendance alert</span></div></article>
        <article class="stat-card"><div class="stat-heading"><span>Target attendance</span><span class="stat-icon icon-mint">${icon('check', 17)}</span></div><div class="stat-value">75%</div><div class="stat-foot"><span>Minimum recommended threshold</span></div></article>
      </section>
      ${lowAttendanceStudents.length ? `<section class="alert-list-section"><div class="section-heading"><div><h2>Attendance alerts</h2><p>How many consecutive classes each student needs to attend to reach 75%.</p></div></div><div class="attendance-alert-list">${lowAttendanceStudents.map((student) => renderAttendanceAlert(student)).join('')}</div></section>` : ''}
      <section class="roster-section attendance-records">
        <div class="roster-heading"><div><h2>Student attendance records</h2><p>Attended, missed, and percentage calculated from 40 classes.</p></div></div>
        <div class="roster-table attendance-table">
          <div class="attendance-table-head"><span>STUDENT</span><span>ATTENDED</span><span>MISSED</span><span>PERCENTAGE</span><span>STATUS</span></div>
          ${students.map(renderAttendanceRow).join('')}
        </div>
      </section>
      <p class="demo-disclaimer">Sample attendance data only. Confirm attendance against official class records.</p>
    </main>`;
}

function renderNotificationsPage() {
  const lowAttendanceStudents = getLowAttendanceStudents();
  return `
    <main class="main-content">
      <section class="welcome-row"><div><p class="eyebrow">AIML · NOTIFICATION CENTER</p><h1>Attendance notifications</h1><p class="welcome-subtitle">Alerts help students plan ahead and maintain at least 75% attendance.</p></div><span class="notification-count">${lowAttendanceStudents.length} active</span></section>
      <section class="notifications-panel">
        ${lowAttendanceStudents.length ? lowAttendanceStudents.map((student) => renderAttendanceAlert(student)).join('') : '<div class="empty-review"><span class="empty-check">✓</span><strong>No low-attendance alerts</strong><span>All students are at or above the 75% target.</span></div>'}
      </section>
      <p class="demo-disclaimer">These are in-app demo notifications. A production system can deliver alerts by email, SMS, or push notification.</p>
    </main>`;
}

function renderStudentRow(student, status) {
  return `
    <div class="review-row">
      <span class="avatar avatar-${student.color}">${student.initials}</span>
      <span class="student-name"><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.id)} <span>·</span> just checked in</small></span>
      <button type="button" class="verify-button" data-action="verify" data-student="${student.id}" aria-label="Verify ${escapeHtml(student.name)}">${icon('check', 16)}</button>
    </div>`;
}

function renderRosterRow(student, attendance = { status: 'absent' }) {
  const statusLabels = { verified: 'Present', pending: 'Needs review', absent: 'Not checked in' };
  return `
    <div class="roster-row">
      <span class="roster-person"><span class="avatar avatar-${student.color}">${student.initials}</span><strong>${escapeHtml(student.name)}</strong></span>
      <span class="roster-id">${escapeHtml(student.id)}</span>
      <span class="roster-time">${attendance.checkedInAt ? formatTime(attendance.checkedInAt) : '—'}</span>
      <span><span class="status-pill status-${attendance.status}"><i></i>${statusLabels[attendance.status]}</span></span>
    </div>`;
}

function renderNoSession() {
  return `
    <section class="empty-session">
      <span class="empty-session-icon">${icon('scan', 25)}</span>
      <h2>Ready for your next class?</h2>
      <p>Start a session to display a rotating check-in QR code and verify attendance.</p>
      <div class="start-form">
        <label for="course-select">Choose a class</label>
        <select id="course-select">${courses.map((course) => `<option value="${course.id}">${escapeHtml(course.name)} · ${escapeHtml(course.code)}</option>`).join('')}</select>
      </div>
      <button type="button" class="button button-dark" data-action="start-session">${icon('check', 16)} Start attendance</button>
    </section>`;
}

function renderStudent() {
  const session = state.activeSession;
  const course = activeCourse();
  const student = students.find((item) => item.id === state.selectedStudentId) ?? students[0];
  const status = session?.attendance[student.id]?.status ?? 'absent';
  const alreadyChecked = status === 'pending' || status === 'verified';
  if (state.view === 'timetable') return renderTimetablePage();
  if (state.view === 'attendance') return renderStudentAttendance(student);
  if (state.view === 'notifications') return renderStudentNotifications(student);
  return `
    <main class="main-content student-main">
      <section class="welcome-row student-welcome">
        <div>
          <p class="eyebrow">STUDENT PORTAL</p>
          <h1>Quick check-in<span class="wave">✳</span></h1>
          <p class="welcome-subtitle">A quick scan, then your faculty confirms you're in class.</p>
        </div>
        ${session ? '<span class="live-pill"><span class="live-dot"></span> CHECK-IN OPEN</span>' : ''}
      </section>
      ${session ? `
        <section class="student-checkin-grid">
          <article class="student-checkin-card">
            <span class="course-chip">${escapeHtml(course.code)}</span>
            <h2>${escapeHtml(course.name)}</h2>
            <p class="student-course-meta">${escapeHtml(course.room)} <span class="bullet">·</span> ${escapeHtml(course.time)}</p>
            <div class="student-divider"></div>
            <label class="field-label" for="student-select">Checking in as</label>
            <select class="student-select" id="student-select">${students.map((item) => `<option value="${item.id}" ${item.id === student.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.id)}</option>`).join('')}</select>
            ${alreadyChecked ? `
              <div class="checkin-result ${status === 'verified' ? 'result-success' : 'result-pending'}">
                <span class="result-icon">${icon(status === 'verified' ? 'check' : 'clock', 18)}</span>
                <span><strong>${status === 'verified' ? 'Attendance confirmed' : 'Check-in sent'}</strong><small>${status === 'verified' ? 'Your faculty has verified you are in class.' : 'Ask your faculty to confirm you are in the room.'}</small></span>
              </div>
            ` : `
              <button class="button button-dark student-scan-button" type="button" data-action="open-scanner">${icon('camera', 17)} Scan class QR code</button>
              <div class="manual-divider"><span></span>or enter the 6-digit code<span></span></div>
              <form id="checkin-form" class="code-form">
                <label class="sr-only" for="checkin-code">6-digit class code</label>
                <input id="checkin-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="Enter code" />
                <button class="button button-mint" type="submit">Check in ${icon('arrow', 15)}</button>
              </form>
              <p class="checkin-error" id="checkin-error" role="alert"></p>
              <div id="scanner-panel" class="scanner-panel" hidden>
                <div class="scanner-top"><strong>Scan the class QR</strong><button class="icon-button" type="button" data-action="close-scanner" aria-label="Close scanner">${icon('close', 18)}</button></div>
                <video id="scanner-video" playsinline muted></video>
                <p id="scanner-message">Point your camera at the QR code on the classroom screen.</p>
              </div>
            `}
            <div class="student-security-note">${icon('shield', 15)}<span>Check in only when you're physically in class. Faculty will verify your presence.</span></div>
          </article>
          <aside class="how-card">
            <span class="how-icon">${icon('scan', 20)}</span>
            <h3>That’s all it takes.</h3>
            <p>Check in while the class code is live. Your faculty confirms attendance with one quick review.</p>
            <div class="how-step"><span>01</span><span><strong>Scan or enter</strong><small>The code refreshes every 30 seconds.</small></span></div>
            <div class="how-step"><span>02</span><span><strong>Faculty verifies</strong><small>They confirm you’re in the room.</small></span></div>
            <div class="how-step"><span>03</span><span><strong>You’re marked present</strong><small>Once confirmed, attendance is saved.</small></span></div>
          </aside>
        </section>
      ` : `
        <section class="empty-session student-empty">
          <span class="empty-session-icon">${icon('clock', 25)}</span>
          <h2>No active check-in</h2>
          <p>Your faculty hasn't opened attendance for a class yet. Check back when your class begins.</p>
        </section>
      `}
      ${renderStudentAttendanceSummary(student)}
      <p class="demo-disclaimer">Demo mode · Student identity is simulated. A real system needs verified campus accounts.</p>
    </main>`;
}

function renderStudentAttendanceSummary(student) {
  const summary = getAttendanceSummary(student);
  return `
    <section class="student-attendance-summary">
      <div class="roster-heading"><div><h2>Your attendance</h2><p>Sample record across ${summary.total} classes</p></div><button class="text-link" type="button" data-action="navigate" data-view="attendance">View details ${icon('arrow', 14)}</button></div>
      <div class="student-metric-row">
        <div><span>Attended</span><strong>${student.attended}</strong></div>
        <div><span>Missed</span><strong>${student.missed}</strong></div>
        <div><span>Attendance</span><strong class="${summary.percentage < attendanceThreshold ? 'text-low' : 'text-good'}">${summary.percentage.toFixed(1)}%</strong></div>
      </div>
      ${summary.percentage < attendanceThreshold
        ? renderAttendanceAlert(student, true)
        : `<p class="attendance-ok-note">${icon('check', 15)} You are ${summary.percentage === attendanceThreshold ? 'at the 75% minimum' : 'above the 75% minimum'}.</p>`}
    </section>`;
}

function renderStudentAttendance(student) {
  const summary = getAttendanceSummary(student);
  return `
    <main class="main-content student-main">
      <section class="welcome-row"><div><p class="eyebrow">AIML · STUDENT ATTENDANCE</p><h1>Your attendance</h1><p class="welcome-subtitle">${escapeHtml(student.name)} · ${escapeHtml(student.id)}</p></div></section>
      <section class="student-attendance-summary attendance-detail">
        <div class="student-metric-row">
          <div><span>Classes attended</span><strong>${student.attended}</strong></div>
          <div><span>Classes missed</span><strong>${student.missed}</strong></div>
          <div><span>Total classes</span><strong>${summary.total}</strong></div>
          <div><span>Attendance</span><strong class="${summary.percentage < attendanceThreshold ? 'text-low' : 'text-good'}">${summary.percentage.toFixed(1)}%</strong></div>
        </div>
        <div class="attendance-target"><span>75% attendance target</span><span class="target-progress"><i class="${summary.percentage < attendanceThreshold ? 'progress-low' : ''}" style="width:${Math.min(summary.percentage, 100)}%"></i></span><strong>${summary.percentage.toFixed(1)}%</strong></div>
        ${summary.percentage < attendanceThreshold
          ? renderAttendanceAlert(student)
          : `<p class="attendance-ok-note">${icon('check', 15)} You are ${summary.percentage === attendanceThreshold ? 'at the 75% minimum. Attend every upcoming class to stay on target.' : 'above the 75% minimum.'}</p>`}
      </section>
      <p class="demo-disclaimer">Sample attendance data only; check with faculty for official records.</p>
    </main>`;
}

function renderStudentNotifications(student) {
  const summary = getAttendanceSummary(student);
  return `
    <main class="main-content student-main">
      <section class="welcome-row"><div><p class="eyebrow">AIML · NOTIFICATION CENTER</p><h1>Your notifications</h1><p class="welcome-subtitle">Attendance reminders for ${escapeHtml(student.name)}.</p></div><span class="notification-count">${summary.percentage < attendanceThreshold ? '1 active' : '0 active'}</span></section>
      <section class="notifications-panel">
        ${summary.percentage < attendanceThreshold
          ? renderAttendanceAlert(student)
          : '<div class="empty-review"><span class="empty-check">✓</span><strong>No low-attendance alerts</strong><span>Your attendance is at or above the 75% target.</span></div>'}
      </section>
      <p class="demo-disclaimer">In-app demo notification. Email, SMS, and push alerts require a production notification service.</p>
    </main>`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

function render() {
  stopCamera();
  document.querySelector('#app').innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <div class="page">
        ${renderHeader()}
        ${state.role === 'faculty' ? renderFaculty() : renderStudent()}
      </div>
    </div>`;
  attachEventListeners();
  if (state.role === 'faculty' && state.activeSession) {
    renderQrCode();
    updateCountdown();
  }
}

async function renderQrCode() {
  const image = document.querySelector('#session-qr');
  if (!image || !state.activeSession) return;
  const payload = `ROLLCALL|${state.activeSession.id}|${state.activeSession.code}`;
  try {
    image.src = await QRCode.toDataURL(payload, {
      width: 176,
      margin: 1,
      color: { dark: '#17211e', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  } catch (error) {
    console.error('Could not create the attendance QR code.', error);
  }
}

function updateCountdown() {
  const countdown = document.querySelector('#countdown');
  if (!countdown || !state.activeSession) return;
  const secondsLeft = Math.max(0, Math.ceil((state.activeSession.codeExpiresAt - Date.now()) / 1000));
  countdown.textContent = `${secondsLeft}s`;
  if (secondsLeft === 0) {
    state.activeSession.code = randomCode();
    state.activeSession.codeExpiresAt = Date.now() + CODE_INTERVAL;
    saveState();
    const code = document.querySelector('.one-time-code');
    if (code) code.textContent = state.activeSession.code;
    renderQrCode();
    countdown.textContent = '30s';
  }
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = window.setInterval(updateCountdown, 1000);
}

function attachEventListeners() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button.dataset.action, button.dataset.student, button.dataset.view));
  });
  document.querySelector('#student-select')?.addEventListener('change', (event) => {
    state.selectedStudentId = event.target.value;
    saveState();
    render();
  });
  document.querySelector('#student-profile-select')?.addEventListener('change', (event) => {
    state.selectedStudentId = event.target.value;
    saveState();
    render();
  });
  document.querySelector('#checkin-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCheckIn(document.querySelector('#checkin-code').value.trim());
  });
}

function handleAction(action, studentId, view) {
  if (action === 'switch-role') {
    state.role = state.role === 'faculty' ? 'student' : 'faculty';
    state.view = 'overview';
    saveState();
    render();
  } else if (action === 'navigate') {
    state.view = view;
    saveState();
    render();
  } else if (action === 'start-session') {
    const selectedCourse = document.querySelector('#course-select')?.value ?? courses[0].id;
    state.activeSession = createSession();
    state.activeSession.courseId = selectedCourse;
    saveState();
    render();
  } else if (action === 'end-session') {
    if (window.confirm('End this attendance session? Students will no longer be able to check in.')) {
      state.activeSession = null;
      saveState();
      render();
    }
  } else if (action === 'verify') {
    if (state.activeSession?.attendance[studentId]?.status === 'pending') {
      state.activeSession.attendance[studentId].status = 'verified';
      state.activeSession.attendance[studentId].verifiedAt = Date.now();
      saveState();
      render();
    }
  } else if (action === 'open-scanner') {
    openScanner();
  } else if (action === 'close-scanner') {
    stopCamera();
    const panel = document.querySelector('#scanner-panel');
    if (panel) panel.hidden = true;
  } else if (action === 'download-csv') {
    exportCsv();
  }
}

function submitCheckIn(code) {
  const error = document.querySelector('#checkin-error');
  const session = state.activeSession;
  if (!session) {
    error.textContent = 'There is no active class check-in.';
    return;
  }
  if (!/^\d{6}$/.test(code) || code !== session.code || Date.now() >= session.codeExpiresAt) {
    error.textContent = 'That code has expired or is incorrect. Ask your faculty for the current code.';
    return;
  }
  const existing = session.attendance[state.selectedStudentId];
  if (existing?.status === 'pending' || existing?.status === 'verified') {
    error.textContent = 'You have already checked in for this class.';
    return;
  }
  session.attendance[state.selectedStudentId] = { status: 'pending', checkedInAt: Date.now() };
  saveState();
  render();
}

function parseQrPayload(payload) {
  const parts = payload.split('|');
  if (parts.length !== 3 || parts[0] !== 'ROLLCALL') return null;
  if (!state.activeSession || parts[1] !== state.activeSession.id) return null;
  return parts[2];
}

async function openScanner() {
  const panel = document.querySelector('#scanner-panel');
  const message = document.querySelector('#scanner-message');
  panel.hidden = false;
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    message.textContent = 'QR scanning is not supported in this browser. Enter the 6-digit code instead.';
    return;
  }
  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.querySelector('#scanner-video');
    video.srcObject = cameraStream;
    await video.play();
    message.textContent = 'Point your camera at the QR code on the classroom screen.';
    const scan = async () => {
      if (!cameraStream || panel.hidden) return;
      try {
        const [barcode] = await detector.detect(video);
        if (barcode) {
          const code = parseQrPayload(barcode.rawValue);
          if (code) {
            stopCamera();
            panel.hidden = true;
            submitCheckIn(code);
            return;
          }
          message.textContent = 'This QR code is not for the active class. Try again.';
        }
      } catch (error) {
        console.warn('Could not read a QR code from the camera.', error);
      }
      if (cameraStream && !panel.hidden) window.setTimeout(scan, 250);
    };
    scan();
  } catch (error) {
    message.textContent = 'Could not open your camera. Check browser permissions or enter the 6-digit code.';
    console.warn('Could not start the attendance scanner.', error);
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

function exportCsv() {
  const session = state.activeSession;
  if (!session) return;
  const rows = [
    ['Student name', 'Student ID', 'Status', 'Check-in time'],
    ...students.map((student) => {
      const attendance = session.attendance[student.id] ?? { status: 'absent' };
      return [
        student.name,
        student.id,
        attendance.status,
        attendance.checkedInAt ? formatTime(attendance.checkedInAt) : '',
      ];
    }),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = `${session.courseId}-attendance.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

window.addEventListener('beforeunload', stopCamera);
render();
startCountdown();
