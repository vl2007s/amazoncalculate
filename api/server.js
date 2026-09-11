/* Zero-dependency Node server: REST API over the shared payroll core + static hosting
   for the frontend. Run from the repo root:  node api/server.js   (or: npm start)
   Endpoints:
     GET  /api/health               -> {status, version}
     GET  /api/holidays?year=YYYY&lang=ru|uk|en|cs
     POST /api/calculate            -> {year, month, settings?, shifts:[{type,overtime}]}
*/
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const Payroll = require("../js/payroll.js");
const LOCALES = require("../js/locales.js");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const MAX_BODY = 100 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

/* ---------- helpers ---------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
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

    const settings = Object.assign({}, Payroll.DEFAULT_SETTINGS, body.settings || {});

    const n = Payroll.daysInMonth(year, month - 1);
    const shifts = [];
    for (let i = 0; i < n; i++) {
      const s = body.shifts[i];
      const type = s && Payroll.SHIFT_TYPES.indexOf(s.type) !== -1 ? s.type : "volno";
      const overtime = !!(s && s.overtime);
      shifts.push({ type: type, overtime: (type === "den" || type === "noc") && overtime });
    }

    const lang = validLang(body.lang) || "en";
    const holidayMap = Payroll.buildHolidayMap(year, lang, LOCALES);

    const days = shifts.map(function (shift, i) {
      const date = new Date(year, month - 1, i + 1);
      const r = Payroll.calcDay(date, shift.type, shift.overtime, settings, holidayMap);
      return {
        day: i + 1,
        date: Payroll.dateKey(date),
        type: shift.type,
        overtime: shift.overtime,
        weekend: r.isWeekend,
        holiday: r.holidayName,
        /* column letters match the original workbook sheet "Vypocet" */
        F: r.F, G: r.G, H: r.H, I: r.I, J: r.J, K: r.K, L: r.L,
        M: r.M, N: r.N, O: r.O, P: r.P, E: Math.round(r.E * 100) / 100
      };
    });

    const totals = Payroll.calcTotals(days.map(function (d) { return d; }));
    delete totals.I;
    const netEstimate = Payroll.calcNetto(totals.E);

    sendJson(res, 200, {
      year: year, month: month, lang: lang,
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

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) return sendJson(res, 403, { error: "Forbidden" });
  if (rel.endsWith(path.sep) || fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    return sendJson(res, 404, { error: "Not found" });
  }
  fs.readFile(filePath, function (err, data) {
    if (err) return sendJson(res, 404, { error: "Not found" });
    const mime = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

/* ---------- server ---------- */

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  if (url.pathname === "/api/health" && req.method === "GET") return handleHealth(req, res);
  if (url.pathname === "/api/holidays" && req.method === "GET") return handleHolidays(url, res);
  if (url.pathname === "/api/calculate" && req.method === "POST") return handleCalculate(req, res);

  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "Unknown API endpoint", path: url.pathname });
  }
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });

  serveStatic(url.pathname, res);
});

server.listen(PORT, function () {
  console.log("HPP salary calculator running:");
  console.log("  app:  http://localhost:" + PORT + "/");
  console.log("  api:  http://localhost:" + PORT + "/api/health");
});
