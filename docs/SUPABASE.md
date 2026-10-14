# Supabase Setup

The scheduling slice uses normalized Postgres tables and two authenticated RPCs. The fictional demo is used only when both environment variables are absent. A partial configuration shows an error rather than silently opening the demo.

## Configuration

Use staging project `bqdpskxaongqrqmgnzir` for local development and `staging-epi-events.vercel.app`. Production project `nrzyqctclteswzsvxifo` belongs only to `epi-events-three.vercel.app`. Both have the four repository migrations; staging was seeded from the fictional mock, not copied from production. Login accounts and Auth settings are independent. Staging Site URL is `https://staging-epi-events.vercel.app`, with its trailing-slash URL and `http://localhost:3000/` allowed as redirects (owner-confirmed). Keep that Site URL when working locally; do not change the shared project's Site URL to localhost. See `docs/ENVIRONMENTS.md` for release steps.

- Put the project URL and publishable key into `.env.local` using the variable names in `.env.example`. Never put secret/service-role keys into any `VITE_` variable.
- Run `npm ci` and `npm start`. Open the URL printed by Vite.
- In Supabase Authentication, enable email authentication and disable public signups. Use the default magic-link email template.
- Set each shared project's Auth Site URL to its own Vercel URL. Allow `http://localhost:3000/` as a redirect on staging for local development. If using a different host or port, explicitly allow that origin as well; do not replace a shared Site URL with localhost.
- Configure an SMTP provider if Supabase's default email delivery does not support your testers' addresses. See [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

For production only, the public Vercel app is `https://epi-events-three.vercel.app`. Use it as the production Site URL and allow `https://epi-events-three.vercel.app/` as an email redirect. Use the separate staging URL above for staging. See `docs/VERCEL.md` (relative to the repository root) for hosting details.

The initial schema migrations have been applied to the connected EPI Events Project. For another project, apply `supabase/migrations/*.sql` in filename order through Supabase CLI or SQL Editor. Keep migrations in Git; avoid editing live tables without a migration.

## Accounts

Database access requires a trusted profile; email login alone does not grant app access. Ordinary users cannot edit invitations or promote themselves. Administrators can prepare Staff/Contractor access through People using the authorized `ops_save_person` RPC.

1. Add an administrator email to `access_invites` using SQL Editor. The initial owner's invitation has already been created in the connected project; personal addresses are not included in migration files.
2. Create that email under Authentication > Users > Add user > Create new user, with email confirmation enabled. The account's initial password is not used by the app. The invitation trigger automatically creates the administrator profile.
3. Open the app and request a sign-in link. If email delivery fails, inspect Auth configuration/SMTP; do not bypass authorization.
4. Create events, rooms, and activities through Event setup. Add staff and contractors through People. Assign people through Schedule by selecting an activity.
5. To give a roster person access, add or edit the person in People and enter their Email. Saving prepares `access_invites` with the person's Staff or Contractor type. If that email already has an Auth user, its profile is linked immediately. Otherwise create the matching Auth user through the dashboard; the invitation trigger attaches its role automatically.

Manual invitation fallback (People handles this for Staff/Contractors; replace placeholders locally and never commit personal information):

```sql
insert into public.access_invites(email,role,person_id)
values ('person@example.com','staff',42);
```

If the Auth user already existed before the invitation, provision their profile from the trusted invitation:

```sql
insert into public.profiles(user_id,role,person_id)
select u.id,i.role,i.person_id
from auth.users u join public.access_invites i on i.email=lower(u.email)
on conflict (user_id) do nothing;
```

Account creation currently uses the Supabase dashboard. Saving an email in People prepares app access but does not create an Auth account or send email. People shows No email, Login pending, or Login active. Changing/removing an email revokes that roster person's previous non-admin profile and invitation; existing administrator accounts cannot be reassigned through this form. Archiving a roster person disables their app access. Administrators are managed separately from the Staff/Contractor roster.

## Data Structure

| Table | Purpose |
| --- | --- |
| `people` | Shared roster, titles, contact numbers, map-access flags, archive state |
| `profiles` | Auth user to trusted role and roster person mapping |
| `access_invites` | Administrator-controlled email allowlist for provisioning |
| `events` | Event names, dates, and duration |
| `rooms` | Shared room directory |
| `activities` | Event/day/room, time range, and staffing requirement |
| `assignments` | Person/activity, acknowledgment, check-in, coordinator confirmation, calendar revision |
| `notifications` | In-app assignment and cancellation notices |
| `activity_log` | Database-generated action, actor, arguments, and timestamp |
| `ops_state` | Revision counter to detect concurrent edits |

Foreign keys and constraints reject orphaned assignments, duplicates, invalid times, and check-in before acknowledgment. API writes also validate event day bounds. Overlapping assignments remain allowed so the admin can decide how to handle a warning, matching the prototype.

## Access and Writes

All application tables have RLS. Anonymous clients have no table or RPC access. Admins can read the workspace; Staff and Contractors can read their own roster record, assignments, notifications, and the activities/events/rooms needed for their schedule. The snapshot omits phone numbers and the activity log for non-admins.

`ops_snapshot` returns the authorized data in the existing UI's format, including roster emails and login status. `ops_command` validates the caller's role and assignment ownership, applies one action, updates notifications, logs it, and advances the revision in one transaction. `ops_save_person` handles roster and access-list changes atomically, including email uniqueness, role checks, existing-login linkage, and revision protection. Direct browser table mutations are denied. These RPCs intentionally use `SECURITY DEFINER` with a fixed empty search path and explicit authorization checks; Supabase's advisor may flag that privilege for review. The original snapshot implementation is an unexposed helper in `ops_private` with no client execution grant.

Writes require the last loaded revision. If someone else has written since then, the command fails without partial changes; the UI reloads and asks the user to retry. It also prevents duplicate in-flight submissions. Other users' changes are refreshed every ten seconds and on window focus; this is polling, not Realtime subscriptions. Assignment changes and activity/time/date/room edits invalidate acknowledgment and check-in. Staff may acknowledge and check in only their own assignments.

## Verification and Limits

- `npm test` executes the actual migrations in PGlite (Postgres), testing role grants/RLS, own-schedule isolation, invite provisioning, invalid actions, acknowledgment/check-in, re-acknowledgment, archiving, and revision conflict rollback.
- `npm run build` builds the production application with Vite.
- `node tests/live-smoke.mjs` checks that the configured Supabase project is reachable and anonymous clients cannot read the snapshot or events table.
- `node tests/browser.mjs` requires Playwright and Edge (or set `EVENT_OPS_BROWSER`). Set `EVENT_OPS_PLAYWRIGHT_PATH` when using a bundled Playwright installation. It checks login at desktop/mobile widths and setup/reload using mocked Supabase responses; it does not prove live email delivery or authenticated cloud round trips.
- Verify live sign-in and persistence with provisioned Admin and Staff accounts before using real event data.
- The connected POC includes the original fictional mock schedules: IMPACT27 (12 activities, 29 people, 8 rooms, 32 assignments) and the empty IMPACT26 event. Original acknowledgment and check-in states are preserved. Mock roster people do not receive login accounts automatically.
- Floorplan/attachment storage, incoming goods persistence, expenses, shared undo, staff invitation UI, assignment emails, and push notifications are subsequent work. The demo still includes its original modules.
- The schema currently serves one event-operations workspace. Separate organizations would need tenant isolation before sharing the same project.

## Original Mock Data

`supabase/seed-mock.sql` imports the original scheduling example into an empty scheduling workspace. It runs in one transaction, uses generated record IDs, records the import in the activity log, and advances the shared revision so active clients refresh. It leaves Auth users, administrator profiles, and access invitations unchanged.

The seed was applied to the connected POC on 2026-10-13. It skips repeat runs after a successful import and refuses to replace existing scheduling data. It is an optional data seed, not an automatic deployment migration; do not run it as a reset. Floorplans and incoming goods remain outside the connected scheduling slice.
