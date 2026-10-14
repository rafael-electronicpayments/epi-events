# IMPACT27 POC Demo Script

About 10 minutes. Shows the one workflow the proof of concept must prove: an admin assigns someone, the person sees it, the plan changes, they acknowledge, and the admin sees the result.

## Before you start
- Open the app on a laptop or tablet and click **Reset demo** at the bottom. Keep a phone nearby for the staff view.
- Start as **Admin**. Say up front that everything is simulated: fictional people, in-memory data, no real email or push.

## 1. The problem (1 minute)
- Two people spend 30 to 40 hours each (60 to 80 hours total) managing schedules in Excel and PDFs.
- Changes are emailed as new files and nobody confirms they saw them.
- Goal: one live schedule that tells people when it changes and shows admins who has seen it.

## 2. The core workflow (4 minutes)
1. As **Admin**, open **Schedule**, **Day 1**. Find **POS Lab: demo support** (Salon 3, 9:00-11:00 AM). It is short one person.
2. Choose **Alex Rivera (Employee A)** and click **Assign**. Point out the toast.
3. Click **Staff**. Show the **New assignment** banner and the card needing acknowledgment.
4. Click **Admin**. On Alex's row, **Move to...** **Salon 5, Breakout A** (same time).
5. Click **Staff**. Show the **Changed assignment** banner with the **Was** line. This replaces the revised spreadsheet.
6. Click **Acknowledge**, then **Check in**. (An "Add to your calendar?" prompt appears after acknowledging.)
7. Click **Admin**. Breakout A shows Alex **Checked in**; counts updated. Open **Activity log**.

## 3. Safety nets (2 minutes)
- **Overlaps:** On Day 1, Marcus Bell and Hana Ito are double-booked. Rows show an **Overlap** tag.
- **Understaffing:** Open **Coverage**; several sessions are short.
- **Confirm present:** In Coverage, click **Confirm present** to show a coordinator verifying attendance.
- **Undo:** Click **Undo** in the top bar repeatedly.

## 4. Who sees what (2 minutes)
- **Staff** sees only their own schedule and floorplan card.
- **Contractor** (Pat Quinn, AV): sees only their schedule; venue map access is off.
- **Admin > Contacts**: only admins see the phone list and map-access flags.
- **Setup**: edit a person to show the "Can view confidential venue map" tickbox.

## 5. Setup, events, floorplans, printing (1 minute)
- **Setup**: create/edit events, rooms, activities, people. Use the **Event** menu in the top bar to switch events.
- **Floorplans**: upload a PDF and assign it to an event; view it as Staff.
- **Schedule grid**: days across, activities as rows, staff in their own colors. **Download printable schedule**, open it, print Letter landscape.
- **Incoming goods**: record swag and equipment with invoice line items and attachments.

## 6. Simulated vs. next
- Simulated: data resets on reload, notifications are in-app only, check-in works any time, no login.
- Not built: run of show, sessions agenda, venue map hotspots, meals, manifest, roster, attire, pre-con presentation, expenses.
- Production needs: real sign-in by role, a database, push/email, internal AWS hosting, IT security review.

## Questions for the room
- Should contractors acknowledge and check in like staff, and count toward room staffing?
- Who may change assignments: Marketing, the event coordinator, or both?
- Is the post-POC order right: contacts, manifest, roster, meals, pre-con presentation, expenses, attire?
