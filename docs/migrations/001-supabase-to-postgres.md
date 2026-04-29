# Migration to PostgreSQL (Hetzner VPS)

## Changes Summary
- Abandoned managed Supabase service.
- Migrated database to a self-hosted PostgreSQL instance on the Hetzner VPS (`46.225.154.68`).
- Created a new database `musiki26` for this project.
- Replaced `@supabase/supabase-js` with raw PostgreSQL queries using a connection pool.
- Updated all API routes and libraries (50+ files) to use the new `query` helper.
- Updated `.env` and `.env.example` to use `DATABASE_URL`.

## Database Details
- **Host**: `46.225.154.68` (internal access via container IP `172.18.0.2` or mapped port if enabled).
- **Database**: `musiki26`
- **User**: `app`
- **Connection Pool**: Managed in `src/lib/db/pool.ts`.

## Migration Steps Taken
1. **Provisioning**: Created `musiki26` on VPS using `createdb`.
2. **Dump**: Exported Supabase schema and data using `pg_dump`.
3. **Restore**: Applied SQL dump to `musiki26` on VPS.
4. **Refactor**:
   - Installed `pg` and `@types/pg`.
   - Implemented `src/lib/db/pool.ts` with a compatibility wrapper.
   - Systematic replacement of `supabase.from()` with parameterized `query()` calls.
   - Preserved `maybeSingle()` logic using `data?.[0]`.
   - Updated `Header.astro` and `dashboard.astro` to remove remaining Supabase client usages.
   - Updated `src/scripts/sync-eval-assignment-db.mjs` to use pure `pg`.

## Local Development
- **SSH Tunnel**: A new script `scripts/db-tunnel.sh` is provided to open a secure tunnel to the VPS database.
- **Local Connection**: When the tunnel is active, use `DATABASE_URL=postgresql://app:3bce519832b81f101ebc5bc80af7f501@localhost:5433/musiki26` in your local `.env`.
- **Docker-free**: No local Docker required for database operations.

## Authentik Integration
- **OIDC Migration**: Migrated from direct Google OAuth to Authentik OIDC (with Google as an upstream provider in Authentik).
- **Configuration**: Added `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` to the environment.
- **Provider**: Updated `auth.config.ts` to include the Authentik OIDC provider while maintaining Google as a fallback/secondary option.

## Impact on Development
- Developers now need a local PostgreSQL database or an SSH tunnel to the VPS to run the app with full database functionality.
- Supabase-specific syntax is no longer supported; use standard SQL with parameterized values.
