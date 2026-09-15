# HPP Salary Calculator

A client-side salary calculator for HPP (Czech full-time contracts) with shift planning —
day / night shifts, overtime, vacation, sick leave, doctor visits and Czech public-holiday
pay. Built for Amazon BRQ warehouse workers (Adecco contract) and **calibrated against real
payslips** — every formula below is reverse-engineered from actual výplatní pásky and
reproduces them to the crown. Pure HTML/CSS/JS frontend (no build step), plus a small
zero-dependency Node.js API over the same payroll core.

Available in **Русский**, **Українська**, **English**, **Čeština** and **Polski**.

## Features

- **Calendar view** — the only shift editor: **click a day** to open its settings
  (shift type, overtime, lateness, holiday choice) in a mini dropdown; on mobile it
  becomes a bottom sheet
- **Paint brush** — with the brush active, **drag** across days to paint them
  (a plain click still opens the day editor); totals update live while you paint
- **Day types** — `volno` (day off), `den` / `noc` (day/night shift), `pulden`
  (half shift), `dovolena` (vacation), `svatek` (holiday at home), `nemoc` (sick
  leave DPN), `prek` (doctor visit / překážky dle ZP — half or full paid day),
  `neplac` (unpaid absence day)
- **Lateness per day** — enter hours late on any shift: it cuts only the base pay
  (časová mzda); night/weekend/holiday supplements are still paid for the full shift,
  exactly like the payslip does
- **Attendance bonus (dohazkový bonus)** — tiered by attendance share:
  **100 % → 10 %**, **≥ 90 % → 6 %**, **≥ 85 % → 2 %**, below → 0. The amount is
  `floor(pct × planned fond × base rate)` — the planned fond (roster shifts × shift
  hours) is never reduced by lateness; only full unpaid days leave the share fond.
  A **výtka/ADAPT toggle** voids the month's bonus, and an optional fixed-amount
  override lives in advanced settings
- **PHV auto-compute (⚡)** — one click computes the PHV (průměrný hodinový výdělek,
  §351 ZP) from the previous quarter's painted months: pay-for-work ÷ worked hours
- **Roster pattern learning** — paint one full month and the app learns your rotation
  (Amazon weeks start on **Sunday**, 4-week blocks, type change starts a new block)
  and **auto-fills** the rest of the calendar; predicted days are dimmed, never teach
  the pattern back, and overtime days never pollute the template. **Reset buttons**
  clear a single month or wipe the whole auto-fill if the roster ever goes sideways
- **Automatic public holidays** — Czech holidays (Easter computed algorithmically) are
  detected from the calendar; a day/night shift falling on a holiday gets the holiday
  supplement automatically
- **Holiday choice per law (zákoník práce)** — when a shift touches a public holiday
  you choose: **work it** (normal pay + holiday supplement) or **stay home**
  (náhrada mzdy at the average PHV rate, no supplements)
- **Personal rates** — base hourly rate and PHV rate right on the main screen; everyone
  in the company can have their own. Advanced parameters (paid hours, bonus tiers)
  live in the settings panel; everything is editable and resettable
- **Gross → net estimate** — Czech withholdings: 4.5 % health, 7.1 % social, 15 %
  income tax with the taxpayer credit; sick-leave náhrada is booked outside gross
  (net-only), and advances (mimořádné zálohy) reduce only the payout
