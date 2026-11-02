# Infinwork

A productivity workspace for measurable work — track time, build chains, share ideas, and compete on leaderboards.

## Features

- **iTime** — Task and time tracking with live scoring
- **iChain** — Collaborative streak/chain system
- **Ideas** — Capture, share, and discuss ideas
- **Workers** — Directory with live performance scores
- **SF Tracker** — Success/failure accountability tracker

## Local Development

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

Deploy the `frontend` directory to [Vercel](https://vercel.com). The repo root `vercel.json` points Vercel at `frontend/`.

Required environment variables (see your Vercel project settings):

- `MONGODB_URI`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (optional, for Google sign-in)
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (optional, for GitHub sync)
- `JINA_API_KEY` (optional, raises Rank Politician scrape rate limits)
- `FIRECRAWL_API_KEY` (optional paid fallback for Rank Politician)
- `CRON_SECRET` (protects `/api/cron/rank-politician` and `/api/cron/ping`)

### Rank Politician scrape schedule

- Vercel Hobby cron: once daily (backup)
- GitHub Actions external cron: every 4 hours (see `.github/RANK_POLITICIAN_CRON.md`)
  - Add repo secret `CRON_SECRET` (same value as Vercel)
  - Optional secret `RANK_POLITICIAN_CRON_URL`

## Project Structure

```
├── frontend/           # Next.js app (Infinwork)
├── Raw_infinwork/      # Product notes and research
└── vercel.json         # Vercel root directory config
```

## Mobile (Android)

The canonical Android client is the native Kotlin/Compose app in `mobile/`.
It signs in through `/api/mobile/auth/start` and uses a bearer token.

`frontend/android` is the older Capacitor wrapper and is not the app the
mobile-auth handoff targets:

```bash
cd frontend
npm run cap:sync
npm run cap:open:android
```
