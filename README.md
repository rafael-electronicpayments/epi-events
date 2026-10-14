# Impact Event Ops (proof of concept)

A clickable, mobile-first prototype of an event operations web app for an annual corporate conference ("Impact"). Admins build the schedule and staff rooms; staff and contractors see their own assignments on a phone, acknowledge changes, and check in; admins see live room coverage.

**Public app:** [epi-events-three.vercel.app](https://epi-events-three.vercel.app). The URL is public; application data requires a provisioned email login. See `docs/VERCEL.md` for hosting and team access.

**Status:** Connected POC. With Supabase configured, emailed sign-in links identify provisioned users and scheduling data is saved in Postgres. Without configuration, the original fictional, in-memory demo runs. Notifications are in-app; assignment emails and push notifications are not implemented.

**Direction:** Evolve this repo step by step, with GitHub for collaboration, Vercel hosting, and Supabase's free tier until POC approval. The connected slice includes login, event setup, people/rooms/activities, assignments, acknowledgment, check-in, contacts, schedule printing, and activity logging. Floorplans, incoming goods, and demo undo/reset remain in demo mode only. See `docs/SUPABASE.md` for setup and access provisioning.

## Run it

Use Node.js 24. Vite bundles React, htm, and the Supabase client. The optional demo PDF viewer and font still use CDNs.

```bash
npm ci
npm start            # http://localhost:3000 (another port if occupied)
npm test             # PostgreSQL behavior and permission tests
npm run build        # production files in dist/
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` to enable the connected app. `.env.example` lists the variables. `.env.local` is ignored by Git. Never use a secret or service-role key. Vercel uses the same variables, build command `npm run build`, and output directory `dist`.

`vercel.json` defines the deployment settings. Production builds require Supabase configuration and reject secret/service-role keys. GitHub pushes to `main` deploy to production once the repository is linked in Vercel. Production email links also require the deployed URL in Supabase's Auth URL Configuration.

## Try the acceptance test

This walkthrough applies to the unconfigured demo. For the connected app, use separate provisioned Admin and Staff accounts instead of the role switcher; create an event, person, room, activity, and assignment first. Reload to verify persistence, and use a second browser to verify shared changes.

1. As **Admin**, open Schedule, Day 1, find "POS Lab: demo support" (Salon 3, 9:00-11:00 AM). Assign **Alex Rivera (Employee A)**.
2. Switch to **Staff** (Alex is the default). See the new assignment and banner.
3. Switch to **Admin**, use "Move to..." on Alex's row and pick Salon 5 (Breakout A).
4. Switch to **Staff**. See the "Changed assignment" banner. Acknowledge, then Check in.
5. Back in **Admin**: the row shows Checked in, coverage counts update, and the Activity log has every step.

A full 10-minute walkthrough is in `docs/DEMO_SCRIPT.md`.

## Project layout

```
index.html               page shell
src/main.js              configuration and application entry point
src/repository.js        Supabase Auth and RPC adapter
src/connection.js        login, loading, refresh, and save flow
src/app.js               existing scheduling UI and fictional demo
src/styles.css           all styles, light and dark themes, print styles
src/standalone-shim.js   browser-download fallback for file saves
docs/PROJECT_SUMMARY.md  what the project is and everything built so far
docs/PRD.md              product requirements (exported from the working doc)
docs/DEMO_SCRIPT.md      stakeholder demo walkthrough
docs/SUPABASE.md         schema, permissions, and account setup
supabase/migrations/     versioned database schema and functions
tests/                   PostgreSQL tests and browser verification
context.md               context and conventions for developers and coding agents
```

## Where to read next

Start with `context.md` for current decisions, then `docs/PROJECT_SUMMARY.md` for prototype history.
