# Rollcall

A responsive college-attendance prototype with rotating classroom QR codes, quick faculty verification, a sample AIML weekday timetable, and attendance alerts.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Use **View as student** to test a check-in, then switch back to faculty to verify it. The sidebar includes the weekly AIML timetable, attendance records, and an in-app notification center. Four simulated AIML students have sample records for 40 classes; low-attendance alerts calculate how many consecutive classes they must attend to reach 75%. **Export list** downloads the active class roster as CSV.

Camera scanning requires browser camera support and permission. If it is unavailable, enter the current 6-digit code shown on the faculty screen.

## Prototype limitations

This is a browser-only demo: sample identities are selectable, and session check-ins are stored in local browser storage. The AIML attendance totals and timetable are simulated and do not synchronize between devices or provide secure authentication. Before real college use, connect it to campus sign-in and a server that validates short-lived QR tokens, enrollment, session windows, and faculty verification. A rotating QR code alone cannot prevent someone from sharing a live code, so faculty presence verification remains part of the flow. Notifications are currently in-app only; email, SMS, and push delivery need a production notification service.
