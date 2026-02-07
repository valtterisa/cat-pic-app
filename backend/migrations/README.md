# Database Migrations

This directory contains SQL migration scripts for the database schema.

## How to Run Migrations

For existing databases that need to be updated:

```bash
# Connect to your database and run the migration
psql $DATABASE_URL -f migrations/001_add_role_to_users.sql
```

Or use the following command with docker:
```bash
docker compose exec db psql -U app -d quotes -f /migrations/001_add_role_to_users.sql
```

## Migration Files

- `001_add_role_to_users.sql` - Adds RBAC support by adding a role field to the users table (default: 'user')

## Notes

- For new installations, the schema in `src/db/schema.ts` already includes all fields, so migrations are not needed.
- Migrations are only needed when updating existing databases.
