/* Zero-dependency Node server: REST API over the shared payroll core + static hosting
 * for the frontend. Run from the repo root:  node api/server.js   (or: npm start)
 *
 * Endpoints:
 *   GET  /api/health               -> {status, service, time}
 *   GET  /api/holidays?year=YYYY&lang=ru|uk|en|cs
 *   POST /api/calculate            -> {year, month, settings?, shifts:[{type,overtime}]}
 *
 * Security notes (deliberate, kept dependency-free):
 *   - binds to 127.0.0.1 by default; set HOST=0.0.0.0 to expose on the LAN
 *   - static files: no dotfiles/dot-directories (no /.git, /.env leaks), traversal via
 *     path.relative, symlinks never followed, control chars rejected (they crash fs)
 *   - request body capped at 100 KB; malformed URLs answered with 400 instead of crashing
 *   - settings accepted through an explicit key whitelist, coerced to finite numbers
 *   - simple in-memory rate limit for /api (per-process, fine at this scale)
 *   - tight request/headers timeouts (slowloris), per-request try/catch safety net
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const Payroll = require("../js/payroll.js");
const LOCALES = require("../js/locales.js");

const PORT = parseInt(process.env.PORT, 10) || 3000;
/* Secure by default: localhost only. HOST=0.0.0.0 makes it reachable on the network. */
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = path.join(__dirname, "..");
const MAX_BODY = 100 * 1024; /* 100 KB is far beyond any legitimate payroll payload */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};

/* Static responses get a small, honest hardening header set. Fonts are self-hosted
 * (no Google). Umami analytics runs on the operator's own domain — set UMAMI_ORIGIN
 * (e.g. https://analytics.example.com) to allow its script + beacon in the CSP. */
const UMAMI_ORIGIN = process.env.UMAMI_ORIGIN || "";
const CSP_UMAMI = UMAMI_ORIGIN ? " " + UMAMI_ORIGIN : "";
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'" + CSP_UMAMI + "; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self'; img-src 'self' data:; connect-src 'self'" + CSP_UMAMI + "; base-uri 'self'; " +
    "frame-ancestors 'self'"
};

/* ---------- tiny in-memory rate limiter (per IP, sliding minute window) ---------- */

const RATE_MAX = 120;        /* requests per window per IP */
const RATE_WINDOW_MS = 60000;
const rateHits = new Map();  /* ip -> { count, resetAt } */

