// JOYND design survey: a tiny self-hosted server.
// No dependencies: needs only Node.js 18 or newer.
//
//   RESULTS_KEY=pick-a-password node server.js
//
// Survey:   http://localhost:3000/
// Results:  http://localhost:3000/results   (asks for RESULTS_KEY)
// CSV:      http://localhost:3000/api/export.csv?key=RESULTS_KEY

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const RESULTS_KEY = process.env.RESULTS_KEY || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "responses.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY = 64 * 1024; // one survey answer is ~1 KB

if (!RESULTS_KEY) {
  console.warn("\n⚠️  RESULTS_KEY is not set, so the Results page is locked for everyone.");
  console.warn("   Start the server with:  RESULTS_KEY=pick-a-password node server.js\n");
}

/* ---------- storage: one JSON file, one entry per respondent ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let responses = {};
try { responses = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { responses = {}; }
let writing = Promise.resolve();
function save() {
  // Write to a temp file, then rename, so a crash mid-write never corrupts the data.
  writing = writing.then(() => new Promise((resolve) => {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(responses, null, 1), (err) => {
      if (err) { console.error("Could not save:", err.message); return resolve(); }
      fs.rename(tmp, DATA_FILE, (err2) => { if (err2) console.error("Could not save:", err2.message); resolve(); });
    });
  }));
  return writing;
}

/* ---------- helpers ---------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript", ".ico": "image/x-icon", ".json": "application/json" };
const SECURITY = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN" };

function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, ...SECURITY, ...extra });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function keyOk(given) {
  if (!RESULTS_KEY || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(RESULTS_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function keyFrom(req, url) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("key");
}

// Basic protection against someone spamming the form: max 20 submissions per IP per 10 minutes.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < win);
  list.push(now); hits.set(ip, list);
  return list.length > 20;
}
setInterval(() => { const now = Date.now(); for (const [ip, l] of hits) if (!l.some((t) => now - t < 600000)) hits.delete(ip); }, 600000).unref();

// Keep only plain, small values: strings, numbers, booleans, arrays and objects.
function clean(v, depth = 0) {
  if (depth > 4) return null;
  if (typeof v === "string") return v.slice(0, 600);
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).slice(0, 40)) if (/^[\w-]{1,40}$/.test(k)) out[k] = clean(v[k], depth + 1);
    return out;
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function csvCell(v) {
  if (v == null) return "";
  if (Array.isArray(v)) v = v.join("; ");
  else if (typeof v === "object") v = [v.pick, (v.why || []).join("; ")].filter(Boolean).join(" | ");
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  // A link like "…app//results" would make "//x" parse as a host and every file would get the page back,
  // so send the browser to the cleaned-up address first.
  if (/\/\//.test(req.url.split("?")[0])) {
    res.writeHead(301, { Location: req.url.replace(/^[^?]*/, (p) => p.replace(/\/{2,}/g, "/")), ...SECURITY });
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    // Save one response (anyone can submit; no login)
    if (p === "/api/responses" && req.method === "POST") {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (rateLimited(ip)) return send(res, 429, { error: "Too many submissions, try again later." });
      let data;
      try { data = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.message === "too_large" ? 413 : 400, { error: "Bad request" }); }
      if (!data || typeof data !== "object" || typeof data.rid !== "string" || !/^[\w-]{8,64}$/.test(data.rid) || typeof data.answers !== "object") {
        return send(res, 400, { error: "Bad request" });
      }
      const now = new Date().toISOString();
      const prev = responses[data.rid];
      responses[data.rid] = {
        v: Number(data.v) || 3,
        answers: clean(data.answers),
        comment: typeof data.comment === "string" ? data.comment.slice(0, 500) : "",
        submittedAt: prev ? prev.submittedAt : now,
        updatedAt: now,
      };
      await save();
      console.log(`${now}  response ${prev ? "updated" : "saved"} (${Object.keys(responses).length} total)`);
      return send(res, 200, { ok: true });
    }

    // Read all responses (password)
    if (p === "/api/responses" && req.method === "GET") {
      if (!keyOk(keyFrom(req, url))) return send(res, 401, { error: "Wrong or missing results password" });
      return send(res, 200, Object.values(responses), undefined, { "Cache-Control": "no-store" });
    }

    // Spreadsheet download (password)
    if (p === "/api/export.csv" && req.method === "GET") {
      if (!keyOk(keyFrom(req, url))) return send(res, 401, "Wrong or missing results password", "text/plain");
      const rows = Object.values(responses);
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r.answers || {})))];
      const lines = [["submittedAt", "updatedAt", ...keys, "comment"].join(",")];
      for (const r of rows) lines.push([r.submittedAt, r.updatedAt, ...keys.map((k) => csvCell((r.answers || {})[k])), csvCell(r.comment)].join(","));
      return send(res, 200, "﻿" + lines.join("\n"), "text/csv; charset=utf-8", { "Content-Disposition": 'attachment; filename="joynd-survey-responses.csv"' });
    }

    if (p === "/healthz") return send(res, 200, { ok: true, responses: Object.keys(responses).length });

    // Static files. /results serves the same page, which then shows the results view.
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
    let file = p === "/" || p === "/results" || p === "/results/" ? "index.html" : decodeURIComponent(p.slice(1));
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "Forbidden", "text/plain");
    fs.readFile(full, (err, buf) => {
      if (err) return send(res, 404, "Not found", "text/plain");
      const ext = path.extname(full).toLowerCase();
      const cache = ext === ".html" ? "no-cache" : "public, max-age=86400";
      send(res, 200, req.method === "HEAD" ? "" : buf, TYPES[ext] || "application/octet-stream", { "Cache-Control": cache });
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`\nJOYND survey running`);
  console.log(`  Survey:   http://localhost:${PORT}/`);
  console.log(`  Results:  http://localhost:${PORT}/results`);
  console.log(`  Saved to: ${DATA_FILE} (${Object.keys(responses).length} responses so far)\n`);
});
