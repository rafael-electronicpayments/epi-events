# Impact Event Ops (proof of concept)

A clickable, mobile-first prototype of an event operations web app for an annual corporate conference ("Impact"). Admins build the schedule and staff rooms; staff and contractors see their own assignments on a phone, acknowledge changes, and check in; admins see live room coverage.

**Public app:** [epi-events-three.vercel.app](https://epi-events-three.vercel.app). The URL is public; application data requires a provisioned email login. See `docs/VERCEL.md` for hosting and team access.

**Staging:** [staging-epi-events.vercel.app](https://staging-epi-events.vercel.app), with an independent Supabase database and login accounts. Use staging for team testing.

**Status:** Connected POC. Both environments use email/password login. Only staging includes the admin-only temporary-login tool for synthetic accounts; see [testing credentials](docs/TEST_LOGINS.md). Production users use their own passwords or Forgot password recovery. Scheduling data is saved in Postgres. Without configuration, the original fictional, in-memory demo runs. Notifications are in-app; the app is also installable and sends push notifications on staging (see [push notifications](docs/PUSH_NOTIFICATIONS.md)). Assignment emails are not implemented.

**Direction:** Evolve this repo step by step, with GitHub for collaboration, Vercel hosting, and Supabase's free tier until POC approval. The connected slice includes login, event setup, people/rooms/activities, assignments, acknowledgment, check-in, contacts, schedule printing, and activity logging. Floorplans, incoming goods, and demo undo/reset remain in demo mode only. See `docs/SUPABASE.md` for setup and access provisioning.

People's Add/Edit person dialog includes Email and prepares Staff/Contractor access when saved. Existing login users are linked automatically. In staging, Create test logins provisions synthetic roster accounts and the editor can reveal/reset their temporary passwords. Real accounts and administrators remain separately provisioned; their existing passwords are never displayed.

The full-width workspace uses a unified event/account header and left navigation. Schedule opens as a table with assignment details on selection; its grid view retains printable schedules. Coverage prioritizes staffing gaps. People has search and type filtering; Event setup separates events, rooms, and activities into tabs with add/edit dialogs. Staff and contractors retain their focused phone-friendly schedule.

## Run it

**Branch workflow:** Work from `staging` and push changes there. `main` is reserved for approved production releases via pull request. This checkout's local Vercel link and `.env.local` now target staging; see [environment status and release steps](docs/ENVIRONMENTS.md). Never use production database credentials for local testing.

Use Node.js 24. Vite bundles React, htm, and the Supabase client. The optional demo PDF viewer and font still use CDNs.

```bash
npm ci
npm start            # http://localhost:3000 (another port if occupied)
npm test             # PostgreSQL behavior and permission tests
npm run build        # production files in dist/
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` to enable the connected app. `.env.example` lists the browser variables. `.env.local` is ignored by Git. Never use a secret/service-role key in browser configuration. The staging test-account API uses separately protected server-only variables documented in `docs/TEST_LOGINS.md`. Vercel uses build command `npm run build` and output directory `dist`.

`vercel.json` defines the deployment settings. Production builds require Supabase configuration and reject secret/service-role keys. GitHub pushes to `main` deploy to production once the repository is linked in Vercel. Production email links also require the deployed URL in Supabase's Auth URL Configuration.

## Try the acceptance test

This walkthrough applies to the unconfigured demo. The connected POC also contains the original IMPACT27 schedule and empty IMPACT26 event. Use separate provisioned Admin and Staff accounts instead of the role switcher; roster people need an Auth account/profile before signing in. Reload to verify persistence, and use a second browser to verify shared changes.

1. As **Admin**, open Schedule, the first day tab, find "POS Lab: demo support" (Salon 3, 9:00-11:00 AM). Assign **Alex Rivera (Employee A)**.
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
src/admin-workspace.js   admin navigation, tables, assignment detail, edit dialogs
src/ui.js                shared header, accessible dialogs, Lucide icon controls
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
