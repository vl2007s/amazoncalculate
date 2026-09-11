/**
 * Core payroll math — 1:1 port of the "Vypocet" sheet from Kalkulator_mzdy_HPP.xlsx.
 * Column letters in calcDay() (F..P, E) intentionally match the original sheet so the
 * workbook stays the readable spec for this code.
 *
 * UMD: window.Payroll in the browser, module.exports in Node (the API reuses this file).
 */
(function (root, factory) {
  "use strict";
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.Payroll = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Company-wide defaults (from the workbook, list "Nastaveni"). */
  const DEFAULT_SETTINGS = {
    baseRate: 218,
    phvRate: 246.07,
    nightPaidHours: 9.66666666666667,
    nightDayPart: 5.5,
    nightDayPartNight: 1.5,
    nightEndPart: 4.16666666666667,
    nightEndPartNight: 4.16666666666667,
    dayPaidHours: 9.66666666666667,
    nightBonusPct: 0.10,
    weekendBonusPct: 0.10,
    overtimeBonusPct: 0.25,
    holidayBonusMult: 1,
    attendanceBonusPct: 0.10
  };

  /**
   * UI metadata for the settings form — keeps the form, the API whitelist and the
   * math in sync from a single source. Labels resolve through i18n keys (f_*, g_*).
   * pct: true means the field is edited as a percent (10) but stored as a fraction (0.10).
   */
  const SETTINGS_FIELDS = [
    { group: "g_base", key: "baseRate", unit: "u_kch", step: 0.01 },
    { group: "g_base", key: "phvRate", unit: "u_kch", step: 0.01 },
    { group: "g_day", key: "dayPaidHours", unit: "u_h", step: 0.01 },
    { group: "g_night", key: "nightPaidHours", unit: "u_h", step: 0.01 },
    { group: "g_night", key: "nightDayPart", unit: "u_h", step: 0.01 },
    { group: "g_night", key: "nightDayPartNight", unit: "u_h", step: 0.01 },
    { group: "g_night", key: "nightEndPart", unit: "u_h", step: 0.01 },
    { group: "g_night", key: "nightEndPartNight", unit: "u_h", step: 0.01 },
    { group: "g_bonuses", key: "nightBonusPct", unit: "u_pct", step: 0.001, pct: true },
    { group: "g_bonuses", key: "weekendBonusPct", unit: "u_pct", step: 0.001, pct: true },
    { group: "g_bonuses", key: "overtimeBonusPct", unit: "u_pct", step: 0.001, pct: true },
    { group: "g_bonuses", key: "holidayBonusMult", unit: "u_mult", step: 0.01 },
    { group: "g_bonuses", key: "attendanceBonusPct", unit: "u_pct", step: 0.001, pct: true }
  ];

  /** Canonical shift types; order drives select/popover rendering. */
  const SHIFT_TYPES = ["volno", "den", "noc", "dovolena", "svatek"];

  /* ---------- date helpers ---------- */

  function daysInMonth(year, month0) { return new Date(year, month0 + 1, 0).getDate(); }
  function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
  function isWeekend(d) { const wd = d.getDay(); return wd === 0 || wd === 6; }

  /** Local-date key "YYYY-MM-DD" — used as the holiday map key. */
  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ---------- Czech public holidays ---------- */

  /** Computable Easter (Meeus/Jones/Butcher) — mirrors the Velikonoce calc in the workbook. */
  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const monthNum = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, monthNum - 1, day);
  }

  /**
   * Holiday definitions as {key, dateFn} so names stay out of the math.
   * Keys are resolved to localized strings through the "holidays" i18n block.
   */
  const HOLIDAY_DEFS = [
    { key: "jan1", date: function (y) { return new Date(y, 0, 1); } },
    { key: "goodFriday", date: function (y) { return addDays(easterSunday(y), -2); } },
    { key: "easterMonday", date: function (y) { return addDays(easterSunday(y), 1); } },
    { key: "may1", date: function (y) { return new Date(y, 4, 1); } },
    { key: "may8", date: function (y) { return new Date(y, 4, 8); } },
    { key: "jul5", date: function (y) { return new Date(y, 6, 5); } },
    { key: "jul6", date: function (y) { return new Date(y, 6, 6); } },
    { key: "sep28", date: function (y) { return new Date(y, 8, 28); } },
    { key: "oct28", date: function (y) { return new Date(y, 9, 28); } },
    { key: "nov17", date: function (y) { return new Date(y, 10, 17); } },
    { key: "dec24", date: function (y) { return new Date(y, 11, 24); } },
    { key: "dec25", date: function (y) { return new Date(y, 11, 25); } },
    { key: "dec26", date: function (y) { return new Date(y, 11, 26); } }
  ];

  /** Localized holiday name; falls back to the raw key if a locale misses it. */
  function holidayName(key, lang, locales) {
    const loc = locales && locales[lang];
    if (loc && loc.holidays && loc.holidays[key]) return loc.holidays[key];
    return key;
  }

  /** All holidays for one year with localized names. */
  function computeHolidays(year, lang, locales) {
    return HOLIDAY_DEFS.map(function (h) {
      const date = h.date(year);
      return { key: h.key, date: date, dateKey: dateKey(date), name: holidayName(h.key, lang, locales) };
    });
  }

  /**
   * dateKey -> holiday name for (year - 1, year, year + 1).
   * The extra years matter: a night shift on Dec 31 spills into Jan 1 and the
   * holiday-bonus split needs to know about the next day.
   */
  function buildHolidayMap(year, lang, locales) {
    const map = new Map();
    computeHolidays(year - 1, lang, locales)
      .concat(computeHolidays(year, lang, locales))
      .concat(computeHolidays(year + 1, lang, locales))
      .forEach(function (h) { map.set(h.dateKey, h.name); });
    return map;
  }

  /* ---------- payroll math ---------- */

  /** Round like the workbook: 4 decimals for hour fractions, whole crowns for money. */
  function round4(x) { return Math.round(x * 10000) / 10000; }
  function round0(x) { return Math.round(x); }

  /**
   * Per-day payroll. Column letters follow the original sheet:
   *   F paid hours | G night hours | H weekend hours | I holiday flag (ANO/⚠/-)
   *   J base pay | K night bonus | L weekend bonus | M overtime | N holiday bonus
   *   O vacation pay | P attendance bonus | E day total
   */
  function calcDay(date, type, overtime, s, holidayMap) {
    const isDen = type === "den", isNoc = type === "noc", isDov = type === "dovolena", isSva = type === "svatek", isVolno = type === "volno";
    const nextDate = addDays(date, 1);
    const dk = dateKey(date), ndk = dateKey(nextDate);
    const onHoliday = holidayMap.has(dk), nextOnHoliday = holidayMap.has(ndk);

    let F;
    if (isVolno) F = 0;
    else if (isDen) F = s.dayPaidHours;
    else F = s.nightPaidHours; // noc, dovolena, svatek — matches the original formula

    let G = 0;
    if (isNoc) G = round4((s.nightDayPartNight + s.nightEndPartNight) * F / s.nightPaidHours);

    /* weekend hours account for night shifts crossing midnight into a weekend day */
    let H = 0;
    if (isVolno) H = 0;
    else if (isDen) H = isWeekend(date) ? F : 0;
    else if (isNoc) H = ((isWeekend(date) ? s.nightDayPart : 0) + (isWeekend(nextDate) ? s.nightEndPart : 0)) * F / s.nightPaidHours;
    else H = isWeekend(date) ? F : 0; // dovolena, svatek

    let I;
    if (isSva) I = "ANO"; else if (onHoliday) I = "⚠"; else I = "-";

    let J;
    if (isDov) J = 0; else if (isSva) J = F * s.phvRate; else J = F * s.baseRate;

    const K = G * s.baseRate * s.nightBonusPct;
    const L = H * s.baseRate * s.weekendBonusPct;

    let M = 0;
    if (overtime && (isDen || isNoc)) M = F * s.baseRate * s.overtimeBonusPct;

    /* holiday bonus splits by which side of midnight is the actual holiday */
    let N = 0;
    if (isSva) {
      const partToday = onHoliday ? s.nightDayPart * F / s.nightPaidHours : 0;
      const partNext = nextOnHoliday ? s.nightEndPart * F / s.nightPaidHours : 0;
      N = s.phvRate * s.holidayBonusMult * (partToday + partNext);
    }

    const O = isDov ? F * s.phvRate : 0;
    let P = 0;
    if (!isDov && !isSva) P = J * s.attendanceBonusPct;

    const E = J + K + L + M + N + O + P;
    return { F: F, G: G, H: H, I: I, J: J, K: K, L: L, M: M, N: N, O: O, P: P, E: E, isWeekend: isWeekend(date), holidayName: onHoliday ? holidayMap.get(dk) : null };
  }

  /** Rough net from gross — Czech withholdings (health 4.5%, social 7.1%, 15% tax
   *  with the monthly taxpayer credit, rounded like payroll software does). */
  function calcNetto(gross) {
    const zdrav = round0(gross * 0.045);
    const socialni = round0(gross * 0.071);
    const zaklad = Math.ceil(gross / 100) * 100;
    const dan = Math.max(0, round0(zaklad * 0.15) - 3267);
    return gross - zdrav - socialni - dan;
  }

  /** Sum a per-day result array into month totals (column letters again). */
  function calcTotals(results) {
    const totals = { F: 0, G: 0, H: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, E: 0 };
    results.forEach(function (r) {
      Object.keys(totals).forEach(function (k) { totals[k] += r[k]; });
    });
    totals.E = Math.round(totals.E * 100) / 100;
    return totals;
  }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SETTINGS_FIELDS: SETTINGS_FIELDS,
    SHIFT_TYPES: SHIFT_TYPES,
    daysInMonth: daysInMonth,
    addDays: addDays,
    isWeekend: isWeekend,
    dateKey: dateKey,
    easterSunday: easterSunday,
    computeHolidays: computeHolidays,
    buildHolidayMap: buildHolidayMap,
    calcDay: calcDay,
    calcNetto: calcNetto,
    calcTotals: calcTotals,
    round4: round4,
    round0: round0
  };
});
