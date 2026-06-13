#!/usr/bin/env node
// Approve a waitlisted user so they can enter the app.
//
// Usage:
//   node scripts/approve.mjs user@example.com
//   APP_URL=https://yourapp.com node scripts/approve.mjs user@example.com
//
// Reads ADMIN_SECRET from .env.local and posts to /api/admin/approve. The dev
// server (or a deployed instance at APP_URL) must be running.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function loadDotenv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv();

const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Usage: node scripts/approve.mjs <email>");
  process.exit(1);
}

const secret = process.env.ADMIN_SECRET;
if (!secret) {
  console.error("ADMIN_SECRET not set in .env.local.");
  process.exit(1);
}

const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const res = await fetch(`${appUrl}/api/admin/approve`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify({ email }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, body?.error ?? body);
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
