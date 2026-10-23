# Rollcall

A responsive college-attendance prototype with rotating classroom QR codes, quick faculty verification, a sample AIML weekday timetable, and attendance alerts.

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL at `http://localhost:5173`. The dev command starts the Vite frontend and SQLite API together. The SQLite database is created at `data/rollcall.sqlite`.

Use **Sign out** to switch accounts. Faculty can start/end sessions and verify student check-ins; student check-ins and all changes are stored by the server and shared with other signed-in browsers. The sidebar includes the weekly AIML timetable, attendance records, and in-app notifications. Four simulated AIML students have sample records for 40 classes; low-attendance alerts calculate how many consecutive classes they need to attend to reach 75%. **Export list** downloads the active class roster as CSV.

### Demo accounts

All demo accounts use password `Rollcall123!`:

- Faculty: `faculty@rollcall.demo`
- Students: `aiml2401@rollcall.demo`, `aiml2402@rollcall.demo`, `aiml2403@rollcall.demo`, `aiml2404@rollcall.demo`

To build and run the production web server locally, use `npm start`; it builds the frontend and serves it with the API at `http://127.0.0.1:3001`.

The API can be tested with `npm test`.

Camera scanning requires browser camera support and permission. If it is unavailable, enter the current 6-digit code shown on the faculty screen.

## Prototype limitations

This is a local demo backend with seeded accounts, SQLite persistence, hashed demo passwords, and HTTP-only session cookies. Use a campus identity provider, HTTPS, managed secrets, database backups, deployment hardening, and real enrollment data before college use. A rotating QR can still be shared during its short validity window, so faculty presence verification remains part of the flow. Notifications are in-app only; email, SMS, and push delivery need a production notification service.
