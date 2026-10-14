# Project Summary: Impact Event Ops

**Current owner decisions (2026-10-13):** Evolve this repo step by step. Use GitHub, Vercel, and an approved Supabase free-tier account until POC approval. Employees and contractors will sign in through emailed links, with administrator-assigned access. First implement authentication, event setup, assignments, acknowledgment, check-in, and shared persistence. The AWS proposal below is historical and superseded. These decisions are recorded in `context.md`; the current code is still the in-memory prototype.

Written 2026-10-13 so a new reader (human or Claude) can understand what this project is, what has been built, what has been decided, and what is next.

## 1. What this is

Jack (Senior Product Manager, electronicpayments.com) helps coordinate "Impact", an annual corporate conference. Impact26 runs 11/7-11/12/2026. Planning and staffing are done by hand in Excel sheets and PDFs, and two people spend 30-40 hours each (60-80 hours total) managing schedules from planning start to event close. Staff counts are 25-40 per event, and shrinking while events grow.

The goal is a reusable **event operations web app**: admins build the schedule and staff rooms; staff and contractors see only their own assignments on a phone, acknowledge changes, and check in; admins see live room coverage. Jack is not a developer; he has a developer and plans to use Claude Code. This repo is the clickable proof of concept (POC) used to settle workflows and demo to Marketing, before a production build.

## 2. People and devices

- **Admin:** Marketing is the overall management team; the event coordinator owns the event within it. Admins work mainly on a laptop or tablet, rarely a phone (minor changes).
- **Staff:** employees working the event; phone-first.
- **Contractor:** outside vendors (AV such as Encore, speakers, entertainment). See only their own schedule. No company accounts, so production needs an invite-based guest login.
- Only admins see the contact phone list.
- Confidential venue map access is a **per-person tickbox** (on for most staff, off by default for contractors in the prototype).

## 3. What the prototype does today

Stage 1 plus several requested additions. Everything is in `src/app.js`.

**Admin view tabs**
- **Schedule:** per-day activity cards; assign people, "Move to..." another activity, remove; shows staffed vs. required, coverage status, and overlap warnings.
- **Schedule grid:** days as columns, activities as rows, staff as child rows each with a unique color; collapsible; **Download printable schedule** produces a Letter-landscape color HTML file to print.
- **Coverage:** per-activity covered/partly/not covered, with "Confirm present" so a coordinator can verify attendance independent of the person's own check-in.
- **Contacts:** admin-only searchable phone list with role, type, map access.
- **Floorplans:** upload one or more PDFs, assign each to an event, move between events, remove, view in a built-in PDF viewer (pdf.js), download.
- **Incoming goods:** record swag, product, equipment per event (see section 4).
- **Activity log:** every change with time.
- **Setup:** create/edit/delete events (name, start date, 1-14 days; Current/Upcoming/Past badge), people (name, role/title, Staff or Contractor, phone, map tickbox), rooms, and activities (name, room, day, start/end, staff needed). Edits that change an activity's name/room/day/time make assigned staff re-acknowledge. Deleting asks first and notifies affected people.
- Top bar: **Event** menu (switches the event for all roles), **Undo** (up to 30 steps, names what it will reverse), role switcher (Admin, Staff, Contractor).

**Staff / Contractor view (phone-first)**
- Next assignment, per-day schedule, banners for new/changed/removed assignments, **Acknowledge** (required before **Check in**).
- After acknowledging: "Add to your calendar?" prompt with a 30-minute reminder; statuses "On your calendar" / "Calendar out of date". In the preview it shows the generated .ics text (standalone it can download).
- Venue floorplan card: opens the event's floorplan PDFs only if the person's map tickbox is on.

**Demo data:** event IMPACT27 (3 days, 12 activities, 8 rooms, 25 staff + 4 contractors) with intentional overlaps (Marcus Bell and Hana Ito), understaffed activities, and unacknowledged changes; empty event IMPACT26 (11/7-11/12/2026).

