# HPP Salary Calculator

A client-side salary calculator for HPP (Czech full-time contracts) with shift planning —
day / night shifts, overtime, vacation, holidays and bonuses. Pure HTML/CSS/JS frontend
(no build step), plus a small zero-dependency Node.js API that exposes the same payroll core.

Available in **Русский**, **Українська**, **English** and **Čeština**.

## Features

- **Calendar view** — plan shifts on a month grid; click any day to pick a shift type
  (off / day / night / vacation / holiday work) and toggle overtime
- **List view** — classic per-day rows with a shift dropdown
- **Payroll math ported 1:1** from the original Excel workbook (`Vypocet` sheet);
  column letters in the API match the sheet
- **Czech public holidays** computed algorithmically (Easter included) for any year
- **Gross → net estimate** (Czech withholdings: 4.5 % health, 7.1 % social, 15 % income tax
  with taxpayer credit)
- **Company rates** — hourly rate, PHV rate, paid night-shift hours, night/weekend/overtime/
  holiday/attendance bonuses; everything editable and resettable to defaults
- **Quick actions** — fill weekdays with day/night shifts, weekends off, clear the month
- **Autosave** — everything persists in `localStorage`, per month
- **Print / PDF** — payslip-style printout with a detailed per-day breakdown
- **REST API** — calculate payroll for any month from your own tools/scripts
- **i18n** — RU / UK / EN / CS, auto-detected from the browser, switchable in the UI

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

## Project structure

```
├── index.html          # markup
├── css/
│   └── styles.css      # styles (calendar grid, popover, print rules)
├── js/
│   ├── locales.js      # RU / UK / EN / CS dictionaries (shared with the API)
│   ├── i18n.js         # i18n engine: lookup, plurals, locale-aware formatting
│   ├── payroll.js      # core math: holidays, calcDay, netto (UMD — browser + Node)
│   ├── calendar.js     # calendar month view + shift picker popover
│   └── app.js          # state, persistence, rendering, events
├── api/
│   └── server.js       # zero-dependency Node server: static files + REST API
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

Czech public holidays for a year, localized (`lang`: `ru`, `uk`, `en`, `cs`; default `en`).

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
    { "type": "den", "overtime": false },
    { "type": "noc", "overtime": true }
  ]
}
```

- `settings` is optional — any subset of the defaults can be overridden.
- `shifts` is an array of `{ "type": "volno|den|noc|dovolena|svatek", "overtime": bool }`.
  Missing entries default to `volno`; the array is padded/truncated to the month length.
  Overtime only applies to `den`/`noc`.

Response: per-day rows (`F`…`P`, `E` — same letters as the Excel sheet), month totals and a
net estimate.

```json
{
  "year": 2026,
  "month": 7,
  "days": [
    {
      "day": 1, "date": "2026-07-01", "type": "den", "overtime": false,
      "weekend": false, "holiday": null,
      "F": 9.6667, "G": 0, "H": 0, "I": "-",
      "J": 2109.33, "K": 0, "L": 0, "M": 0, "N": 0, "O": 0, "P": 210.93,
      "E": 2320.26
    }
  ],
  "totals": { "F": 9.67, "G": 0, "H": 0, "J": 2109.33, "K": 0, "L": 0, "M": 0, "N": 0, "O": 0, "P": 210.93, "E": 2320.26 },
  "netEstimate": 19790
}
```

## Security notes

The server is dependency-free but not naive:

- static file serving blocks dotfiles/dot-directories (`/.git`, `/.env`) and `node_modules`,
  and validates path containment via `path.relative` (no traversal, no sibling-prefix bypass)
- malformed URLs (`/%`) get a 400 instead of crashing the process
- `POST /api/calculate` accepts settings through a strict key whitelist — only known
  numeric fields, coerced to finite numbers (no prototype pollution, no `NaN` in responses)
- request bodies are capped at 100 KB; `/api/*` endpoints have a simple in-memory
  rate limit (120 req/min per IP; per-process, fine at this scale)
- responses carry `X-Content-Type-Options`, `X-Frame-Options` and a Content-Security-Policy
  (Google Fonts is the only third-party origin allowed)

## Adding a language

1. Add a block to `js/locales.js` (copy `en` and translate the values).
2. Add an `<option>` to the language `<select>` in `index.html`.

Plural rules for a new language go into `plural()` in `js/i18n.js`.

## Disclaimer

The net-salary figure is an **estimate** for orientation only — not an official payslip.
Rates and withholdings reflect the company's Excel workbook; verify against current Czech law
before using it for real payroll.

## License

[MIT](LICENSE) — code by Vladyslav Simonov · [t.me/vl2007s](https://t.me/vl2007s)