function rateLimited(ip) {
  const now = Date.now();
  const hit = rateHits.get(ip);
  if (!hit || now > hit.resetAt) {
    rateHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  hit.count += 1;
  /* opportunistic cleanup so the map can't grow without bound */
  if (rateHits.size > 5000) {
    rateHits.forEach(function (v, k) { if (now > v.resetAt) rateHits.delete(k); });
  }
  return hit.count > RATE_MAX;
}

/* ---------- response / request helpers ---------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on("data", function (c) {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function validLang(lang) {
  return typeof lang === "string" && LOCALES[lang] ? lang : null;
}

function parseYear(raw) {
  const y = parseInt(raw, 10);
  if (isNaN(y) || y < 1900 || y > 2200) return null;
  return y;
}

/* ---------- API handlers ---------- */

function handleHealth(req, res) {
  sendJson(res, 200, { status: "ok", service: "hpp-salary-calculator", time: new Date().toISOString() });
}

function handleHolidays(url, res) {
  const year = parseYear(url.searchParams.get("year") || String(new Date().getFullYear()));
  if (year === null) return sendJson(res, 400, { error: "Invalid or missing 'year' parameter" });
  const lang = validLang(url.searchParams.get("lang")) || "en";
  const holidays = Payroll.computeHolidays(year, lang, LOCALES).map(function (h) {
    return { key: h.key, date: h.dateKey, name: h.name };
  });
  sendJson(res, 200, { year: year, lang: lang, holidays: holidays });
}

/* Merge caller-provided settings over the defaults through a strict whitelist:
 * only known numeric keys, only finite values — no __proto__ games, no NaN in output. */
function sanitizeSettings(input) {
  const out = Object.assign({}, Payroll.DEFAULT_SETTINGS);
  if (!input || typeof input !== "object") return out;
  Payroll.SETTINGS_FIELDS.forEach(function (f) {
    const v = input[f.key];
    if (typeof v === "number" && isFinite(v) && v >= 0) out[f.key] = v;
  });
  return out;
}

function handleCalculate(req, res) {
  readBody(req).then(function (body) {
    const year = parseInt(body.year, 10);
    const month = parseInt(body.month, 10); /* 1-12 */
    if (isNaN(year) || year < 1900 || year > 2200) {
      return sendJson(res, 400, { error: "Field 'year' must be a number between 1900 and 2200" });
    }
    if (isNaN(month) || month < 1 || month > 12) {
      return sendJson(res, 400, { error: "Field 'month' must be between 1 and 12" });
    }
    if (!Array.isArray(body.shifts)) {
      return sendJson(res, 400, { error: "Field 'shifts' must be an array of {type, overtime}" });
    }

    const settings = sanitizeSettings(body.settings);

    /* Normalize the shift list to exactly the days of the month. Unknown types fall
     * back to 'volno'; overtime and the holiday worked/stayed-home choice are only
     * meaningful for den/noc — same rules as the UI. */
    const n = Payroll.daysInMonth(year, month - 1);
    const shifts = [];
    for (let i = 0; i < n; i++) {
      const s = body.shifts[i];
      const type = s && Payroll.SHIFT_TYPES.indexOf(s.type) !== -1 ? s.type : "volno";
      const isWorkShift = type === "den" || type === "noc";
      /* the holiday worked/stayed-home choice also applies to a poludnevka */
      const canHoliday = isWorkShift || type === "pulden";
      shifts.push({
        type: type,
        overtime: isWorkShift && !!(s && s.overtime),
        holidayWork: canHoliday ? !(s && s.holidayWork === false) : false
      });
    }

    const lang = validLang(body.lang) || "en";
    const holidayMap = Payroll.buildHolidayMap(year, lang, LOCALES);

    const results = shifts.map(function (shift, i) {
      return Payroll.calcDay(new Date(year, month - 1, i + 1), shift.type, shift, settings, holidayMap);
    });
    /* fixed monthly bonus (Pracovní odměna) layered over the raw per-day math */
    const final = Payroll.withMonthlyBonus(results, settings.bonusMonthKc);

    const days = final.map(function (r, i) {
      const shift = shifts[i];
      const date = new Date(year, month - 1, i + 1);
      return {
        day: i + 1,
        date: Payroll.dateKey(date),
        type: shift.type,
        overtime: shift.overtime,
        holidayWork: shift.holidayWork,
        weekend: r.isWeekend,
        holiday: r.holidayName,
        /* column letters match the original workbook sheet "Vypocet" */
        F: r.F, G: r.G, H: r.H, I: r.I, J: r.J, K: r.K, L: r.L,
        M: r.M, N: r.N, O: r.O, P: r.P, E: Math.round(r.E * 100) / 100,
        exempt: Math.round((r.exempt || 0) * 100) / 100
      };
    });

    const totals = Payroll.calcTotals(days);
    /* sick-pay compensation is taxed but not insured */
    const netEstimate = Payroll.calcNetto(totals.E, totals.E - totals.exempt);

    sendJson(res, 200, {
      year: year,
      month: month,
      lang: lang,
      settings: settings,
      days: days,
      totals: totals,
      netEstimate: netEstimate
    });
  }).catch(function (err) {
    sendJson(res, 400, { error: err.message });
  });
}

/* ---------- static files ---------- */

function serveStatic(urlPath, res, headOnly) {
  /* decodeURIComponent throws on malformed escapes (e.g. "/%") — that must be a 400,
   * not an uncaught exception that takes the server down. */
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch (e) {
    return sendJson(res, 400, { error: "Bad request" });
  }
  /* Control characters (incl. NUL bytes) make fs calls throw synchronous TypeErrors,
   * which would take the whole process down — reject them up front. */
  if (/[\x00-\x1f\x7f]/.test(rel)) {
    return sendJson(res, 400, { error: "Bad request" });
  }
  if (rel === "/") rel = "/index.html";

  /* Never serve dotfiles/dot-directories (.git, .env, .gitignore) or node_modules —
   * these checks run on the URL segments, before any filesystem resolution. */
  const segments = rel.split("/").filter(Boolean);
  if (segments.some(function (seg) { return seg.charAt(0) === "." || seg === "node_modules"; })) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  const filePath = path.normalize(path.join(ROOT, rel));
  /* Containment via path.relative: immune to sibling-prefix tricks (ROOT="D:\mzda"
   * must not match "D:\mzda-other\...") and to separator/casing edge cases. */
  const relToRoot = path.relative(ROOT, filePath);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  /* lstat (not stat): a symlink inside the tree could point anywhere outside ROOT —
   * never follow it. */
  fs.lstat(filePath, function (err, st) {
    if (err || st.isSymbolicLink() || !st.isFile()) return sendJson(res, 404, { error: "Not found" });
    /* resolve the real location: parent dirs might be junctions/symlinks pointing
     * outside ROOT even when the final component is a plain file */
    fs.realpath(filePath, function (rpErr, realPath) {
      if (rpErr) return sendJson(res, 404, { error: "Not found" });
      const relReal = path.relative(ROOT, realPath);
      if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
      fs.readFile(realPath, function (readErr, data) {
        if (readErr) return sendJson(res, 404, { error: "Not found" });
        const mime = MIME[path.extname(realPath).toLowerCase()] || "application/octet-stream";
        const headers = Object.assign({ "Content-Type": mime, "Cache-Control": "no-cache" }, SECURITY_HEADERS);
        res.writeHead(200, headers);
        res.end(headOnly ? undefined : data);
      });
    });
  });
}

/* ---------- server ---------- */

function dispatch(req, res) {
  const url = new URL(req.url, "http://localhost");

  /* Rate limiting counts per client IP. Behind a local reverse proxy every socket
   * comes from 127.0.0.1 — with TRUST_PROXY=1 (set only when nginx fronts us and
   * overwrites X-Real-IP itself) take the address it reports instead. */
  let clientIp = req.socket.remoteAddress || "unknown";
  if (process.env.TRUST_PROXY === "1" && req.headers["x-real-ip"]) {
    clientIp = String(req.headers["x-real-ip"]).split(",")[0].trim();
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  /* rate limit only the API — static assets stay unlimited */
  if (url.pathname.startsWith("/api/") && rateLimited(clientIp)) {
    return sendJson(res, 429, { error: "Too many requests, slow down" });
  }

  if (url.pathname === "/api/health" && req.method === "GET") return handleHealth(req, res);
  if (url.pathname === "/api/holidays" && req.method === "GET") return handleHolidays(url, res);
  if (url.pathname === "/api/calculate" && req.method === "POST") return handleCalculate(req, res);

  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "Unknown API endpoint", path: url.pathname });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });

  serveStatic(url.pathname, res, req.method === "HEAD");
}

const server = http.createServer(function (req, res) {
  /* last line of defense: a bug in any handler answers 500 instead of crashing the process */
  try {
    dispatch(req, res);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
    else { try { res.end(); } catch (e) { /* socket already broken */ } }
  }
});

/* slowloris mitigation: headers must arrive fast, whole request within 30 s */
server.headersTimeout = 10000;  /* must stay > keepAliveTimeout */
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;

/* malformed HTTP at the socket level: answer 400 and move on */
server.on("clientError", function (err, socket) {
  try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch (e) { /* dead socket */ }
});

/* fail fast and readably when the port is taken (usually a forgotten dev instance) */
server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use — is another instance running?");
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, function () {
  console.log("HPP salary calculator running:");
  console.log("  app:  http://localhost:" + PORT + "/");
  console.log("  api:  http://localhost:" + PORT + "/api/health");
  if (HOST === "127.0.0.1") console.log("  (localhost only — set HOST=0.0.0.0 to expose on the LAN)");
});
