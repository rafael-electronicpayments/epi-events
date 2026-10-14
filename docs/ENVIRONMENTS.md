# Staging and Production

## Current Status

- `staging` was created from `main` at `efa6e69f36d62f25103a1aa90dca6aa84889b147`, containing the complete deployed Workspace redesign.
- Routine development now targets `staging`. `main` remains the production release branch.
- Production remains at `https://epi-events-three.vercel.app`, backed by Supabase project `nrzyqctclteswzsvxifo`.
- Vercel staging project `staging-epi-events` (`prj_36zGiz2IizVqaJxASaPogsmURU0H`) is linked to this repository, tracking `staging`, with domain `https://staging-epi-events.vercel.app`.
- Supabase staging project `epi-events-staging` (`bqdpskxaongqrqmgnzir`) is healthy in `epi-event-org`, region `us-east-2`. All four repository migrations were applied and their history versions aligned with the repository filenames. The fictional seed contains 29 people, 2 events, 12 activities, and 32 assignments. No production data was copied.
- The production Vercel project's preview builds are disabled, and its existing Supabase variables are now scoped to Production only, with values unchanged.
- Staging Vercel uses its own Supabase URL and publishable key for Production, Preview, and Development. This checkout's local Vercel link and `.env.local` target staging, verified without printing credentials.
- The owner explicitly approved removing Vercel Deployment Protection on staging; app email-link authentication and database role checks remain required. The owner confirmed staging Auth Site URL/redirects, and the initial staging administrator was verified as email-confirmed with an admin profile. Users are provisioned independently in each project.
- GitHub branch protection/rulesets have not been configured; the staging-first policy is currently documented, not server-enforced.

## Target Configuration

| Environment | Git branch | Vercel site | Supabase project |
| --- | --- | --- | --- |
| Production | `main` | `epi-events` / `epi-events-three.vercel.app` | `nrzyqctclteswzsvxifo` |
| Staging | `staging` | `staging-epi-events` / `staging-epi-events.vercel.app` | `bqdpskxaongqrqmgnzir` |

The second Vercel project uses `staging` as its production branch; Vercel calling that deployment "Production" does not make it the app's production environment. All three variable scopes on that project point only to the staging Supabase project. The existing production project's previews are disabled and production database credentials are no longer exposed to its non-production builds. Older already-built previews are not retroactively rebuilt by these configuration changes.

## Verification and Remaining Setup

- `npm test` includes database permissions, mock import, roster access, and both directions of deployment/database mix-up rejection. `scripts/validate-config.mjs` checks the expected Supabase host for both known Vercel project IDs.
- The live staging anonymous-access check passed. An authenticated staging RPC write was verified under the real administrator's database role and rolled back, leaving no test record.
- The security advisor reports three expected warnings for authenticated SECURITY DEFINER RPCs (`ops_snapshot`, `ops_command`, `ops_save_person`). These are intentional, role-checked entry points; the underlying tables remain restricted. See [advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). No anonymous function-execution warning was reported.
- Staging public signups were verified disabled through the public Auth settings endpoint on 2026-10-14; Email remains enabled for provisioned users. End-to-end email delivery still requires the owner to request and follow a staging sign-in link. No password or email token was shared with the agent. Configure SMTP if the built-in mail service does not support team testing.
- Add GitHub protection for `main` (pull requests and review requirements) as a separate configuration step.
- Migrations are not automatically deployed by Git pushes in the current setup. Verify the target project, apply only pending versioned migrations to staging first, and coordinate approved production migrations separately.

## Release Workflow

Develop and test on `staging`, including migration and permission checks. After owner approval, open a pull request from `staging` to `main`. Production schema changes require an explicitly approved migration step, coordinated with the app deployment and backwards compatibility. A Git merge deploys application code, not database migrations automatically. After the release, verify production and keep `staging` synchronized without rewriting shared history.

Do not promote a staging-built bundle with staging database credentials directly to production. Production should build from approved `main` using production environment variables.
