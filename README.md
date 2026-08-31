# Next.js + Hono monorepo

## Development

```bash
bun run setup
bun run dev
```

- Next.js: http://localhost:3000
- Hono: http://localhost:3002

Run checks with `bun run lint`, `bun run typecheck`, and `bun run build`.

## Google OAuth

Copy `apps/web/.env.example` to `apps/web/.env.local`, then add a unique Auth.js secret and Google OAuth web-client credentials. Register `http://localhost:3000/api/auth/callback/google` as the local authorized redirect URI in Google Cloud.
