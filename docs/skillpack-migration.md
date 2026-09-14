# Skillpack migration

Skillpack imports The-Vibe-Company/companion main at e2821e67b2cf4651e2c2ec36dae6558010b14cf5 into a new Git history. The original repository remains independent.

The public instance is https://skillpack.app. The web project is skillpack in Vercel; the API, worker, PostgreSQL database, object storage, and encryption key are retained from the existing Railway deployment.

The product name, workspace packages (@skillpack/*), internal TypeScript symbols, CLI (skillpack), documentation, and social preview are renamed. The companion CLI alias, companion.json manifest format, stored metadata keys, ~/.companion client state, API headers/routes, COMPANION_* deployment variables, SQL identifiers, and authenticated-encryption domains remain compatibility contracts. Changing them by text replacement would invalidate existing packages, delegated clients, or encrypted data. Historical SQL migrations are byte-for-byte unchanged.

The existing CI workflow is copied without additional jobs or triggers. A fresh history is the initial incremental-lint baseline; full package quality, builds, database tests, browser flows, and container checks still run. The first-push secret scan includes the root commit.

Local validation completed: full package lint/typecheck/tests, production builds, PostgreSQL integration including RLS and migration preservation, 138 bundled-skill guards, and a clean full-history Gitleaks scan. Remote CI and deployment verification are tracked separately; passing local checks does not imply that deployment is complete.
