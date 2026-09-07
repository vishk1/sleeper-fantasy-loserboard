// Vercel Edge Middleware — Basic Auth gate for the whole site.
// The password lives in the SITE_PASSWORD env var (set in the Vercel dashboard),
// so it is never committed to the repo or shipped to the browser as checkable code.

export const config = { matcher: "/(.*)" };

export default function middleware(request) {
  const password = process.env.SITE_PASSWORD;

  // If no password is configured, don't lock anyone out.
  // Set SITE_PASSWORD in Vercel to turn the gate on.
  if (!password) return;

  const header = request.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded); // "username:password"
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === password) return; // any username + correct password → allow
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Loserboard"' },
  });
}
