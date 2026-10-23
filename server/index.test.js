import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './index.js';

const db = new DatabaseSync(':memory:');
const server = createApp(db).listen(0, '127.0.0.1');
let baseUrl;
let facultyCookie;
let studentCookie;
let sessionId;
let sessionCode;

function cookieFrom(response) {
  return response.headers.get('set-cookie').split(';')[0];
}

async function request(path, { cookie, ...options } = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  if (options.body) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function login(email) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'Rollcall123!' }),
  });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}

before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

test('requires authentication and rejects incorrect credentials', async () => {
  const unauthenticated = await request('/api/bootstrap');
  assert.equal(unauthenticated.status, 401);
  const invalidLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'faculty@rollcall.demo', password: 'wrong-password' }),
  });
  assert.equal(invalidLogin.status, 401);
});

test('persists check-in and enforces student and faculty permissions', async () => {
  facultyCookie = await login('faculty@rollcall.demo');
  studentCookie = await login('aiml2401@rollcall.demo');

  const start = await request('/api/sessions', {
    method: 'POST',
    cookie: facultyCookie,
    body: JSON.stringify({ courseId: 'cs204' }),
  });
  assert.equal(start.status, 201);
  const created = await start.json();
  sessionId = created.activeSession.id;
  sessionCode = created.activeSession.code;
  assert.equal(Object.keys(created.activeSession.attendance).length, 0);

  const studentBootstrap = await request('/api/bootstrap', { cookie: studentCookie });
  const studentData = await studentBootstrap.json();
  assert.equal(studentData.students.length, 1);
  assert.equal(studentData.activeSession.code, undefined);

  const invalidCode = await request(`/api/sessions/${sessionId}/check-in`, {
    method: 'POST',
    cookie: studentCookie,
    body: JSON.stringify({ code: '000000' }),
  });
  assert.equal(invalidCode.status, 400);

  const checkIn = await request(`/api/sessions/${sessionId}/check-in`, {
    method: 'POST',
    cookie: studentCookie,
    body: JSON.stringify({ code: sessionCode }),
  });
  assert.equal(checkIn.status, 201);

  const duplicate = await request(`/api/sessions/${sessionId}/check-in`, {
    method: 'POST',
    cookie: studentCookie,
    body: JSON.stringify({ code: sessionCode }),
  });
  assert.equal(duplicate.status, 409);

  const studentCannotVerify = await request(`/api/sessions/${sessionId}/attendance/AIML2401/verify`, {
    method: 'POST',
    cookie: studentCookie,
  });
  assert.equal(studentCannotVerify.status, 403);

  const verify = await request(`/api/sessions/${sessionId}/attendance/AIML2401/verify`, {
    method: 'POST',
    cookie: facultyCookie,
  });
  assert.equal(verify.status, 200);

  const end = await request(`/api/sessions/${sessionId}/end`, {
    method: 'POST',
    cookie: facultyCookie,
  });
  assert.equal(end.status, 200);

  const updatedStudent = await request('/api/bootstrap', { cookie: studentCookie });
  const updatedData = await updatedStudent.json();
  assert.equal(updatedData.activeSession, null);
  assert.equal(updatedData.user.attended, 37);
  assert.equal(updatedData.user.missed, 4);
});

test('does not permit students to start a class session', async () => {
  const response = await request('/api/sessions', {
    method: 'POST',
    cookie: studentCookie,
    body: JSON.stringify({ courseId: 'cs204' }),
  });
  assert.equal(response.status, 403);
});
