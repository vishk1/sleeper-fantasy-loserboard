// Vercel Edge Middleware — gates the whole site behind a themed login page.
// The password lives only in the SITE_PASSWORD env var. On success, /api/login
// sets an httpOnly cookie holding a hash of the password; this checks that cookie.

export const config = { matcher: "/(.*)" };

const PUBLIC_PATHS = new Set(["/login.html", "/api/login"]);

export default async function middleware(request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return; // no password configured → gate off

  const url = new URL(request.url);
  const path = url.pathname;

  // let the login page and login endpoint through unauthenticated
  if (PUBLIC_PATHS.has(path)) return;

  const token = readCookie(request, "lb_auth");
  const expected = await sha256Hex(password);
  if (token && safeEqual(token, expected)) return; // authenticated

  // not authenticated → send to the login page, remembering the destination
  const login = new URL("/login.html", request.url);
  login.searchParams.set("next", path + url.search);
  return Response.redirect(login, 302);
}

function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  const m = raw.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
