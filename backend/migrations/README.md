# Database Migrations

This directory contains SQL migration scripts. **The backend runs all `*.sql` files in this folder on startup** (sorted by name), so you don't need to run them manually for normal startup.

## Migration Files

- `000_initial_schema.sql` - Creates `users`, `quotes`, and `api_keys` tables (safe to run repeatedly: uses `IF NOT EXISTS`).
- `001_add_role_to_users.sql` - Adds RBAC `role` column to `users` (safe on existing DBs: uses `ADD COLUMN IF NOT EXISTS`).

## Manual run (optional)

If you need to run migrations yourself (e.g. different database):

```bash
psql $DATABASE_URL -f backend/migrations/000_initial_schema.sql
psql $DATABASE_URL -f backend/migrations/001_add_role_to_users.sql
```

With Docker:

```bash
docker compose exec db psql -U app -d quotes -f - < backend/migrations/000_initial_schema.sql
```
