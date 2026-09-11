# HPP Salary Calculator

A client-side salary calculator for HPP (Czech full-time contracts) with shift planning —
day / night shifts, overtime, vacation and Czech public-holiday pay. Pure HTML/CSS/JS
frontend (no build step), plus a small zero-dependency Node.js API over the same payroll core.

Available in **Русский**, **Українська**, **English** and **Čeština**.

## Features

- **Calendar view** — plan shifts on a month grid; click any day to open a mini dropdown:
  shift type (off / day / night / vacation), overtime, and the holiday choice.
  On mobile the dropdown becomes a bottom sheet
- **Paint brush** — pick a shift and click or drag across days to paint them in
- **List view** — classic per-day rows with shift and holiday dropdowns
- **Automatic public holidays** — Czech holidays (Easter computed algorithmically) are
  detected from the calendar; a day/night shift falling on a holiday gets the holiday
  supplement automatically — no manual "holiday" day type needed
- **Holiday choice per law (zákoník práce)** — when a shift touches a public holiday you choose:
  - **Work it** — normal pay + holiday supplement (double pay for those hours)
  - **Stay home** — náhrada mzdy: the shift is paid at the average PHV rate, no supplements
- **Personal rates** — base hourly rate and PHV rate right on the main screen; everyone in
  the company can have their own. Advanced parameters (paid hours, bonus percentages) live
  in the settings panel; everything is editable and resettable
- **Payroll math ported 1:1** from the original Excel workbook (`Vypocet` sheet);
  column letters in the API match the sheet
- **Gross → net estimate** (Czech withholdings: 4.5 % health, 7.1 % social, 15 % income tax
  with taxpayer credit)
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
│   └── styles.css      # Amazon/A-to-Z-inspired theme, calendar grid, dropdown, brush
├── js/
│   ├── locales.js      # RU / UK / EN / CS dictionaries (shared with the API)
│   ├── i18n.js         # i18n engine: lookup, plurals, escaping, locale formatting
│   ├── payroll.js      # core math: holidays, calcDay, netto (UMD — browser + Node)
│   ├── calendar.js     # calendar month view, dropdown picker, paint brush
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
    { "type": "den", "overtime": false, "holidayWork": true },
    { "type": "noc", "overtime": true }
  ]
}
```

- `settings` is optional — any subset of the defaults can be overridden.
- `shifts` is an array of `{ "type": "volno|den|noc|dovolena|svatek", "overtime": bool, "holidayWork": bool }`.
  Missing entries default to `volno`; the array is padded/truncated to the month length.
  Overtime and `holidayWork` only apply to `den`/`noc`.
- `holidayWork` (default `true`) decides what happens when the shift touches a public holiday:
  `true` = worked → normal pay + holiday supplement in column `N`; `false` = stayed home →
  the day is paid at the PHV average (`J = F × phvRate`) with no supplements.

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

## Security notes

The server is dependency-free but not naive:

- static file serving blocks dotfiles/dot-directories (`/.git`, `/.env`) and `node_modules`,
  and validates path containment via `path.relative` (no traversal, no sibling-prefix bypass)
- malformed URLs (`/%`) get a 400 instead of crashing the process; HEAD is supported
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
