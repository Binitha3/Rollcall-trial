import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';

const SESSION_COOKIE = 'rollcall_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_INTERVAL_MS = 30_000;

const seedUsers = [
  { id: 'faculty-1', name: 'Alex Rivera', email: 'faculty@rollcall.demo', role: 'faculty', attended: 0, missed: 0 },
  { id: 'AIML2401', name: 'Aarav Mehta', email: 'aiml2401@rollcall.demo', role: 'student', attended: 36, missed: 4 },
  { id: 'AIML2402', name: 'Ananya Rao', email: 'aiml2402@rollcall.demo', role: 'student', attended: 28, missed: 12 },
  { id: 'AIML2403', name: 'Dev Patel', email: 'aiml2403@rollcall.demo', role: 'student', attended: 25, missed: 15 },
  { id: 'AIML2404', name: 'Isha Nair', email: 'aiml2404@rollcall.demo', role: 'student', attended: 30, missed: 10 },
];

const seedCourses = [
  { id: 'cs204', name: 'Data Structures', code: 'CS 204', room: 'Room 302', time: '10:30 AM' },
  { id: 'ma102', name: 'Applied Mathematics', code: 'MA 102', room: 'Room 108', time: '12:00 PM' },
  { id: 'ec110', name: 'Digital Electronics', code: 'EC 110', room: 'Lab 2', time: '2:00 PM' },
];

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function setCookie(res, token, secure) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, secure) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function readCookie(req) {
  const cookieHeader = req.headers.cookie ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function makeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function comparePassword(password, user) {
  const stored = Buffer.from(user.password_hash, 'hex');
  const candidate = Buffer.from(passwordHash(password, user.password_salt), 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

export function initializeDatabase(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      role TEXT NOT NULL CHECK (role IN ('faculty', 'student')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      attended INTEGER NOT NULL DEFAULT 0 CHECK (attended >= 0),
      missed INTEGER NOT NULL DEFAULT 0 CHECK (missed >= 0)
    );
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      room TEXT NOT NULL,
      time TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS class_sessions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id),
      code TEXT NOT NULL,
      code_expires_at INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_by TEXT NOT NULL REFERENCES users(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_class_session
      ON class_sessions((1)) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS class_attendance (
      session_id TEXT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'absent')),
      checked_in_at INTEGER,
      verified_at INTEGER,
      PRIMARY KEY (session_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
  `);

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, role, password_salt, password_hash, attended, missed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const user of seedUsers) {
      const salt = crypto.randomBytes(16).toString('hex');
      insertUser.run(user.id, user.name, user.email, user.role, salt, passwordHash('Rollcall123!', salt), user.attended, user.missed);
    }
  }

  const insertCourse = db.prepare('INSERT OR IGNORE INTO courses (id, name, code, room, time) VALUES (?, ?, ?, ?, ?)');
  for (const course of seedCourses) {
    insertCourse.run(course.id, course.name, course.code, course.room, course.time);
  }
}

function userProfile(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, attended: user.attended, missed: user.missed };
}

function rotateCode(db, session) {
  const now = Date.now();
  if (session.code_expires_at <= now) {
    const code = String(crypto.randomInt(100000, 1_000_000));
    const expiresAt = now + CODE_INTERVAL_MS;
    db.prepare('UPDATE class_sessions SET code = ?, code_expires_at = ? WHERE id = ? AND ended_at IS NULL')
      .run(code, expiresAt, session.id);
    return { ...session, code, code_expires_at: expiresAt };
  }
  return session;
}

function activeSessionPayload(db, user) {
  let session = db.prepare(`
    SELECT s.id, s.course_id, s.code, s.code_expires_at, s.started_at, s.ended_at,
      c.name AS course_name, c.code AS course_code, c.room, c.time
    FROM class_sessions s JOIN courses c ON c.id = s.course_id
    WHERE s.ended_at IS NULL
  `).get();
  if (!session) return null;
  session = rotateCode(db, session);
  const records = db.prepare('SELECT student_id, status, checked_in_at, verified_at FROM class_attendance WHERE session_id = ?')
    .all(session.id);
  const attendance = Object.fromEntries(records.map((record) => [record.student_id, {
    status: record.status,
    ...(record.checked_in_at ? { checkedInAt: record.checked_in_at } : {}),
    ...(record.verified_at ? { verifiedAt: record.verified_at } : {}),
  }]));
  return {
    id: session.id,
    courseId: session.course_id,
    course: { id: session.course_id, name: session.course_name, code: session.course_code, room: session.room, time: session.time },
    startedAt: session.started_at,
    codeExpiresAt: session.code_expires_at,
    ...(user.role === 'faculty' ? { code: session.code } : {}),
    attendance: user.role === 'faculty' ? attendance : { [user.id]: attendance[user.id] ?? { status: 'absent' } },
  };
}

function createRequireAuth(db) {
  return (req, res, next) => {
    const token = readCookie(req);
    if (!token) return next(makeError(401, 'Sign in to continue.'));
    const authSession = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.attended, u.missed
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hash(token), Date.now());
    if (!authSession) return next(makeError(401, 'Your session has expired. Sign in again.'));
    req.user = authSession;
    req.authTokenHash = hash(token);
    return next();
  };
}

export function createApp(db, {
  secureCookies = process.env.NODE_ENV === 'production',
  webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../dist'),
} = {}) {
  initializeDatabase(db);
  const app = express();
  const requireAuth = createRequireAuth(db);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/api/auth/login', (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || email.length > 254 || password.length > 200) {
      return next(makeError(400, 'Enter your email and password.'));
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !comparePassword(password, user)) return next(makeError(401, 'Email or password is incorrect.'));
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hash(token), user.id, now + SESSION_LIFETIME_MS, now);
    setCookie(res, token, secureCookies);
    return res.json({ user: userProfile(user) });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(req.authTokenHash);
    clearCookie(res, secureCookies);
    res.json({ status: 'ok' });
  });

  app.get('/api/bootstrap', requireAuth, (req, res) => {
    const courseRows = db.prepare('SELECT id, name, code, room, time FROM courses ORDER BY id').all();
    const allStudents = db.prepare(`
      SELECT id, name, email, role, attended, missed FROM users
      WHERE role = 'student' ORDER BY id
    `).all().map(userProfile);
    const students = req.user.role === 'faculty' ? allStudents : allStudents.filter((student) => student.id === req.user.id);
    res.json({
      user: userProfile(req.user),
      students,
      courses: courseRows,
      activeSession: activeSessionPayload(db, req.user),
    });
  });

  app.post('/api/sessions', requireAuth, (req, res, next) => {
    if (req.user.role !== 'faculty') return next(makeError(403, 'Only faculty can start attendance.'));
    const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : '';
    const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
    if (!course) return next(makeError(400, 'Choose a valid course.'));
    if (db.prepare('SELECT id FROM class_sessions WHERE ended_at IS NULL').get()) {
      return next(makeError(409, 'An attendance session is already active.'));
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const code = String(crypto.randomInt(100000, 1_000_000));
    db.prepare(`
      INSERT INTO class_sessions (id, course_id, code, code_expires_at, started_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, courseId, code, now + CODE_INTERVAL_MS, now, req.user.id);
    res.status(201).json({ activeSession: activeSessionPayload(db, req.user) });
  });

  app.post('/api/sessions/:sessionId/rotate', requireAuth, (req, res, next) => {
    if (req.user.role !== 'faculty') return next(makeError(403, 'Only faculty can view the classroom code.'));
    const session = db.prepare('SELECT id, code, code_expires_at FROM class_sessions WHERE id = ? AND ended_at IS NULL')
      .get(req.params.sessionId);
    if (!session) return next(makeError(404, 'The attendance session is no longer active.'));
    const current = rotateCode(db, session);
    res.json({ code: current.code, codeExpiresAt: current.code_expires_at });
  });

  app.post('/api/sessions/:sessionId/check-in', requireAuth, (req, res, next) => {
    if (req.user.role !== 'student') return next(makeError(403, 'Only students can check in.'));
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const session = db.prepare('SELECT id, code, code_expires_at FROM class_sessions WHERE id = ? AND ended_at IS NULL')
      .get(req.params.sessionId);
    if (!session) return next(makeError(404, 'This attendance session is no longer active.'));
    if (!/^\d{6}$/.test(code) || code !== session.code || Date.now() >= session.code_expires_at) {
      return next(makeError(400, 'That code has expired or is incorrect. Ask your faculty for the current code.'));
    }
    const existing = db.prepare('SELECT status FROM class_attendance WHERE session_id = ? AND student_id = ?')
      .get(session.id, req.user.id);
    if (existing && existing.status !== 'absent') return next(makeError(409, 'You have already checked in for this class.'));
    const now = Date.now();
    db.prepare(`
      INSERT INTO class_attendance (session_id, student_id, status, checked_in_at, verified_at)
      VALUES (?, ?, 'pending', ?, NULL)
      ON CONFLICT(session_id, student_id) DO UPDATE SET status = 'pending', checked_in_at = excluded.checked_in_at, verified_at = NULL
    `).run(session.id, req.user.id, now);
    res.status(201).json({ status: 'pending', checkedInAt: now });
  });

  app.post('/api/sessions/:sessionId/attendance/:studentId/verify', requireAuth, (req, res, next) => {
    if (req.user.role !== 'faculty') return next(makeError(403, 'Only faculty can verify attendance.'));
    const result = db.prepare(`
      UPDATE class_attendance SET status = 'verified', verified_at = ?
      WHERE session_id = ? AND student_id = ? AND status = 'pending'
    `).run(Date.now(), req.params.sessionId, req.params.studentId);
    if (!result.changes) return next(makeError(409, 'This student does not have a pending check-in.'));
    res.json({ status: 'verified' });
  });

  app.post('/api/sessions/:sessionId/end', requireAuth, (req, res, next) => {
    if (req.user.role !== 'faculty') return next(makeError(403, 'Only faculty can end attendance.'));
    const session = db.prepare('SELECT id FROM class_sessions WHERE id = ? AND ended_at IS NULL').get(req.params.sessionId);
    if (!session) return next(makeError(404, 'This attendance session is no longer active.'));
    const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all();
    const findAttendance = db.prepare('SELECT status FROM class_attendance WHERE session_id = ? AND student_id = ?');
    const addAttendance = db.prepare(`
      INSERT INTO class_attendance (session_id, student_id, status, checked_in_at, verified_at)
      VALUES (?, ?, 'absent', NULL, NULL)
    `);
    const countAttendance = db.prepare('UPDATE users SET attended = attended + ?, missed = missed + ? WHERE id = ?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const student of students) {
        let attendance = findAttendance.get(session.id, student.id);
        if (!attendance) {
          addAttendance.run(session.id, student.id);
          attendance = { status: 'absent' };
        }
        countAttendance.run(attendance.status === 'verified' ? 1 : 0, attendance.status === 'verified' ? 0 : 1, student.id);
      }
      db.prepare('UPDATE class_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), session.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      return next(error);
    }
    res.json({ status: 'ended' });
  });

  app.use('/api', (req, res, next) => next(makeError(404, 'API route not found.')));
  app.use(express.static(webRoot));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('API request failed:', error);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : error.message });
  });
  return app;
}

function startServer() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const databasePath = resolve(process.env.ROLLCALL_DB_PATH ?? `${currentDir}/../data/rollcall.sqlite`);
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  const app = createApp(db);
  const server = createServer(app);
  const port = Number(process.env.PORT ?? 3001);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Rollcall API listening at http://127.0.0.1:${port}`);
    console.log('Demo accounts: faculty@rollcall.demo and aiml2401–aiml2404@rollcall.demo');
  });
  const shutdown = () => server.close(() => {
    db.close();
    process.exit(0);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
