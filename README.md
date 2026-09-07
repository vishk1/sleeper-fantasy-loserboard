# 🚩 The Loserboard

A lightweight page that stack-ranks who owes the most in your Sleeper fantasy league.
It pulls **live** from the Sleeper API in the browser — the standings refresh on every reload.
Deployed on **Vercel** with a password gate and league ids kept out of the repo.

## Fines
- **🥶 Ice Cold** — lowest total points in the league that week = **$2**.
- **🪑 Bench Warmer** — not setting your lineup **2 weeks in a row** = **$5**, cascading
  **×1.25** for each additional consecutive 2-week block ($5 → $6.25 → $7.81…).
  Setting a valid lineup **resets** the streak and the tier back to $5.

Only **completed** weeks count (weeks before the current NFL week, and only ones that actually
have scores), so nobody gets fined for a game that hasn't happened.

## Configuration (env vars — never committed)
Set these in **Vercel → Project → Settings → Environment Variables**:

| Var | Purpose | Example |
|-----|---------|---------|
| `SITE_PASSWORD` | Password for the themed login page that gates the whole site. | `choose-your-own` |
| `SLEEPER_LEAGUES` | JSON list of seasons/tabs to show. | `[{"label":"2026 · LIVE","id":"CURRENT_ID"},{"label":"2024 · FINAL","id":"PAST_ID"}]` |

`SLEEPER_LEAGUES` also accepts a shorthand string: `2026 · LIVE:111;2024 · FINAL:222`.
If `SITE_PASSWORD` is unset the site is open (gate off). `?league=<id>` always works as an override.

## Deploy to Vercel
1. Push this repo to GitHub (league ids and secrets are gitignored — nothing sensitive lands there).
2. On [vercel.com](https://vercel.com): **Add New → Project → Import** the repo. Framework preset: **Other**.
   No build command, output dir = root.
3. Add the two env vars above, then **Deploy**.
4. Visiting the URL shows the 🚽 **Members Only** login page; enter `SITE_PASSWORD` to get in.
   (Auth is a serverless check + httpOnly cookie — the password never reaches the browser.)

## Run locally
```bash
cp config.local.example.js config.local.js   # gitignored; gives you the season tabs
python3 -m http.server
# open http://localhost:8000
```
Locally there's no auth (middleware is Vercel-only) and league ids come from `config.local.js`.
You can also skip that file and just use `http://localhost:8000/?league=<id>`.

> To exercise the real Vercel auth + `/api/config` locally instead, use `vercel dev` with a
> local `.env` containing `SITE_PASSWORD` and `SLEEPER_LEAGUES`.

> The 2026 season starts 2026-09-09; until Week 1 finishes the live tab shows the
> "Season hasn't started" state. Use the 2024 tab (or `?league=<finished id>`) to see real data.

## Files
| File | What it does |
|------|--------------|
| `index.html` | Page shell + fonts |
| `style.css` | Scoreboard / penalty-flag styling |
| `app.js` | Fetches Sleeper data, computes fines, renders the board |
| `login.html` | Themed 🚽 Members Only login page |
| `middleware.js` | Vercel Edge gate — redirects to `login.html` until the auth cookie is set |
| `api/login.js` | Validates `SITE_PASSWORD`, sets the httpOnly auth cookie |
| `api/config.js` | Serves league ids from `SLEEPER_LEAGUES` (behind auth) |
| `config.local.example.js` | Template for local-only league config |
