# Staging Password Login

The staging app now signs in provisioned Admin, Staff, and Contractor accounts using email and password. Signed-out users cannot see the workspace. The production site remains on its previously deployed email-link flow until an explicitly approved release from `staging` to `main`.

## Testing Workflow

1. Keep an existing staging admin session, or sign in using the password set when creating that administrator in Supabase. Use Forgot password for recovery if needed; the recovery email must return to the staging Site URL.
2. Open People and choose Create test logins. This creates actual email-confirmed Supabase Auth users for every eligible roster person (any email address, Admin, Staff, or Contractor; widened from `@epieventstest.com` Staff/Contractors only at the owner's request on 2026-10-21), linked through the existing trusted invitation trigger. It is safe to retry: existing managed accounts keep their passwords.
3. Edit a person to reveal or copy their masked Temporary password. Reset temporary password requires confirmation and changes only that managed test account. Creating or resetting access is separate from saving person details.
4. Use a separate browser profile or private window to sign in as the person. Staff and contractors still receive only their authorized schedule and actions.

Login active means a real login/profile has been provisioned, not that a person has signed in already. No last-sign-in timestamps are fabricated. Account creation and password reset here send no email, so share the temporary password with the person directly. `@epieventstest.com` addresses are not mailboxes.

## Server Configuration

Only the `staging-epi-events` Vercel project has these variables, in its Production and Preview scopes:

- `SUPABASE_SECRET_KEY`: staging Supabase secret key, stored as Sensitive/Secret; never use a browser-visible `VITE_` name.
- `STAGING_TEST_PASSWORD_SECRET`: generated private random secret used to derive unique per-person temporary passwords, stored as Sensitive/Secret. Do not commit, log, or expose it.
- `STAGING_TEST_LOGINS_ENABLED=true`: explicit off-switch for this temporary feature.

The public Supabase URL must equal staging project `bqdpskxaongqrqmgnzir`, and the Vercel project ID must match the staging project. The API returns 404 elsewhere, even if someone copies the variables to production. The browser has no privileged key. Local Vite uses the deployed staging API with an authorized staging session; the API allows the approved staging host and localhost:3000 origins.

`api/test-logins.js` calls `server/test-logins.js`. Every credential/provision/reset request verifies the bearer token with Supabase and checks the trusted `profiles` admin role. Staff, contractors, anonymous callers, and unapproved origins cannot access credentials. Roster people with an email and a matching Admin, Staff, or Contractor invitation are eligible. Logins created outside this tool (for example in Supabase directly, including existing administrator logins), people whose invitation type doesn't match, and archived people are never reset or exposed.

Passwords are hashed by Supabase Auth. No plaintext passwords are added to the database, snapshot, activity log, Git, localStorage, or sessionStorage. The server derives temporary passwords from the private random secret, person/email, and a random version stored in server-controlled Auth app metadata. Only an admin's explicit editor request returns one password, with no-store response headers. Bulk results never contain passwords. Closing the editor removes the credential from the rendered UI.

Keep the derivation secret stable while these accounts are in use. Rotating it or changing a password outside this feature requires resetting the managed account's temporary password here to synchronize it. Existing real administrator passwords cannot be recovered or displayed; use Supabase password recovery instead.

## Verification and Retirement

Run `npm test` for password auth, server authorization, bulk idempotency, role protection, and existing scheduling/database tests. `tests/browser.mjs` covers invalid/valid mocked password login, recovery requests, masked test passwords and reset confirmation, People status refresh, and responsive layouts. Deployed/live checks must distinguish mocked UI checks from actual Auth account creation and password sign-in.

Before real-user onboarding, disable this feature, remove its server secrets and test accounts as a separately approved cleanup, and implement the invitation/password-creation workflow. Do not enable temporary credential disclosure in production. Do not automatically promote a staging-built bundle or copy staging users into production.
