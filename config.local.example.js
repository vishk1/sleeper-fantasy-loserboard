// LOCAL DEV ONLY. Copy this file to `config.local.js` (which is gitignored) to get
// the season tabs when serving locally with `python3 -m http.server`.
// It is auto-loaded only on localhost and is never deployed to production
// (production reads league ids from the SLEEPER_LEAGUES env var via /api/config).

window.LB_LEAGUES = [
  { label: "2026 · LIVE", id: "YOUR_CURRENT_LEAGUE_ID" },
  { label: "2024 · FINAL", id: "YOUR_PAST_LEAGUE_ID" },
];
