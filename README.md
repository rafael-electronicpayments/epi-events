# Impact Event Ops (proof of concept)

A clickable, mobile-first prototype of an event operations web app for an annual corporate conference ("Impact"). Admins build the schedule and staff rooms; staff and contractors see their own assignments on a phone, acknowledge changes, and check in; admins see live room coverage.

**Status:** Proof of concept. All data is fictional and held in browser memory. There is no backend, login, database, email, or push. Reloading the page resets everything.

**Agreed next phase (2026-10-13):** Evolve this repo step by step, with GitHub for collaboration, Vercel hosting, and an approved Supabase free-tier backend. Employees and contractors will use emailed sign-in links. The first connected slice is login, event setup, staff/rooms/activities, assignments, acknowledgment, check-in, and shared persistence. Authentication is not implemented yet. See `context.md` for the current decisions.

## Run it

No build step. It is plain HTML, CSS, and one JavaScript file that loads React, htm, and pdf.js from CDNs, so you need an internet connection.

```bash
npm start            # serves on http://localhost:3000
# or
python3 -m http.server 3000
```

Do not open `index.html` by double-clicking; serve it so the browser loads `src/` files normally.

## Try the acceptance test

1. As **Admin**, open Schedule, Day 1, find "POS Lab: demo support" (Salon 3, 9:00-11:00 AM). Assign **Alex Rivera (Employee A)**.
2. Switch to **Staff** (Alex is the default). See the new assignment and banner.
3. Switch to **Admin**, use "Move to..." on Alex's row and pick Salon 5 (Breakout A).
4. Switch to **Staff**. See the "Changed assignment" banner. Acknowledge, then Check in.
5. Back in **Admin**: the row shows Checked in, coverage counts update, and the Activity log has every step.

A full 10-minute walkthrough is in `docs/DEMO_SCRIPT.md`.

## Project layout

```
index.html               page shell and CDN script tags
src/app.js               the entire application (see context.md for a section map)
src/styles.css           all styles, light and dark themes, print styles
src/standalone-shim.js   browser-download fallback for file saves
docs/PROJECT_SUMMARY.md  what the project is and everything built so far
docs/PRD.md              product requirements (exported from the working doc)
docs/DEMO_SCRIPT.md      stakeholder demo walkthrough
context.md               context and conventions for developers and coding agents
```

## Where to read next

Start with `context.md` for current decisions, then `docs/PROJECT_SUMMARY.md` for prototype history.
