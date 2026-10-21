# Push notifications

Built 2026-10-20 on `push-notification-feature` from the approved plan in `docs/push-notifications-plan.md`, tested on
phones from the preview site, and merged into `staging` the same day. Not yet in production.
The app is installable (manifest, icons, service worker) and sends Web Push notifications for:

- **New, changed, and removed assignments**, right away (including cancelled activities and removed events).
- **A reminder 30 minutes before each assignment**, in the event's time zone (Event setup › Time zone; default Eastern).
- **Test notifications** an admin sends from People.

Assignments made under 30 minutes before they start get only the immediate push. Closed events, archived people,
and activities that already ended get nothing. Acknowledging or checking in never sends a push.

## How it works

| Part | Where |
| --- | --- |
| Installable app | `public/manifest.webmanifest`, `public/icons/`, links in `index.html` |
| Service worker (shows pushes, opens the app on tap; no offline cache) | `public/sw.js`, registered in `src/main.js` |
| Staff/contractor setting, iPhone install steps, delivery limits | `src/push.js` (`PushCard`, `DeliveryLimits`) |
| Admin: Notifications column, Send test, Delivery log, event time zone | `src/admin-workspace.js` |
| Database: devices, outbox, log, triggers, RPCs, scheduler | `supabase/migrations/20261020200000_push_notifications.sql` |
| Sender (only place the private key is used) | `api/push-dispatch.js`, `server/push-dispatch.js` (`web-push`) |

1. A person taps **Turn on notifications** (on iPhone/iPad only after adding the app to the Home Screen and opening it
   from there). The browser subscribes with the public VAPID key and `push_register` saves that device for the signed-in
   person. Each device is its own row; everyone's devices all receive their pushes.
2. Triggers on `assignments`, `activities`, and `events` add rows to `push_outbox`. Every assignment change replaces
   that assignment's pending reminder; each reminder carries the assignment version (`sequence`) it was made for.
3. Every minute `pg_cron` runs `ops_private.push_kick()`. If anything is due it calls the sender through `pg_net`
   with the shared secret. The sender's address and secret are read from Supabase Vault.
4. The sender calls `push_claim` (service role only), which re-checks each message (person active, event open,
   reminder still matches the assignment and hasn't started) and returns the person's devices. It sends with
   `web-push` and reports each device's result to `push_report`.
5. Delivered to at least one device = sent. Otherwise retried after 1, 5, then 15 minutes, then marked failed.
   Devices the push service reports as gone (404/410) are deleted. Every attempt is logged in `push_log`;
   admins see recent failures in People › Delivery log. Old rows are cleaned up after 14 days.

Only real browser push services are accepted (Apple, Google, Mozilla, Microsoft), checked both when a device is
registered and before sending. The tables have no direct access; everything goes through the functions.

## Setup per environment

Use separate keys and secrets for staging and production. Never commit them.

1. **Generate** a VAPID key pair (`npx web-push generate-vapid-keys`) and a random dispatch secret of at least 32
   characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
2. **Vercel environment variables** on the project that serves the sender. On `staging-epi-events` they are set for
   **Production** (the staging site) and **Preview** (branch previews), with the same values so that devices
   registered on either address work with one sender:
   - `VITE_VAPID_PUBLIC_KEY`: public key (it is built into the app; that is expected).
   - `VAPID_PRIVATE_KEY`: private key. Sensitive. Never give it a `VITE_` name.
   - `VAPID_SUBJECT`: a contact address, for example `mailto:events@electronicpayments.com`.
   - `PUSH_DISPATCH_SECRET`: the dispatch secret. Sensitive.
   - `SUPABASE_SECRET_KEY`: the environment's Supabase secret key (already used by the staging test-login tool;
     make sure it is also set for the scope above). Sensitive.
   Redeploy after adding them (Vite reads `VITE_` values at build time).
3. **Database migration**: run `20261020200000_push_notifications.sql` once in the SQL Editor (it enables `pg_cron`
   and `pg_net` and schedules the `push-dispatch` job), then record it in the migration history.
4. **Vault secrets** (SQL Editor; values never committed):
   ```sql
   select vault.create_secret('https://<site>/api/push-dispatch', 'push_dispatch_url');
   select vault.create_secret('<dispatch secret>', 'push_dispatch_secret');
   ```
   To change one later: `select vault.update_secret((select id from vault.secrets where name = 'push_dispatch_url'), '<new value>');`
5. **Check**: sign in on a phone, turn on notifications, then People › Send test. `select * from cron.job_run_details
   order by start_time desc limit 5;` and `select * from net._http_response order by id desc limit 5;` show the scheduler
   calls and the sender's answers.

Only one site can be the sender for a database. On staging that is `https://staging-epi-events.vercel.app/api/push-dispatch`
(it was the preview site `push-staging-epi-events.vercel.app` until the merge). Browser subscriptions belong to the
address they were made on, so people turn notifications on again on the staging site; devices registered on the
preview keep working as long as both use the same VAPID keys.

## Delivery limits (also shown in the app)

- iPhone/iPad need iOS/iPadOS 16.4+ and the app added to the Home Screen and opened from there; in Safari it can't receive pushes.
- Removing the app from the Home Screen removes that device's registration; add it again and turn notifications back on.
- If permission is denied, the browser won't ask again; it can only be turned on in the phone's settings.
- Focus/Do Not Disturb and notification summaries can deliver silently or hold pushes.
- iPhone Low Power Mode and Android battery optimization/data saver can delay delivery.
- A phone that is off or offline gets the push only if it reconnects in time (reminders 30 minutes, others 12 hours).
- Supported: Chrome, Edge, Firefox on Android and computers; Safari Home Screen apps on iOS; Safari on macOS 13+.
  Some in-app browsers (opened from email or social apps) can't receive pushes.
- Reminders can arrive up to about a minute late (the scheduler runs once a minute).
- Web pushes have no action buttons; tapping opens the assignment, where it is acknowledged as usual.
- If the browser renews a device's subscription, the new one is saved the next time the person opens the app.
