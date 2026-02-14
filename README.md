# Motivational Quotes API

A production-ready API for motivational quotes with user authentication, API key management, rate limiting, and caching. Built for high throughput with Fastify, optional read replica, and Redis caching.

## Features

- **User Authentication**: Email/password signup and login with JWT tokens (HTTP-only cookie or Bearer header)
- **RBAC**: Admin and user roles with permission-based access
- **API Key Management**: Generate and revoke API keys from the dashboard
- **Quotes CRUD**: Create, read, update, and delete quotes
- **Infinite Feed**: `GET /feed` with cursor-based pagination (read replica for scale)
- **Public API**: Access quotes via API keys with rate limiting
- **Rate Limiting**: Redis-backed rate limiting per IP and API key
- **Caching**: Redis cache for random quote (60s TTL)
- **Cursor-based Pagination**: Efficient pagination for list and feed
- **CORS**: Configurable allowed origins
- **Docker**: Full stack with docker-compose (PostgreSQL primary + read replica, Redis, backend, frontend)
- **TypeScript**: Typed backend and frontend
- **CI**: GitHub Actions for tests and builds

## Tech Stack

### Backend
- Fastify
- TypeScript
- Drizzle ORM
- PostgreSQL (primary + optional read replica)
- Redis (rate limit, JWT blacklist, random-quote cache)
- JWT authentication
- @fastify/helmet for security

### Frontend
- React
- Vite
- React Router
- TypeScript

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10.17.1+
- Docker and Docker Compose (for full stack)
- PostgreSQL and Redis (if running backend locally without Docker)

### Local Development

1. Clone the repository:
```bash
git clone <repo-url>
cd motivational-quotes
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:

Create `.env` from the root (see `.env.example`). For local backend/frontend without Docker:

**Backend** (e.g. `backend/.env` or root `.env` used by backend):
```
PORT=3001
DATABASE_URL=postgres://app:yourpassword@localhost:5432/quotes
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-change-in-production
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

Optional:
- `DATABASE_READ_URL`: Read replica URL (if unset, feed and read paths use primary)
- `DB_POOL_MAX`: Connection pool size (default 10)

**Frontend**:
```
VITE_API_BASE_URL=http://localhost:3001
```

4. Start services with Docker Compose:
```bash
docker compose up -d
```

This starts PostgreSQL (primary + read replica), Redis, backend, and frontend. Migrations run on backend startup. For a fresh DB, the replica is bootstrapped from the primary via streaming replication.

5. Or run backend and frontend locally:

Terminal 1 (backend):
```bash
cd backend
pnpm dev
```

Terminal 2 (frontend):
```bash
cd frontend
pnpm dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Docker Deployment

1. Copy env template and set required variables:
```bash
cp .env.example .env
# Set POSTGRES_PASSWORD and JWT_SECRET (use strong values in production)
```

2. Start the stack:
```bash
docker compose up --build
```

Services:
- **db**: PostgreSQL primary
- **postgres-replica**: Read-only replica (streaming replication) for feed and read-heavy paths
- **redis**: Redis
- **backend**: Fastify API (port 3001 or `BACKEND_PORT`)
- **frontend**: Static app (port 3000 or `FRONTEND_PORT`)

Required in `.env`: `POSTGRES_PASSWORD`, `JWT_SECRET`. See `.env.example` for optional vars (`DATABASE_READ_URL`, `DB_POOL_MAX`, etc.).

### Verify replication

With the stack running (including `postgres-replica` and `DATABASE_READ_URL`), you can confirm data replicates from primary to replica:

**1. Using the app**

- Sign up / log in, create a quote in the dashboard.
- Call `GET /feed?limit=5` (or use the feed in the UI). The feed reads from the replica; the new quote should appear after a short delay (usually &lt; 1 s).

**2. Using psql (primary vs replica)**

From the project root (replace `yourpassword` and container names if different):

```bash
# Insert on primary (db)
docker exec -it motivational-quotes-db-1 psql -U app -d quotes -c "INSERT INTO quotes (text, author) VALUES ('Replication test', 'You');"

