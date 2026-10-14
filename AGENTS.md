# Repository Workflow

- Read `context.md` for project conventions and `docs/ENVIRONMENTS.md` for environment status.
- Use `staging` as the integration branch for development and team testing. Start from it, not `main`.
- Push routine changes to `staging` (or a feature branch targeting `staging`), never directly to `main`.
- Release to `main` through a reviewed pull request from `staging`, only with the owner's explicit release approval. `main` deploys production.
- A Git branch does not isolate database access. This checkout and the staging Vercel project must use Supabase `bqdpskxaongqrqmgnzir`. Production alone uses `nrzyqctclteswzsvxifo`. Verify the target before any database command; never perform test writes against production.
- Keep database changes in versioned migrations. Verify migrations on staging first; apply them to production only as an explicitly approved release step. Never reset production or copy test data over it.
- Never commit environment files, tokens, secret/service-role keys, or real staff data.
