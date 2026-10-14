# Staging and Production

## Current Status

- `staging` was created from `main` at `efa6e69f36d62f25103a1aa90dca6aa84889b147`, containing the complete deployed Workspace redesign.
- Routine development now targets `staging`. `main` remains the production release branch.
- Production remains at `https://epi-events-three.vercel.app`, backed by Supabase project `nrzyqctclteswzsvxifo`.
- A separate staging Supabase project and stable staging Vercel site have not been provisioned yet.
- The existing Vercel project's Preview and Development variables currently use the production Supabase project. A preview is NOT yet an isolated testing environment. Do not use it for test writes.
- GitHub branch protection/rulesets have not been configured; the staging-first policy is currently documented, not server-enforced.

## Target Configuration

| Environment | Git branch | Vercel site | Supabase project |
| --- | --- | --- | --- |
| Production | `main` | Existing `epi-events` project and public URL | Existing production project |
| Staging | `staging` | Separate `epi-events-staging` project; preferred domain `staging-epi-events.vercel.app`, subject to availability | New independent staging project |

The second Vercel project will use `staging` as its production branch. Its Production, Preview, and Development variables must point only to the staging Supabase project. The existing production project's non-production variables also need to be isolated or its preview deployments disabled before testing.

## Next Steps

1. Create a separate Supabase staging project after confirming free-project capacity. Keep production unchanged.
2. Apply the repository's `supabase/migrations/` in order to the staging project, verifying the target project before running commands. Use the fictional seed where applicable and provision staging login accounts separately. Auth settings and users are not automatically cloned by schema migrations.
3. Configure local development to use staging's URL and publishable key. Never commit `.env.local` or use privileged keys in the frontend.
4. Create/link the separate Vercel staging project to this repository and the `staging` branch. Assign an available stable domain and staging-only environment variables before deploying.
5. Configure staging Supabase email-link Site URL and redirect URLs for the staging site and approved localhost URL. Verify login, role restrictions, persistent writes, refresh, and isolation from production.
6. Add GitHub protection for `main` (pull requests and review requirements) as a separate configuration step.

## Release Workflow

Develop and test on `staging`, including migration and permission checks. After owner approval, open a pull request from `staging` to `main`. Production schema changes require an explicitly approved migration step, coordinated with the app deployment and backwards compatibility. A Git merge deploys application code, not database migrations automatically. After the release, verify production and keep `staging` synchronized without rewriting shared history.

Do not promote a staging-built bundle with staging database credentials directly to production. Production should build from approved `main` using production environment variables.
