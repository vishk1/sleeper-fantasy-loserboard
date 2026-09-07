// Validates the submitted password against the SITE_PASSWORD env var and, on
// success, sets an httpOnly cookie whose value is a hash of the password.
// The raw password never reaches the browser (not in JS, not readable in cookies).

import crypto from "node:crypto";

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const password = process.env.SITE_PASSWORD || "";

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const supplied = (body && body.password) || "";

  if (!password || supplied !== password) {
    res.status(401).json({ ok: false, error: "wrong_password" });
    return;
  }

  const token = crypto.createHash("sha256").update(password).digest("hex");
  res.setHeader(
    "Set-Cookie",
    `lb_auth=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`
  );
  res.status(200).json({ ok: true });
}
