# Push notifications plan (PWA + Web Push)

Status: **proposal, not yet approved for build** (2026-10-20). No code has been changed for this yet.
Work happens on the `push-notification-feature` branch (see `context.md`), which shares the staging database
with `staging`, so every migration for this feature must keep the current `staging` code working.

## Is it possible with the current app?

Yes. Everything required fits the existing stack without app stores or native code:

- **Front end:** React 18 + `htm` (no JSX), built with **Vite 8** — not Next.js. Single bundle served by Vercel.
- **Hosting:** Vercel provides HTTPS (required for service workers and push) and serverless `/api` functions.
- **Backend:** Supabase — Postgres with RLS, email/password Auth, Storage, and `pg_cron` / `pg_net`
  (both available on the project, not yet enabled).
- **Hook point:** new and changed assignments already create in-app `notifications` rows inside `ops_command`
  (`notify_assignment`). Push events start from the same place.

Approach: the simplest one, with **one new dependency** (`web-push`). No PWA plugin, no service-worker framework,
no router.

## Requirements covered

| Requirement | How |
|---|---|
| Installable on iPhone and Android, no app stores | Web app manifest + icons + service worker |
| Works when the app is closed | Web Push (VAPID) handled by the service worker |
| iOS 16.4+ Home Screen apps | Supported by Safari; onboarding shows "Add to Home Screen" steps |
| Permission requested by a user action | "Enable notifications" button (Apple requires a tap) |
| Each device registered to the user account | `push_subscriptions` table, one row per device |
| Multiple devices per person | Yes: one row per device, all receive the push |
| Immediate push on new/changed assignment | Database queues a push when an assignment changes |
| Reminder 30 minutes before each assignment | Scheduled reminder row, sent by the minute scheduler |
| All sending from the backend | Vercel function holds the private VAPID key; called by `pg_cron` |
| Scheduling, retries, invalidation of outdated reminders | Outbox with due time, attempts and backoff; reminders tied to assignment version |
| Admin view of enrollment and acknowledgment, plus test notification | New column in People/Coverage + "Send test notification" |
| HTTPS and secure authentication | Vercel HTTPS; existing Supabase Auth; keys server-side only |
| No SMS, Bandwidth, Teams, Outlook or native apps | None used |
| Document when the OS can block delivery | "Delivery limits" section below, also shown to admins |

## Steps

1. **Installable app**
   - `public/manifest.webmanifest`: name, icons (192/512 px plus Apple touch icon), `display: standalone`, theme colours.
   - `public/sw.js`, written by hand: handles `push` (shows the notification) and `notificationclick`
     (opens or focuses the app on that assignment). It doesn't cache the app for offline use, so updates
     reach staff immediately.
   - Register the service worker from `src/main.js`; add the manifest and `apple-touch-icon` links to `index.html`.

2. **Onboarding / settings screen**
   - Detect iPhone/iPad Safari that is *not* running from the Home Screen and show the steps:
     Share → "Add to Home Screen" → open the app from the Home Screen.
   - Once installed (or on Android/desktop), an **Enable notifications** button calls
     `Notification.requestPermission()` and then `pushManager.subscribe()` with the VAPID public key.
   - Save the device to the logged-in person through a new RPC. Show the status ("On for this device",
     "Blocked — turn on in phone Settings") and a "Turn off on this device" option.
   - Staff sign in once more inside the Home Screen app, because it doesn't share Safari's login.

3. **Device registry (database)**
   - New table `push_subscriptions`: person, endpoint (unique), `p256dh` and `auth` keys, user agent / device label,
     created, last success, last failure, failure count.
   - RLS on; no direct table access. Security definer RPCs `push_register` / `push_unregister` only let a user
     register or remove devices for themselves.
   - Devices whose push service answers 404/410 (expired, app removed) are deleted automatically.