## 4. Incoming goods (most recent feature; not yet click-tested)

Admin-only entry per event. Fields: type (Swag, Product, Equipment, Supplies, Other), vendor name, invoice number (optional, for free supplier swag), date, invoice amount, weight unit (lb or kg). Line items: quantity, description, item cost, extended cost (calculated), per-item weight, Schedule B code (10 digits, stored as 0000.00.0000), and disposition dropdown ("Promotional Give Away - No Return" or "Temporary Use - Returning"). Totals for line items and weight, with a warning if the invoice amount differs from the line-item total. Supporting files: PDF, image, or any type, up to 25 MB each; PDFs and images preview in the page. Seeded with two example entries (apparel order; supplier-loaned equipment). The likely purpose is customs/export paperwork and tracking items that must be returned, so a customs-oriented export (CSV or PDF per event) is a natural next step.

## 5. Decisions made along the way

- Web app (PWA), no app store. Calendar via .ics files first.
- Alerts, not two-way messaging. Staff must acknowledge changes.
- Admin edits publish immediately and notify the person at once (no separate publish step yet).
- Check-in requires prior acknowledgment; contractors can acknowledge and check in (open question for Marketing).
- POC materials: run of show, sessions agenda, venue map, schedule updates. After the POC, in order: contacts, manifest, roster, meals, pre-con presentation, expenses, attire.
- Expenses (post-POC): employee, event, date, company, reason, amount, reimbursable (not company card), who it was for on meals; staff enter before/during the event; admin approval tick; admins print to PDF to send to HR for payment. No in-app emailing.
- Hosting: expense data must stay internal, so plan on AWS (dev account for beta). Suggested shape: S3 + CloudFront or Amplify for the site, Lambda or App Runner API, RDS Postgres, Cognito or company SSO, S3 for files, SES for email, web push for alerts. Open issues for IT: phones at the venue are likely off the corporate network; contractors need guest logins; no real expense data until security review. Supabase and Cloudflare were considered for cost but ruled out by the internal requirement.

## 6. Known limits of the prototype

- All data is in memory; reload resets. No login or real permissions (role switcher is a demo device).
- Notifications are in-app only. Check-in works at any time with no location.
- Rooms and people are shared across events. Floorplans belong to one event.
- Days are labeled Day 1, Day 2... Activities are limited to the event's days.
- Uploaded floorplans and attachments are lost on reload; there is no redo; the schedule-grid layout is not phone-friendly.
- Not yet built: run of show, sessions agenda, venue map hotspots (floorplan PDFs are viewable), meals, manifest, roster, attire, pre-con presentation, expenses.
- The recent features (calendar prompt, events, floorplans, incoming goods) were checked for syntax only, not click-tested by the author. Test them first.

## 7. Suggested next steps

1. Click-test the whole app, especially events, floorplan upload with a real PDF, and incoming goods.
2. Present the POC to Marketing; capture feedback in the PRD (open questions in section 5).
3. Update the PRD with multi-event, floorplans, incoming goods, calendar, and expense details (see the end of `docs/PRD.md`).
4. Production build on AWS: real auth by role (Admin, Staff, Contractor guest), Postgres schema, API, push/email, automated tests (assignment conflicts, permissions, notification delivery, expense totals), security review.
5. Stage 2 modules and expenses, in the agreed order.

## 8. Source documents behind this project

- PRD (working doc, owner Jack): master copy is a claude.ai doc; exported to `docs/PRD.md`.
- Early ChatGPT advice (PWA, six modules, phased plan, React/Next.js + Supabase suggestion, "Event as top-level entity"). Supabase is superseded by the AWS requirement.
- The POC build prompt (React, role switcher, modules 1-6, IMPACT27 demo data, acceptance test). The prototype intentionally covers a subset; the full prompt's role list (four roles) was replaced by Admin, Staff, Contractor.
