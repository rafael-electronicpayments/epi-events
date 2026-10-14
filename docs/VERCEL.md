# Vercel Deployment

Production URL: [https://epi-events-three.vercel.app](https://epi-events-three.vercel.app)

Staging URL: [https://staging-epi-events.vercel.app](https://staging-epi-events.vercel.app). Separate project `staging-epi-events`, tracking `staging`, with the same Vite build settings. The owner approved public URL access without Vercel login; the app still requires a provisioned Supabase login.

Project name: `epi-events`. Framework: Vite. Node.js: 24. Install command: `npm ci`. Build command: `npm run build`. Output directory: `dist`. These settings are recorded in `vercel.json` and `package.json`.

The production app has been deployed and verified from an anonymous browser at desktop and mobile widths. Vercel's production alias opens without a Vercel account. Access to event data still requires a provisioned Supabase login and profile.

## Environment

The production Vercel project has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` restricted to Production; preview builds are disabled. The separate `staging-epi-events` project uses the staging database in its Production, Preview, and Development scopes. This checkout's local Vercel link and `.env.local` also target staging. See `docs/ENVIRONMENTS.md` for project IDs and verification status. Only public client credentials belong in these variables; never use a secret/service-role key. Builds fail if configuration is missing, privileged, or points to the wrong database for either known Vercel project.

`.env.local` and `.vercel/` are local-only and excluded from Git. Vercel CLI may add an OIDC token to `.env.local`; do not publish that file or share the token.

## GitHub Updates

The project is connected to `rafael-electronicpayments/epi-events`, with `main` as the production branch. The first release was deployed with Vercel CLI; subsequent pushes use the GitHub integration.

Pushes to `main` trigger production deployments on `epi-events`. Pushes to `staging` deploy the separate `staging-epi-events` site. Preview deployments, when enabled on the staging project, use staging data; previews on the production project are disabled. Routine development uses `staging`; do not push directly to `main`. If GitHub access is revoked, restore the GitHub login connection and the Vercel GitHub App's repository access, then reconnect under Settings > Git.

Prefer the Git integration for releases. A manual production deployment requires explicit release approval and a separate approved `main` checkout whose Vercel link has been verified as `epi-events`; this checkout is linked to staging. Do not treat `--prod` alone as selecting the app's production project.

## Email Login and Team Access

In [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/nrzyqctclteswzsvxifo/auth/url-configuration), use:

- Site URL: `https://epi-events-three.vercel.app`
- Production redirect URL: `https://epi-events-three.vercel.app/`
- Local redirect URL: `http://localhost:3000/`

The owner confirmed that the production Site URL and redirect settings were saved on 2026-10-13.

Retain additional approved local URLs as needed. Add preview redirect URLs only when testers need to sign into previews. A public URL does not automatically create accounts: provision each teammate through the trusted invitation/profile workflow in `docs/SUPABASE.md`. SMTP may be required for Supabase to deliver email to all teammates.

Share the production URL with the team after configuring redirects and provisioning their accounts. A custom domain can be attached to the same Vercel project later; update Supabase Site URL and allowed redirects when changing it.

## Verification

`tests/deployment.mjs` checks anonymous production access, the connected login screen, mobile/desktop layout, and browser errors. It requires Playwright and Edge, as described for browser tests in `docs/SUPABASE.md`. Set `EVENT_OPS_TEST_URL` to the production HTTPS URL before running it. This check does not send email or validate an authenticated user's session.