4. **Outbox, filled by the database**
   - New table `push_outbox`: person, kind (`assignment`, `reminder`, `test`), assignment id, assignment version,
     payload (title, body, link), due time, attempts, next attempt, status, last error.
   - A trigger on assignment add/change/remove:
     - queues an **immediate** push for the person;
     - deletes any pending reminder for that assignment and queues a new one for 30 minutes before the start.
   - Invalidation: each reminder carries the assignment's version number. When it's sent, the sender skips it
     if the assignment was removed, changed, or its event was closed.
   - If an assignment is created less than 30 minutes before it starts, only the immediate push is sent.
   - Closed events produce no pushes.

5. **Sender (backend only)**
   - `api/push-dispatch.js` on Vercel uses the `web-push` package (Node runtime, widely used).
   - `pg_cron` runs every minute and uses `pg_net` to call it with a shared secret header.
   - Each run takes the due outbox rows, sends to every device of that person, and records the result.
   - Retries with growing gaps (for example 1, 5, 15 minutes), then marks the row failed. Every attempt is logged.
   - Secrets live only in Vercel environment variables: VAPID private key, VAPID subject, Supabase service key,
     dispatch secret. The VAPID public key is the only value in the browser bundle.

6. **Admin view**
   - People/Coverage gets a **Notifications** column: device count, last successful delivery, and a
     "not enrolled" warning. It sits beside the existing acknowledgment status.
   - **Send test notification** button per person; queues a `test` push and shows the result.
   - Optional: a small "Delivery log" list of recent failed sends.

7. **Delivery limits documentation** (see below), linked from the onboarding screen and the admin view.

## Delivery limits: when the phone can block or delay pushes

- **iPhone/iPad older than iOS 16.4**, or the app opened in Safari instead of from the Home Screen: no push at all.
- **App removed from the Home Screen**: that device's registration is gone; the person must reinstall and enable again.
- **Permission denied**: the browser won't ask again. It can only be turned back on in phone Settings.
- **Focus / Do Not Disturb / scheduled summaries**: the push is delivered silently or held until later.
- **Low Power Mode (iOS)** and **battery optimisation / data saver (Android)**: delivery may be delayed.
- **Phone off or without internet**: the push service holds the message for a limited time, then drops it.
- **Browser support**: Chrome, Edge and Firefox on Android and desktop; Safari 16.4+ Home Screen apps on iOS;
  Safari on macOS 13+. Some in-app browsers (for example ones opened from email or social apps) don't support push.
- **Timing**: reminders can arrive up to about a minute late because the scheduler runs once a minute.
- **iPhone notification buttons**: iOS web pushes can't carry action buttons such as "Acknowledge". Tapping the
  push opens the assignment, where "Got it" works as today.

## Decisions to settle before building

1. **Event time zone.** Activity times are stored as minutes after midnight with no time zone. Reminders need the
   venue's time zone, so Event setup gets a time zone field (default to be chosen by the owner).
2. **Sender on Vercel** (recommended) rather than a Supabase Edge Function, because `web-push` runs reliably on Node.
3. **Same behaviour on both phones**: no Android-only "Acknowledge" button.
4. **Late assignments**: under 30 minutes before start, immediate push only.

## Rollout

- Owner runs one migration on staging in the Supabase SQL Editor; Claude verifies it afterwards.
- Owner adds Vercel Preview environment variables (Claude generates the VAPID key pair; the private key is never
  committed): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`, and the existing
  server key if not already set for Preview.
- Feature detection: the client hides push UI when the snapshot doesn't report push support, so the code is safe on
  databases without the migration. The migration only adds tables, triggers and RPCs, so current `staging` code
  keeps working on the shared staging database.
- Test on one iPhone (Home Screen) and one Android phone, including app closed, reminder timing, a changed
  assignment cancelling its old reminder, and a closed event sending nothing.
- Merge into `staging` once verified; production follows the usual approved PR, with its own VAPID keys and migration.
