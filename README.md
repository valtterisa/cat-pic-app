# Motivational Quotes API

A production-ready API for accessing motivational quotes with user authentication, API key management, rate limiting, and caching.

## Features

- **User Authentication**: Email/password signup and login with JWT tokens
- **RBAC (Role-Based Access Control)**: Admin and user roles with permission-based access
- **API Key Management**: Generate and manage API keys from the dashboard
- **Quotes CRUD**: Create, read, update, and delete quotes
- **Public API**: Access quotes via API keys with rate limiting
- **Rate Limiting**: Redis-backed rate limiting per IP and API key
- **Caching**: Redis caching for improved performance
- **Cursor-based Pagination**: Efficient pagination for large datasets
- **CORS Security**: Configurable whitelist for allowed origins
- **Docker Support**: Full containerization with docker-compose
- **TypeScript**: Fully typed backend and frontend
- **CI/CD**: GitHub Actions for automated testing and builds

## Tech Stack

### Backend
- Express.js
- TypeScript
- Drizzle ORM
- PostgreSQL
- Redis
- JWT authentication
- Helmet for security

### Frontend
- React
- Vite
- React Router
- TypeScript

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10.17.1+
- Docker and Docker Compose (for containerized setup)
- PostgreSQL (if running locally without Docker)
- Redis (if running locally without Docker)

### Local Development

1. Clone the repository:
```bash
git clone <repo-url>
cd cat-pic-app
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:

Create `.env` files in `backend/` and `frontend/`:

**backend/.env**:
```
PORT=3001
DATABASE_URL=postgres://app:app@localhost:5432/quotes
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-change-in-production
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

**frontend/.env**:
```
VITE_API_BASE_URL=http://localhost:3001
```

4. Start services with Docker Compose:
```bash
docker compose up -d
```

5. Run database migrations (for existing databases):
```bash
# If updating an existing database, run the migration
psql $DATABASE_URL -f backend/migrations/001_add_role_to_users.sql

# For new databases, the schema will be created automatically on first run
# Or you can create it manually:
psql $DATABASE_URL -f backend/migrations/001_add_role_to_users.sql
```

6. Start development servers:

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

The app will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Docker Deployment

### Build and Run

```bash
docker compose up --build
```

This will start:
- PostgreSQL on port 5432
- Redis on port 6379
- Backend API on port 3001
- Frontend on port 3000

### Environment Variables

Set these in your deployment environment (Railway, etc.):

**Backend**:
- `PORT`: Server port (default: 3001)
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: Secret key for JWT signing
- `CORS_ORIGINS`: Comma-separated list of allowed CORS origins (default: http://localhost:5173,http://localhost:3000)

**Frontend**:
- `VITE_API_BASE_URL`: Backend API URL

## API Documentation

### Authentication

#### Sign Up
```bash
POST /auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Login
```bash
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

### Public API (Requires API Key)

All public endpoints require the `x-api-key` header.

#### Get Random Quote
```bash
GET /api/v1/quotes/random
x-api-key: your-api-key-here
```

#### List Quotes (with pagination)
```bash
GET /api/v1/quotes?limit=20&cursor=<uuid>
x-api-key: your-api-key-here
```

Response:
```json
{
  "items": [...],
  "nextCursor": "uuid-or-null"
}
```

### Dashboard API (Requires JWT)

All dashboard endpoints require the `Authorization: Bearer <token>` header.

#### List Your Quotes
```bash
GET /dashboard/quotes
Authorization: Bearer <jwt-token>
```

#### Create Quote
```bash
POST /dashboard/quotes
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "text": "Your quote text",
  "author": "Optional author"
}
```

#### Update Quote
```bash
PUT /dashboard/quotes/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "text": "Updated text",
  "author": "Updated author"
}
```

#### Delete Quote
```bash
DELETE /dashboard/quotes/:id
Authorization: Bearer <jwt-token>
```

### API Key Management

#### List API Keys
```bash
GET /dashboard/api-keys
Authorization: Bearer <jwt-token>
```

#### Create API Key
```bash
POST /dashboard/api-keys
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "label": "My API Key"
}
```

Response includes the plaintext key (only shown once):
```json
{
  "key": {...},
  "token": "mot_<your-api-key>"
}
```

#### Revoke API Key
```bash
POST /dashboard/api-keys/:id/revoke
Authorization: Bearer <jwt-token>
```

## Rate Limiting

- **Public API**: 100 requests per 15 minutes per API key or IP
- **Auth endpoints**: 10 requests per 15 minutes per IP

Rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in window

When rate limit is exceeded, you'll receive a `429` response:
```json
{
  "error": "rate_limit_exceeded",
  "retryAfter": 900
}
```

## Security

- **RBAC**: Role-based access control with admin and user roles
- **CORS**: Whitelist-based CORS configuration for allowed origins
- Passwords are hashed using bcrypt (12 rounds)
- API keys are hashed (SHA-256) before storage
- JWT tokens can be blacklisted (stored in Redis)
- Helmet.js for HTTP security headers
- Rate limiting to prevent abuse

## Testing

### Backend
```bash
cd backend
pnpm test
```

### Frontend
```bash
cd frontend
pnpm test
```

## Railway Deployment

### Setup

1. Create two Railway projects: `dev` and `prod`
2. Add PostgreSQL and Redis services to each project
3. Set environment variables in Railway dashboard
4. Connect GitHub repository
5. Deploy from main branch

### Environment Separation

- **Dev**: Use for testing and development
- **Prod**: Use for production traffic

Each environment has:
- Separate database
- Separate Redis instance
- Separate environment variables
- Independent scaling

### Monitoring

Railway provides built-in metrics and logs:
- View logs in Railway dashboard
- Monitor request rates and errors
- Track resource usage

## Development

### Project Structure

```
cat-pic-app/
├── backend/
│   ├── src/
│   │   ├── app.ts              # Express app setup
│   │   ├── server.ts           # Server entry point
│   │   ├── config/             # Configuration
│   │   ├── db/                 # Database (Drizzle)
│   │   ├── redis/               # Redis client
│   │   ├── middleware/         # Express middleware
│   │   └── modules/             # Feature modules
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── routes/             # React routes
│   │   ├── components/         # React components
│   │   ├── lib/                # Utilities
│   │   └── state/              # State management
│   └── Dockerfile
└── docker-compose.yml
```

## License

ISC

## Support

For issues and questions, please open an issue on GitHub.
