# Hearth

A private, self-hosted AI journaling app for couples or small households.
Built with Next.js 14, Supabase, and Claude.

**Core philosophy:** Two minutes. Three questions. No blank page. An AI that listens — not lectures.

## Screenshots

| Mood tracking | Guided entry | History |
|---|---|---|
| ![Mood tracking](public/screenshots/mood-tracking.png) | ![Guided entry](public/screenshots/guided-entry.png) | ![History](public/screenshots/history.png) |

## Features

- Daily mood tracking with visual slider (1-10, colour-coded)
- Three-question guided entry + free write
- 120+ rotating prompts — same prompt for all users each day (conversation starter)
- AI acknowledgment after each entry — warm, specific, never advice-giving
- Weekly AI-written pattern summaries
- Mood trend charts + streak tracking
- Voice-to-text input (Web Speech API)
- Calendar history view with full-text search
- Mood tag analytics (which tags correlate with high/low mood)
- Private by design — no analytics, no ads, no tracking

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (Postgres + Auth) |
| AI | Anthropic Claude API |
| Styling | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| Motion | Framer Motion |

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- An [Anthropic API key](https://console.anthropic.com)

### Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/your-username/hearth.git
   cd hearth
   npm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Fill in your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` — from Supabase dashboard
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase dashboard
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard (Settings > API)
   - `ANTHROPIC_API_KEY` — from Anthropic console
   - `ALLOWED_EMAILS` — comma-separated list of allowed email addresses
   - `CRON_SECRET` — any random string for cron job auth

4. Apply all database migrations and sync the private allowlist:
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   npm run security:sync-allowlist
   ```

5. Start the dev server:
   ```bash
   npm run dev
   ```

6. Visit `http://localhost:3000` and log in with a magic link.

### Restricting Access

Set `ALLOWED_EMAILS` in your environment to restrict access:
```
ALLOWED_EMAILS=alice@example.com,bob@example.com
```

After changing the list, run `npm run security:sync-allowlist`. Access is
enforced both by the application and by Supabase row-level security. Unknown
addresses are rejected by the database even if someone bypasses the web app.

## Deploying to Vercel

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables from `.env.example`
4. Deploy

The weekly summary cron job runs automatically on Sundays at 7:00 AM UTC (configured in `vercel.json`).

## Self-Hosting with Docker

```bash
docker compose up -d
```

Note: You'll still need a Supabase instance (cloud or [self-hosted](https://supabase.com/docs/guides/self-hosting)).

## Project Structure

```
app/
  (auth)/login/     — Magic link login
  (app)/            — Main app shell
    page.tsx        — Today's entry
    history/        — Calendar + search
    insights/       — Mood charts + AI summary
    settings/       — Profile settings
  api/
    entries/        — CRUD for journal entries
    ai/summary/     — Weekly AI summary generation
    cron/           — Cron job endpoints
components/
  journal/          — Entry form, mood slider, voice input
  insights/         — Charts, history, summary
lib/
  supabase/         — Supabase client/server/middleware
  claude.ts         — Anthropic API wrapper
  prompts.ts        — 120+ rotating prompts
```

## Contributing

PRs welcome. This was built for a family of two but designed for anyone.

## License

MIT
