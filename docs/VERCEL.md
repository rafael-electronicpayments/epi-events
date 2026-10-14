# Vercel Deployment

Production URL: [https://epi-events-three.vercel.app](https://epi-events-three.vercel.app)

Project name: `epi-events`. Framework: Vite. Node.js: 24. Install command: `npm ci`. Build command: `npm run build`. Output directory: `dist`. These settings are recorded in `vercel.json` and `package.json`.

The production app has been deployed and verified from an anonymous browser at desktop and mobile widths. Vercel's production alias opens without a Vercel account. Access to event data still requires a provisioned Supabase login and profile.

## Environment

Vercel has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured for Production, Preview, and Development. They currently point to the same POC database. Only public client credentials belong in these variables; never use a secret/service-role key. Builds fail if configuration is missing or a privileged key is supplied.

`.env.local` and `.vercel/` are local-only and excluded from Git. Vercel CLI may add an OIDC token to `.env.local`; do not publish that file or share the token.

## GitHub Updates

The intended repository is `rafael-electronicpayments/epi-events`, with `main` as the production branch. The first release was deployed with Vercel CLI. GitHub linking requires both a GitHub login connection in the Vercel account and the Vercel GitHub App with access to this repository.

After that access is granted, connect the existing `epi-events` project under Settings > Git. Reuse this project; do not create another hosting project. Once linked, pushes to `main` should create production deployments and pull requests should create previews. Confirm the Git connection and first automatic build in Vercel before relying on automatic updates.

For a manual deployment from a checkout already linked with Vercel CLI:

```bash
vercel deploy --prod
```

## Email Login and Team Access

In [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/nrzyqctclteswzsvxifo/auth/url-configuration), use:

- Site URL: `https://epi-events-three.vercel.app`
- Production redirect URL: `https://epi-events-three.vercel.app/`
- Local redirect URL: `http://localhost:3000/`

Retain additional approved local URLs as needed. Add preview redirect URLs only when testers need to sign into previews. A public URL does not automatically create accounts: provision each teammate through the trusted invitation/profile workflow in `docs/SUPABASE.md`. SMTP may be required for Supabase to deliver email to all teammates.

Share the production URL with the team after configuring redirects and provisioning their accounts. A custom domain can be attached to the same Vercel project later; update Supabase Site URL and allowed redirects when changing it.

## Verification

`tests/deployment.mjs` checks anonymous production access, the connected login screen, mobile/desktop layout, and browser errors. It requires Playwright and Edge, as described for browser tests in `docs/SUPABASE.md`. Set `EVENT_OPS_TEST_URL` to the production HTTPS URL before running it. This check does not send email or validate an authenticated user's session.
