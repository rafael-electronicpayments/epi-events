# CLAUDE.md

Guidance for Claude Code and developers working in this repo.

## What this project is
A clickable proof of concept for an event operations web app (staff scheduling, room coverage, acknowledgments, check-in, floorplans, incoming goods) for an annual corporate conference. The product owner (Jack, a PM, not a developer) will present it to Marketing, then a developer will build the production version on internal AWS. Read `docs/PROJECT_SUMMARY.md` first, then `docs/PRD.md`.

## Ground rules
- The current app is a **prototype** with simulated data and in-memory state. The owner has authorized evolving this repo step by step into a connected POC using Supabase and Vercel; real authentication and persistence are now in scope. Preserve the existing workflows as they are migrated.
- Scope follows the PRD. Do not add features the owner has not asked for.
- Roles are **Admin, Staff, Contractor**. Contractors see only their own schedule. Only admins see the phone list. Venue floorplan access is a per-person flag (`map`).
- Changes to assignments must notify the affected person and require re-acknowledgment; check-in requires acknowledgment first.
- All actions must be undoable and logged (see below). New admin actions go through the same wrapper.
- Keep UI touch-friendly (44px targets), accessible, and working in light/dark and at phone width. Staff view is phone-first; admin is laptop/tablet.
- Never put real staff data, phone numbers, receipts, or expense data in this repo.

## How to run and verify
`npm start` (or `python3 -m http.server`), open the page, run the acceptance test in `README.md`. There are no automated tests yet. `node --check src/app.js` catches syntax errors only. Adding tests for conflict detection, coverage, permissions, and totals is a good first task (the pure helpers `clash`, `cover`, `lext`, `ltot`, `lwt`, `sbn`, `icsDate` are easy to extract).

## Architecture of src/app.js (single file, React 18 UMD + htm, no JSX, no build)
Order in the file:
1. **Data/model:** `EMPS` (people: id, name, role, `acct` staff|contractor, phone, `map` 0|1, `gone`), `DAYS`, `EVS` (events), `CUR` (current event id), `FP` (floorplan PDFs, bytes in memory), `INV` (incoming goods), `SESS`/`SM` (activities and lookup by id; each has `ev`, `d` day index, `a`/`b` minutes from midnight, `n` staff required), `ROOMS` (names), `SEED` (assignments).
2. **Helpers:** formatting (`fmt`, `span`), `clash` (overlap within same event/day), `cover` (covered/partial/not), `st` (status label), `ntext` (notification text), `seed()` (initial React state).
3. **Components:** `Head`, `Incoming`/`AttView` (incoming goods), `PdfView` (pdf.js), `Floorplans`, calendar helpers (`ics`, `icsDate`), `Staff` (staff and contractor view), `AdminSession`, `Coverage`, `Setup`, `Grid` + `schedDoc` (schedule grid and printable HTML), `Contacts`, `Admin`, `App`.
4. **`App`** holds React state `S = {asg, log, notes}` plus the actions object `A`.

### Things to know before changing it
- **Mutable module-level data.** People, rooms, activities, events, floorplans, and incoming goods are module arrays mutated in place; only assignments, notifications, and the log live in React state `S`. Mutations then call `setS(...)` to trigger a re-render. This was a prototype shortcut; a production app should use a real store/database.
- **Undo.** `snap()` pushes a snapshot to `H` before every action. Every function in `A` (except `dismiss`, `calAdd`, `calSkip`, `switchEv`) is wrapped to snapshot first and pop the snapshot if the action returns `false` (validation failure). New actions must return `true`/`false` accordingly and call `L(state, text)` to log (which also labels the undo entry). Add new module-level arrays to `snap()` and the undo handler.
- **Assignments** are `{id, e (person), s (activity), ack, in (checked in), conf (coordinator-confirmed), tag, seq, cal, pc}`. `seq` increments when an assignment changes so calendar entries can be updated; `cal` is the seq last added to a calendar; `pc` means "prompt for calendar".
- **Events.** Activities carry `ev`. Views filter by `CUR.id`. `syncEv()` updates `DAYS` and the calendar start date from the current event.
- **Downloads.** The code calls `window.claude.use('downloads')`, which exists in the claude.ai artifact viewer. `src/standalone-shim.js` provides a browser-download fallback elsewhere.
- **Printing.** The schedule print is a generated standalone HTML file (`schedDoc`) because `window.print()` is blocked in the artifact viewer. In a normal app a print stylesheet on the page would suffice (print CSS exists in `styles.css`).
- **Colors.** `col(personId, alpha)` gives each person a stable color via a golden-angle hue.
- **Schedule B codes** are stored as `0000.00.0000` by `sbn()` and rejected unless 10 digits.

## Agreed implementation direction (2026-10-13)
- Evolve this repo step by step, preserving the teal theme, admin workspace, and phone-first staff experience.
- GitHub is the shared source of truth; Vercel will host the app. Supabase is approved, using a free-tier account until the POC is approved. This supersedes the earlier AWS hosting proposal.
- Employees and contractors sign in through emailed links using Supabase Auth. Roles and roster access are assigned by administrators, never selected by the user at sign-in. Provisioned users only; public self-registration is outside the current scope.
- First connected slice: authentication, event setup, people and roles, rooms and activities, assignments, overlap/coverage warnings, acknowledgment, check-in, and shared persistent data. Changes require acknowledgment again; check-in requires acknowledgment.
- Floorplans, incoming goods, and expenses follow the scheduling slice. Current prototype modules remain available for workflow review.
- Enforce access in the database with Supabase row-level security. A login screen or hidden role switcher alone does not provide authorization. Never put Supabase secret/service-role keys in browser code or the repo.
- Supabase project URL and publishable key, redirect URLs, and initial administrator provisioning are required before live authentication can be verified.

## Roadmap after the POC (owner's order)
contacts, manifest, roster, meals, pre-con presentation, expenses (staff enter before/during event; admin approval tick; admins print PDF for HR), attire. Also: run of show, sessions agenda, venue map details, a phone-friendly schedule grid, customs-oriented export of incoming goods.