# Wait a second, then read from replica (read-only)
docker exec -it motivational-quotes-postgres-replica-1 psql -U app -d quotes -c "SELECT id, text, author, created_at FROM quotes ORDER BY created_at DESC LIMIT 5;"
```

If the new row appears in the replica output, replication is working. Replica lag is usually sub-second.

**3. Check replica lag (optional)**

On the replica:

```bash
docker exec -it motivational-quotes-postgres-replica-1 psql -U app -d quotes -c "SELECT now() - pg_last_xact_replay_timestamp() AS replica_lag;"
```

`replica_lag` should be small (e.g. 00:00:00.xxx); NULL means no replay yet.

## API Documentation

### Health
```bash
GET /health
```
Returns `{ "ok": true }`.

### Authentication

**Sign Up**
```bash
POST /auth/signup
Content-Type: application/json

{ "email": "user@example.com", "password": "password123" }
```

**Login**
```bash
POST /auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "password123" }
```
Cookie `access_token` is set (or use `Authorization: Bearer <token>`).

**Me**
```bash
GET /auth/me
Authorization: Bearer <token>   # or cookie
```

**Logout**
```bash
POST /auth/logout
Authorization: Bearer <token>
```

### Feed (no auth, uses read replica when configured)
```bash
GET /feed?limit=20&cursor=<uuid>
```
Response: `{ "items": [...], "nextCursor": "uuid-or-null" }`

### Public API (requires API key)

Send `x-api-key` header.

**Random quote** (cached in Redis 60s):
```bash
GET /api/v1/quotes/random
x-api-key: your-api-key
```

**List quotes** (cursor pagination):
```bash
GET /api/v1/quotes?limit=20&cursor=<uuid>
x-api-key: your-api-key
```
Response: `{ "items": [...], "nextCursor": "uuid-or-null" }`

### Dashboard (requires JWT)

Use `Authorization: Bearer <token>` or cookie.

**List your quotes**
```bash
GET /dashboard/quotes
```

**Create quote**
```bash
POST /dashboard/quotes
Content-Type: application/json
{ "text": "Your quote", "author": "Optional" }
```

**Update quote**
```bash
PUT /dashboard/quotes/:id
Content-Type: application/json
{ "text": "Updated", "author": "Optional" }
```

**Delete quote**
```bash
DELETE /dashboard/quotes/:id
```

### API Keys
- `GET /dashboard/api-keys` – list keys
- `POST /dashboard/api-keys` – create (body: `{ "label": "My Key" }`); response includes `token` once
- `POST /dashboard/api-keys/:id/revoke` – revoke

## Rate Limiting

- **Public API** (`/api/v1/*`): 100 requests per 15 minutes per API key or IP
- **Auth** (`/auth/*`): 10 requests per 15 minutes per IP

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`. On exceed: `429` with `{ "error": "rate_limit_exceeded", "retryAfter": <seconds> }`.

## Security

- RBAC (admin/user)
- CORS whitelist
- bcrypt (12 rounds) for passwords
- SHA-256 hashed API keys
- JWT blacklist in Redis
- @fastify/helmet
- Rate limiting

## Testing

**Backend**
```bash
cd backend && pnpm test
```

**Frontend**
```bash
cd frontend && pnpm test
```

## Project Structure

Two deployable folders; Railway provides Postgres, Redis, and MongoDB (env vars). See [docs/RAILWAY-DEPLOY.md](docs/RAILWAY-DEPLOY.md).

```
motivational-quotes/
├── backend/                    # API – Dockerfile, deploy as one service
│   ├── src/
│   │   ├── app.ts
│   │   ├── config/, db/, redis/, middleware/, modules/, store/
│   │   └── ...
│   ├── migrations/
│   └── Dockerfile
├── frontend/                   # Web app – Dockerfile, deploy as one service
│   ├── src/
│   │   ├── routes/, components/, lib/
│   │   └── ...
│   └── Dockerfile
├── docker-compose.yml          # Backend + frontend (expects DATABASE_URL, REDIS_URL, MONGODB_URI from env)
└── .env.example
```

## License

ISC
