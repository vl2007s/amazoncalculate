/* Quick TCP service probe: which common service ports are open on a host.
 * Usage: node tools/portcheck.js <ip> [ports] */
"use strict";

const host = process.argv[2];
const PORTS = process.argv[3]
  ? process.argv[3].split(",").map(Number)
  : [
      21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995,
      1433, 1521, 3000, 3001, 3306, 3389, 5432, 5900, 6379,
      8000, 8008, 8080, 8081, 8443, 8888, 9000, 9090, 9200,
      11211, 20618, 27017
    ];

const NAMES = {
  21: "FTP", 22: "SSH", 25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3",
  143: "IMAP", 443: "HTTPS", 465: "SMTPS", 587: "SMTP-submission",
  993: "IMAPS", 995: "POP3S", 1433: "MSSQL", 1521: "Oracle", 3000: "Node/Dev",
  3001: "Node/Alt", 3306: "MySQL", 3389: "RDP", 5432: "PostgreSQL",
  5900: "VNC", 6379: "Redis", 8000: "HTTP-alt", 8008: "HTTP-alt", 8080: "HTTP-proxy",
  8081: "HTTP-alt", 8443: "HTTPS-alt", 8888: "HTTP-alt", 9000: "Portainer/PHP-FPM",
  9090: "Prometheus/Cockpit", 9200: "Elasticsearch", 11211: "Memcached",
  20618: "x-ui panel", 27017: "MongoDB"
};

if (!host) {
  console.error("usage: node tools/portcheck.js <ip> [comma-separated ports]");
  process.exit(1);
}

function check(port) {
  return new Promise(function (resolve) {
    const net = require("net");
    const sock = new net.Socket();
    let done = false;
    const finish = function (open) {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) { }
      resolve({ port: port, open: open });
    };
    sock.setTimeout(2500);
    sock.once("connect", function () { finish(true); });
    sock.once("timeout", function () { finish(false); });
    sock.once("error", function () { finish(false); });
    sock.connect(port, host);
  });
}

(async function () {
  console.log("Scanning " + host + " (" + PORTS.length + " ports)...\n");
  const results = [];
  /* limited concurrency to stay polite/fast */
  const queue = PORTS.slice();
  const workers = Array.from({ length: 32 }, async function () {
    while (queue.length) {
      const port = queue.shift();
      results.push(await check(port));
    }
  });
  await Promise.all(workers);

  results.sort(function (a, b) { return a.port - b.port; });
  const open = results.filter(function (r) { return r.open; });
  if (!open.length) {
    console.log("No open ports found (host down, firewalled, or filtered).");
  } else {
    console.log("OPEN ports:");
    open.forEach(function (r) {
      console.log("  " + String(r.port).padEnd(6) + (NAMES[r.port] || "unknown service"));
    });
  }
  const filtered = results.length - open.length;
  console.log("\n" + open.length + " open, " + filtered + " closed/filtered");
})();