- **Privacy by design** — data lives only in your browser; fonts are self-hosted (zero
  requests to Google); optional self-hosted [Umami](https://umami.is) analytics
  (no cookies, no personal data, no cookie banner needed)
- **Autosave** — everything persists in `localStorage`, per month
- **Print / PDF** — payslip-style printout with a detailed per-day breakdown (🖨 button)
- **REST API** — calculate payroll for any month from your own tools/scripts
- **i18n** — RU / UK / EN / CS / PL, auto-detected from the browser, switchable in the UI
- **Tested against real payslips** — `test-calibration.js` replays five actual výplatní
  pásky (05–08/2026) and asserts every line to the crown: 100+ checks

## The pay model (as proven by payslips)

- Base rate × shift hours (default 9.6667 h) = časová mzda; lateness reduces only this
- Supplements from the **PHV** rate: night 10 % (≈ 5.667 h/night), weekend 10 %,
  holiday 100 %, overtime 25 % — always on the **full** shift hours
- PHV = previous quarter's pay-for-work ÷ worked hours (recalculated quarterly by payroll)
- Vacation / holiday-at-home: náhrada at full PHV; sick leave: 60 % of reduced PHV,
  booked net-only; doctor day (překážky): half shift at full PHV (or full shift with
  the "full day" option), the rest unpaid
- Attendance bonus: tier % × **planned** fond × base rate, rounded down (see above)

## Quick start

### Frontend only (no server needed)

Open `index.html` in a browser, or serve the folder statically:

```bash
npx serve .        # or: python -m http.server
```

The app works fully offline; data stays in your browser.

### With the API

Requires Node.js 18+ (no npm install — zero dependencies):

```bash
npm start          # node api/server.js
# app: http://localhost:3000/
```

Set a custom port with `PORT=8080 npm start`. The server binds to localhost only
by default; expose it on your network with `HOST=0.0.0.0 npm start`.

### Running the tests

```bash
node test-calibration.js
```

Replays the payslip calibration suite (pay math, PHV, bonus tiers, roster pattern,
lateness, doctor days, five real months). All checks must pass.

## Project structure

```
├── index.html          # markup
├── css/
│   └── styles.css      # Amazon/A-to-Z-inspired theme, calendar grid, dropdown, brush
├── js/
│   ├── locales.js      # RU / UK / EN / CS / PL dictionaries (shared with the API)
│   ├── i18n.js         # i18n engine: lookup, plurals, escaping, locale formatting
│   ├── payroll.js      # core math: holidays, calcDay, bonus, pattern, netto (UMD)
│   ├── calendar.js     # calendar month view, dropdown picker, paint brush
│   └── app.js          # state, persistence, rendering, events
├── api/
│   └── server.js       # zero-dependency Node server: static files + REST API
├── test-calibration.js # payslip calibration test suite (node test-calibration.js)
├── package.json
├── LICENSE             # MIT
└── README.md
```

## API

Base URL: `http://localhost:3000` (CORS is open — you can also call it from other origins).

### `GET /api/health`

```bash
curl http://localhost:3000/api/health
# → {"status":"ok","service":"hpp-salary-calculator","time":"…"}
```

### `GET /api/holidays?year=2026&lang=uk`

Czech public holidays for a year, localized (`lang`: `ru`, `uk`, `en`, `cs`, `pl`;
default `en`).

```json
{
  "year": 2026,
  "lang": "uk",
  "holidays": [
    { "key": "jan1", "date": "2026-01-01", "name": "День відновлення незалежності чеської держави" }
  ]
}
```

### `POST /api/calculate`

Body:

```json
{
  "year": 2026,
  "month": 7,
  "lang": "ru",
  "settings": { "baseRate": 218 },
  "shifts": [
    { "type": "den", "overtime": false, "holidayWork": true },
    { "type": "noc", "overtime": true, "lateHours": 1.5 },
    { "type": "prek", "prekFull": false }
  ]
}
```

- `settings` is optional — any subset of the defaults can be overridden.
- `shifts` is an array of entries with:
  - `"type"`: `volno | den | noc | pulden | dovolena | svatek | nemoc | prek | neplac`
  - `"overtime"` (bool, `den`/`noc` only) — paid at base + 25 % of PHV
  - `"holidayWork"` (bool, default `true`) — what happens when the shift touches a
    public holiday: `true` = worked → normal pay + holiday supplement in column `N`;
    `false` = stayed home → náhrada at the PHV average, no supplements
  - `"lateHours"` (number) — hours late; cuts only the base pay, never the supplements
    or the planned fond
  - `"prekFull"` (bool, `prek` only) — full paid doctor day instead of half
  - `"predicted"` (bool) — auto-filled days; they never teach the roster pattern

  Missing entries default to `volno`; the array is padded/truncated to the month length.

Response: per-day rows (`F`…`P`, `E` — same letters as the Excel sheet), month totals and a
net estimate.

```json
{
  "year": 2026,
  "month": 7,
  "days": [
    {
      "day": 6, "date": "2026-07-06", "type": "den", "overtime": false, "holidayWork": true,
      "weekend": false, "holiday": "День Яна Гуса",
      "F": 9.6667, "G": 0, "H": 0, "I": "ANO",
      "J": 2107.33, "K": 0, "L": 0, "M": 0, "N": 2378.68, "O": 0, "P": 210.73,
      "E": 4696.74
    }
  ],
  "totals": { "F": 9.67, "G": 0, "H": 0, "J": 2107.33, "K": 0, "L": 0, "M": 0, "N": 2378.68, "O": 0, "P": 210.73, "E": 4696.74 },
  "netEstimate": 4154
}
```

## Deploy to a VPS

Ready-made configs live in `deploy/` (nginx reverse proxy + systemd unit).
Short version for Ubuntu/Debian:

```bash
# on the VPS
sudo apt update && sudo apt install -y git nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

sudo git clone https://github.com/vl2007s/amazoncalculate.git /var/www/amazoncalculate
sudo cp /var/www/amazoncalculate/deploy/nginx.conf /etc/nginx/sites-available/amazoncalculate
sudo sed -i 's/example.com/yourdomain.com/g' /etc/nginx/sites-available/amazoncalculate
sudo ln -s /etc/nginx/sites-available/amazoncalculate /etc/nginx/sites-enabled/
sudo cp /var/www/amazoncalculate/deploy/amazoncalculate.service /etc/systemd/system/

sudo systemctl daemon-reload && sudo systemctl enable --now amazoncalculate
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com   # free HTTPS
```

Node listens on 127.0.0.1 only; nginx is the public entry point (`TRUST_PROXY=1`
lets the rate limiter see real client IPs). Updates: `git pull && systemctl restart amazoncalculate`.

### Analytics (optional): self-hosted Umami

Privacy-friendly visit counting (unique visitors per day/week/month, busiest days/times,
page views) without cookies, IP storage in plain text or fingerprinting — no cookie
banner needed under GDPR (legitimate interest, Art. 6(1)(f)).

Docker on the same VPS (simplest for one developer):

```bash
sudo mkdir -p /opt/umami
sudo cp deploy/umami.docker-compose.yml /opt/umami/docker-compose.yml
cd /opt/umami
echo "UMAMI_SECRET=$(openssl rand -hex 32)" | sudo tee .env
echo "UMAMI_DB_PASSWORD=$(openssl rand -hex 16)" | sudo tee -a .env
sudo docker compose up -d
```

Then expose it on an analytics subdomain:

```bash
sudo cp deploy/analytics-nginx.conf /etc/nginx/sites-available/analytics
sudo sed -i 's/analytics.example.com/analytics.plp.ink/g' /etc/nginx/sites-available/analytics
sudo ln -s /etc/nginx/sites-available/analytics /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d analytics.plp.ink
```

Final wiring (three small edits):

1. In Umami (`https://analytics.plp.ink`, default login `admin`/`umami` — change it)
   add the website, copy its **website ID**.
2. In `index.html` set `data-website-id` on the analytics `<script>` tag (the `src`
   already points at `analytics.plp.ink`).
3. In `/etc/systemd/system/amazoncalculate.service` uncomment
   `Environment=UMAMI_ORIGIN=https://analytics.plp.ink`, then
   `sudo systemctl daemon-reload && sudo systemctl restart amazoncalculate`.

The calculator's own data (shifts, rates, names) never leaves the browser — the
tracker reports only the page view itself.

## Security notes

The server is dependency-free but not naive:

- static file serving blocks dotfiles/dot-directories (`/.git`, `/.env`) and `node_modules`,
  validates containment via `path.relative` (no traversal, no sibling-prefix bypass), and
  never follows symlinks/junctions out of the tree (`lstat` + `realpath` containment)
- malformed URLs (`/%`) and control characters (NUL bytes etc.) get a 400 instead of
  crashing the process; HEAD is supported
- `POST /api/calculate` accepts settings through a strict key whitelist — only known
  numeric fields, coerced to finite numbers (no prototype pollution, no `NaN` in responses)
- request bodies are capped at 100 KB; `/api/*` endpoints have a simple in-memory
  rate limit (120 req/min per IP; per-process, fine at this scale)
- tight request/headers timeouts (slowloris mitigation), malformed HTTP gets a clean 400,
  and a per-request try/catch turns unexpected errors into a 500 instead of a crash
- responses carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and a Content-Security-Policy

## Adding a language

1. Add a block to `js/locales.js` (copy `en` and translate the values).
2. Add an `<option>` to the language `<select>` in `index.html`.

Plural rules for a new language go into `plural()` in `js/i18n.js`.

## Disclaimer

The net-salary figure is an **estimate** for orientation only — not an official payslip.
The model is calibrated against real Adecco/Amazon BRQ payslips, but verify against
current Czech law and your own výplatní páska before relying on it.

## License

[MIT](LICENSE) — code by Vladyslav Simonov · [t.me/vl2007s](https://t.me/vl2007s)
