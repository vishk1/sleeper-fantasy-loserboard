// Serves the Sleeper league list from an env var, so league ids stay out of the
// public repo. Runs behind the Basic Auth middleware, so only members see it.
//
// Set SLEEPER_LEAGUES in Vercel as JSON, e.g.:
//   [{"label":"2026 · LIVE","id":"111"},{"label":"2024 · FINAL","id":"222"}]
// or as a shorthand string:  2026 · LIVE:111;2024 · FINAL:222

export default function handler(req, res) {
  let leagues = [];
  const raw = process.env.SLEEPER_LEAGUES;

  if (raw) {
    try {
      leagues = JSON.parse(raw);
    } catch {
      leagues = raw
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const i = pair.lastIndexOf(":");
          return { label: pair.slice(0, i).trim(), id: pair.slice(i + 1).trim() };
        });
    }
  }

  if (!leagues.length && process.env.SLEEPER_LEAGUE_ID) {
    leagues = [{ label: "LEAGUE", id: process.env.SLEEPER_LEAGUE_ID }];
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ leagues });
}
