# EPI Event Staff Manager — PRD

**Owner:** Jack | **Status:** Draft | **Last updated:** 10/12/26 | **Stakeholders:** Marketing

(Exported from the working PRD doc on 10/13/26. The doc itself remains the master copy.)

**Implementation update (2026-10-13):** The owner has approved evolving this repo with Vercel hosting and Supabase (free tier until POC approval), superseding the AWS direction in this exported draft. Employees and contractors will use emailed sign-in links. The first connected slice covers authentication, event setup, assignments, acknowledgment, check-in, and shared persistence. See `../context.md` for current implementation decisions.

## 1. Problem Statement

- **Who** has the problem? Marketing/Impact Events Team, team leads, and event staff (25-40 per event) and contractors such as AV, speakers, and entertainment.
- **What** is the problem? No all-inclusive staff management app for staff assignments to rooms, expense tracking, meal schedules, and the items below. Everything is tracked and manually updated in Excel sheets, very tedious.
  - A. Run of Show
  - B. Sessions Agenda
  - C. Confidential Venue Map
  - D. Team Meal Schedule
  - E. Team Arrival & Departure Manifest
  - F. Suggested Attire
  - G. Team Contact List with Phone Numbers
  - H. Registration Roster
  - I. Team Pre-con Presentation
  - J. Expenses Reimbursement Form
- **Why now?** The annual events are increasing in size and complexity, and the number of staff working the event is getting reduced.
- **Impact of not solving it:** Extra work and greater chance of issues with missing coverage assignments and other problems.

## 2. Goals

- **Primary goal:** Make the marketing staff and team leads efficient by replacing manual Excel/PDF updates with one live, shared schedule.
- **Secondary goals:** Make it easy for staff assignments to be communicated to the team and allow them to get instant updates they can acknowledge.
- **Non-goals:** Manage attendee schedules.

## 3. Scope

**In scope (v1)**

- Provide staff their room schedules, manage their check-in.
- Expense tracking for staff purchases: employee, event, date, company, reason, amount, reimbursable (not company card), and who it was for on meals; entered before and during the event; an admin ticks approval after submission; admins print to PDF to send to HR for payment (after the POC).
- Provide instant updates to affected staff when room or task assignments change (alert by push or email, staff acknowledge; not two-way messaging).
- Proof of concept: the core workflow, where an admin assigns staff to a room, staff see it on their phone, Marketing changes it, staff are alerted and acknowledge, and the admin sees updated room coverage. POC materials: run of show, sessions agenda, venue map, and schedule updates; a schedule grid by day with color-coded staff and color printing on 8.5 x 11 paper for the staff office; access by role (Admin, Staff, Contractor) with a per-person tickbox for the confidential venue map; an admin-only contact phone list.

**Out of scope / later**

- App store application.
- Messaging.

**After the POC, in this order:** contacts, manifest, roster, meals, pre-con presentation, expenses, attire.

**Nice to have, not in the POC:** a phone-friendly layout of the schedule grid.

**Assumptions & dependencies:** Staff invited to work the events must be set up by the appropriate marketing event team lead; built as a web app (PWA) that works on iPhone, Android and desktop without the app stores, hosted internally on AWS (dev account for the beta) because expense data must stay internal; sized for 25-40 staff per event; admins work mainly on a laptop or tablet (a phone only for rare minor changes) and staff use phones; production roles are Admin, Staff, and Contractor (outside vendors who see only their own schedules); only admins see the contact phone list; confidential venue map access is a per-person tickbox, on for most people; Marketing is the overall management team, and the event coordinator owns the event within it; the POC may not be ready for this year's event (11/7-11/12).

## 4. Success Metrics

| Metric | Baseline | Target | Timeframe |
| --- | --- | --- | --- |
| Event set up in the app (event, rooms, staff, assignments) | Built by hand in Excel and PDFs | Complete event entered and viewable by staff | Day one |
| Schedule changes reach affected staff, who acknowledge | Revised spreadsheet sent out, no confirmation | Every affected staff member alerted; acknowledgments visible to admin | 20 days |
| Room coverage visible live (covered, unconfirmed, gaps) | None; checked manually | Live coverage view for all rooms | 20 days |
| Time to build and update staff assignments | 2 staff x 30-40 hours each (60-80 hours total), from planning start to event close | Set a % reduction against 60-80 hours | Compare at next event |
| Viable POC demoed to Marketing | Not started | Core workflow works end to end | 30 days |
| Confidential venue map visible only to people with the access tickbox on | Shared as a PDF | No unauthorized access | POC |

## 5. Open Questions & Risks

- Is it achievable? Owner: Jack, Due: 10/12/26
- Are receipts attached in the app, and what must internal hosting meet for expense data? Owner: TBD
- Who builds it, and what hosting and security review does IT require, can phones at the venue reach it, and how do contractors sign in? Owner: TBD
- Should contractors acknowledge changes and check in like staff, and do they count toward room staffing? Owner: TBD

## 6. Timeline

**Kickoff:** 10/13/2026 | **Design complete:** 10/31/2026 | **POC build complete:** 11/15/26 | **POC demo to Marketing:** 11/30/26 | **Impact26 event (spreadsheet process):** 11/7-11/12/26 | **Next event:** TBD

## Not yet reflected in the PRD (added to the prototype later)

- Multiple events (create, name, manage; admin only), each with its own days, activities, assignments, floorplans, and incoming goods.
- Floorplan PDFs: one or more per event, admin upload, shown to people with map access.
- Incoming goods (swag, product, equipment): type, vendor, invoice number, date, amount, line items (quantity, description, item cost, extended cost, per-item weight, Schedule B code, disposition of "Promotional Give Away - No Return" or "Temporary Use - Returning"), plus supporting file uploads, admin entry.
- Calendar prompt after a staff member acknowledges an assignment, with a default 30-minute reminder.
- Expense details from Jack: fields above; staff add before/during the event; admin approval tick; admins print to PDF for HR.
