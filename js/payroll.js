/**
 * Core payroll math — 1:1 port of the "Vypocet" sheet from Kalkulator_mzdy_HPP.xlsx,
 * extended with automatic public-holiday handling per the Czech labour code:
 *
 *   - a den/noc shift that touches a public holiday gets the holiday supplement (N)
 *     AUTOMATICALLY — no manual "svatek" day type needed anymore
 *   - each such day carries a per-day choice (opts.holidayWork):
 *       true  -> worked the holiday: normal pay + holiday supplement (double pay)
 *       false -> stayed home (náhrada mzdy): paid average earnings (F x phvRate),
 *                no supplements, no attendance bonus
 *
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

  /** Company-wide defaults (from the workbook, list "Nastaveni"; rates verified
   *  against real Adecco/Amazon BRQ payslips 05–08/2026).
   *  attendanceBonusPct = 10 % of the base pay of worked shifts — reproduces the
   *  full-month "Pracovní odměna" exactly (06/2026: 218 × 174 h × 10 % = 3 793).
   *  Real payouts are reduced by absences in ways that do NOT follow hour math
   *  (05: 908, 07: 2 149), so for exact reconciliation enter the payslip amount
   *  into bonusMonthKc — it then REPLACES the percentage formula. */
  const DEFAULT_SETTINGS = {
    baseRate: 218,
    phvRate: 246.06,
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
    attendanceBonusPct: 0.10,
    bonusMonthKc: 0,
    /* warning letter / ADAPT in this month — voids the whole attendance bonus
     * (agency slide: výtka nebo písemné upozornění ADAPT ruší měsíční prémii) */
    bonusVoid: false
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
    { group: "g_bonuses", key: "attendanceBonusPct", unit: "u_pct", step: 0.001, pct: true },
    { group: "g_bonuses", key: "bonusMonthKc", unit: "u_kc", step: 1 }
  ];

  /**
   * All shift types the math understands. "svatek" is a legacy type kept only so
   * shifts saved by the old version still calculate the same; the UI no longer
   * offers it — holidays are detected from the calendar automatically.
   */
  const SHIFT_TYPES = ["volno", "den", "noc", "dovolena", "svatek", "pulden", "nemoc"];
  /** Types shown in pickers (svatek handled automatically). */
  const WORK_TYPES = ["volno", "den", "noc", "pulden", "dovolena", "nemoc"];

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
   * PHV reduced by the statutory bands for sick-pay compensation (náhrada mzdy
   * při DPN, § 192 zákoníku práce). Hourly reduction thresholds 2026:
   * 285.78 / 428.58 / 856.98 Kč, credited at 90 / 60 / 30 %; nothing above the
   * third band counts. (Derived from the daily sickness-insurance thresholds
   * 1 633 / 2 449 / 4 897 Kč × 0.175, sdělení MPSV č. 397/2025 Sb.)
   */
  const SICK_BANDS_2026 = [285.78, 428.58, 856.98];
  function reducePhv(phv) {
    const h1 = SICK_BANDS_2026[0], h2 = SICK_BANDS_2026[1], h3 = SICK_BANDS_2026[2];
    return Math.min(phv, h1) * 0.9 +
      Math.max(0, Math.min(phv, h2) - h1) * 0.6 +
      Math.max(0, Math.min(phv, h3) - h2) * 0.3;
  }

  /**
   * Per-day payroll.
   *
   * @param date       Date (local noon-safe — always constructed from y/m/d parts)
   * @param type       shift type from SHIFT_TYPES
   * @param opts       { overtime: bool, holidayWork: bool } — holidayWork says whether the
   *                   employee actually came in when the shift touches a public holiday
   *                   (only meaningful for den/noc; anything not false counts as true)
   * @param s          settings (see DEFAULT_SETTINGS)
   * @param holidayMap dateKey -> holiday name, see buildHolidayMap()
   *
   * Column letters follow the original sheet:
   *   F paid hours | G night hours | H weekend hours | I holiday flag (ANO/NÁH/-)
   *   J base pay | K night bonus | L weekend bonus | M overtime | N holiday bonus
   *   O vacation pay | P attendance bonus | E day total
   */
  function calcDay(date, type, opts, s, holidayMap) {
    opts = opts || {};
    const overtime = !!opts.overtime;
    const holidayWork = opts.holidayWork !== false; /* default: they came in */

    const isDen = type === "den", isNoc = type === "noc", isDov = type === "dovolena",
      isSva = type === "svatek", isVolno = type === "volno",
      isPul = type === "pulden", isNem = type === "nemoc";
    const nextDate = addDays(date, 1);
    const dk = dateKey(date), ndk = dateKey(nextDate);
    const onHoliday = holidayMap.has(dk), nextOnHoliday = holidayMap.has(ndk);

    /* Sick day (DPN, first 14 calendar days): the employer pays 60 % of the
     * reduced PHV for the missed shift's hours (§ 192 ZP). No supplements, no
     * attendance bonus; holidays ignored. Adecco books this compensation fully
     * OUTSIDE the gross: not in hrubá mzda, no SP/ZP insurance, not even taxed —
     * it is simply added to the payout. Verified to the crown on payslip
     * 08/2026 (PHV 237.18): Náhrada Prac.nesch. 19,34 h -> 2 477 Kč paid net,
     * gross 36 831 excludes it, daň 2 965 = 15 % of 36 900 − 2 570,
     * K výplatě 32 069 = 36 831 − 7 239 + 2 477. Carried out via `nem`. */
    if (isNem) {
      const F = s.dayPaidHours; /* day and night shifts are both 9.6667 h */
      const NEM = 0.6 * reducePhv(s.phvRate) * F;
      return {
        F: F, G: 0, H: 0, I: "-", J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, E: 0,
        nem: NEM, exempt: 0, isWeekend: isWeekend(date), holidayName: null,
        isHolidayShift: false, holidayWork: true
      };
    }

    /* lateness (pozdní příchod): unpaid hours off the shift — reduces the time
     * wage AND the counted attendance hours, the planned fond stays whole */
    const late = Math.max(0, Math.min(+opts.lateHours || 0, s.dayPaidHours));

    let F;
    if (isVolno) F = 0;
    else if (isDen) F = s.dayPaidHours - late;
    else if (isPul) F = Math.max(0, s.dayPaidHours / 2 - late); /* poludnevka: half a day shift worked… */
    else if (isDov || isSva) F = s.nightPaidHours; // dovolena, svatek — no lateness
    else F = s.nightPaidHours - late; // noc — matches the original formula

    let G = 0;
    if (isNoc) G = round4((s.nightDayPartNight + s.nightEndPartNight) * F / s.nightPaidHours);

    /* weekend hours account for night shifts crossing midnight into a weekend day */
    let H = 0;
    if (isVolno) H = 0;
    else if (isDen || isPul) H = isWeekend(date) ? F : 0;
    else if (isNoc) H = ((isWeekend(date) ? s.nightDayPart : 0) + (isWeekend(nextDate) ? s.nightEndPart : 0)) * F / s.nightPaidHours;
    else H = isWeekend(date) ? F : 0; // dovolena, svatek

    /* a real shift counts as a holiday shift if any of its paid hours fall on the
     * holiday — for nights that's the start day OR the spillover end day */
    const isHolidayShift = (isDen || isNoc || isPul) && (onHoliday || (isNoc && nextOnHoliday));

    /* náhrada mzdy: the shift fell on a holiday but the employee stayed home.
     * Paid average earnings for the shift hours, nothing else — no supplements,
     * no overtime, no attendance bonus (zákoník práce § 115). A poludnevka keeps
     * its second half — the paid vacation hours are unaffected by the holiday. */
    if (isHolidayShift && !holidayWork) {
      const J = F * s.phvRate;
      const O = isPul ? F * s.phvRate : 0;
      return {
        F: F, G: 0, H: 0, I: "NÁH", J: J, K: 0, L: 0, M: 0, N: 0, O: O, P: 0, E: J + O,
        nem: 0, exempt: 0, isWeekend: isWeekend(date), holidayName: holidayMap.get(dk) || null,
        isHolidayShift: true, holidayWork: false
      };
    }

    let I;
    if (isSva || isHolidayShift) I = "ANO";
    else I = "-";

    let J;
    if (isDov) J = 0; else if (isSva) J = F * s.phvRate; else J = F * s.baseRate;

    /* Supplements are statutory minimums computed from the AVERAGE earnings (PHV),
     * not the base rate — zákoník práce § 116 (night), § 118 (weekend), § 114
     * (overtime). Proven by payslip 07/2026: PHV 246.06 vs base 218 —
     * noční 17 h -> 418 Kč = 17 × 246.06 × 10 %, víkend 34.5 h -> 849 Kč. */
    const K = G * s.phvRate * s.nightBonusPct;
    const L = H * s.phvRate * s.weekendBonusPct;

    let M = 0;
    if (overtime && (isDen || isNoc)) M = F * s.phvRate * s.overtimeBonusPct;

    /* holiday supplement (worked case): only for hours actually on the holiday —
     * a night shift gets the bonus just for the holiday portion. Legacy "svatek"
     * rows keep the original split formula. */
    let N = 0;
    if (isSva) {
      const partToday = onHoliday ? s.nightDayPart * F / s.nightPaidHours : 0;
      const partNext = nextOnHoliday ? s.nightEndPart * F / s.nightPaidHours : 0;
      N = s.phvRate * s.holidayBonusMult * (partToday + partNext);
    } else if ((isDen || isPul) && onHoliday) {
      N = s.phvRate * s.holidayBonusMult * F;
    } else if (isNoc && (onHoliday || nextOnHoliday)) {
      const partToday = onHoliday ? s.nightDayPart * F / s.nightPaidHours : 0;
      const partNext = nextOnHoliday ? s.nightEndPart * F / s.nightPaidHours : 0;
      N = s.phvRate * s.holidayBonusMult * (partToday + partNext);
    }

    /* O — náhrady: vacation pays PHV for its hours; a poludnevka adds its second
     * half as paid vacation (payslip 05/2026: 16.5 worked days + dovolená 4.83 h). */
    const O = (isDov || isPul) ? F * s.phvRate : 0;
    let P = 0;
    if (!isDov && !isSva) P = J * s.attendanceBonusPct;

    const E = J + K + L + M + N + O + P;
    return {
      F: F, G: G, H: H, I: I, J: J, K: K, L: L, M: M, N: N, O: O, P: P, E: E,
      nem: 0, exempt: 0, isWeekend: isWeekend(date), holidayName: onHoliday ? holidayMap.get(dk) : null,
      isHolidayShift: isHolidayShift, holidayWork: holidayWork
    };
  }

  /** Net from gross — Czech withholdings, statutory rounding included:
   *  - health: total 13.5% rounded UP to whole Kč, employee pays 1/3 (rounded UP)
   *  - social: 7.1% rounded UP to whole Kč
   *  - tax: base rounded UP to whole 100 Kč, 15%, minus the monthly taxpayer
   *    credit 2 570 Kč (30 840 Kč/year, valid 2022–2026; previous 3 267 was wrong)
   *  Verified against official worked examples (e.g. gross 28 520 -> SP 2 025,
   *  ZP 1 284; gross 40 000 -> net 31 930). */
  function calcNetto(gross, insurable) {
    return calcNettoDetail(gross, insurable).net;
  }

  /** Same math as calcNetto, but with the components exposed — the printable
   * payslip sheet lists the deductions line by line like Adecco does. */
  function calcNettoDetail(gross, insurable) {
    /* insurable = part of gross subject to SP/ZP (defaults to the whole gross).
     * Sick-pay compensation (náhrada mzdy při DPN) is taxed but NOT insured. */
    const ins = (typeof insurable === "number" && isFinite(insurable)) ? insurable : gross;
    const zdrav = Math.ceil(Math.ceil(ins * 0.135) / 3);
    const socialni = Math.ceil(ins * 0.071);
    const zaklad = Math.ceil(gross / 100) * 100;
    const dan = Math.max(0, round0(zaklad * 0.15) - 2570);
    return { zaklad: zaklad, zdrav: zdrav, socialni: socialni, dan: dan, net: gross - zdrav - socialni - dan };
  }

  /**
   * Fixed monthly bonus override ("Pracovní odměna" from the payslip). When
   * bonusKc > 0 it REPLACES the percentage attendance formula: the amount is
   * split evenly over days with J > 0 (actually worked shifts), P is set to the
   * share (not added on top) and E adjusted accordingly. Returns a NEW array;
   * the input is never mutated. bonusKc <= 0 -> percentage formula stays as-is.
   */
  /* ============ Attendance bonus (docházkový bonus) ============
   * Agency rules: the bonus % depends on the share of counted hours vs the
   * month's planned fond. Tiers: 100 %+ -> 10 %, 90–99 % -> 6 %,
   * 85–89 % -> 2 %, below -> 0.
   * Counted as worked: the worked hours themselves (net of lateness), vacation
   * (dovolená, incl. the pulden half) and employer-side obstacles (překážky,
   * holiday-stayed-home náhrada). Sick leave stays in the fond but does NOT
   * count. An extra shift outside the roster pushes the share past 100 % —
   * that is how an announced overtime day saves the bonus. */
  const BONUS_TIERS = [[1.0, 0.10], [0.90, 0.06], [0.85, 0.02], [0, 0]];
  function bonusTier(share) {
    for (let i = 0; i < BONUS_TIERS.length; i++) {
      if (share >= BONUS_TIERS[i][0] - 0.0005) return BONUS_TIERS[i][1];
    }
    return 0;
  }

  /** @param fondDays planned shift days in the month (from the detected roster
   *  pattern); 0/null -> fall back to the painted scheduled days */
  function attendanceInfo(results, shifts, s, fondDays) {
    const shiftH = s.dayPaidHours;
    let counted = 0, paintedFond = 0;
    results.forEach(function (r, i) {
      const t = shifts[i] ? shifts[i].type : "volno";
      if (t === "den" || t === "noc") counted += r.F; /* net of lateness */
      else if (t === "pulden") counted += r.F + shiftH / 2; /* worked half + vacation half */
      else if (t === "dovolena" || t === "svatek") counted += shiftH;
      /* nemoc: fond keeps the hours, the share gets nothing */
      if (t !== "volno") paintedFond += shiftH;
    });
    const fond = fondDays > 0 ? fondDays * shiftH : paintedFond;
    const share = fond > 0 ? counted / fond : 1;
    return { fond: fond, counted: counted, share: share, pct: bonusTier(share) };
  }

  /** Applies the tier model: rescales the flat per-day formula P to the tier
   *  percent. The fixed monthly amount (bonusMonthKc > 0) overrides tiers. */
  function withAttendanceBonus(results, shifts, s, fondDays) {
    if (s.bonusVoid) {
      return results.map(function (r) {
        if (!r.P) return r;
        const n = Object.assign({}, r);
        n.P = 0;
        n.E = r.E - r.P;
        return n;
      });
    }
    if (s.bonusMonthKc > 0) return withMonthlyBonus(results, s.bonusMonthKc);
    const info = attendanceInfo(results, shifts, s, fondDays);
    const base = s.attendanceBonusPct > 0 ? s.attendanceBonusPct : 0.10;
    if (Math.abs(info.pct - base) < 1e-9) return results;
    return results.map(function (r) {
      if (!(r.P > 0)) return r;
      const copy = Object.assign({}, r);
      const newP = (r.P / base) * info.pct;
      copy.E += newP - copy.P;
      copy.P = newP;
      return copy;
    });
  }

  /* ============ Roster pattern (4 weeks day / 4 weeks night) ============
   * Detected from how the user paints the calendar — no configuration needed.
   * A type change immediately starts a new 4-week block: 3 painted weeks of
   * days + 1 week of nights means 3 more night weeks follow, then 4 day weeks.
   * Blocks alternate every 4 weeks in both directions, so any past or future
   * month can be predicted (used for autofill and the approximate PHV). */
  function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }

  /* The roster is learned from a FULLY painted month (>= 7 scheduled days over
   * >= 3 distinct weeks). The most recent complete month is the template — if
   * the worker's roster changed, the newer month overrides the older one.
   * A weekday joins the pattern when painted at least twice in that month, so
   * one-off shift swaps never distort the roster. Until a complete month
   * exists there is no pattern — no guessing from scraps. */
  function detectPattern(monthsData) {
    const weeks = {}; /* monday dateKey -> {mon, den, noc} votes */
    let roster = null, rosterEnd = 0; /* weekday template + its month */
    monthsData.forEach(function (md) {
      const wdCount = [0, 0, 0, 0, 0, 0, 0];
      let painted = 0;
      const weekSet = {};
      md.shifts.forEach(function (sh, i) {
        /* predicted (auto-filled forecast) days never teach the pattern */
        if (!sh.type || sh.type === "volno" || sh.predicted) return;
        const d = new Date(md.year, md.month, i + 1);
        wdCount[d.getDay()]++;
        painted++;
        const mon = mondayOf(d);
        weekSet[dateKey(mon)] = true;
        const k = dateKey(mon);
        if (!weeks[k]) weeks[k] = { mon: mon, den: 0, noc: 0 };
        if (sh.type === "noc") weeks[k].noc++;
        else if (sh.type === "den" || sh.type === "pulden") weeks[k].den++;
        /* nemoc/dovolena prove the weekday was scheduled, but the underlying
         * shift type is unknown — they don't vote for the block type */
      });
      const monthEnd = new Date(md.year, md.month + 1, 0).getTime();
      if (painted >= 7 && Object.keys(weekSet).length >= 3 && monthEnd >= rosterEnd) {
        const wd = [];
        for (let w = 0; w < 7; w++) if (wdCount[w] >= 2) wd.push(w);
        if (wd.length) { roster = wd; rosterEnd = monthEnd; }
      }
    });
    const keys = Object.keys(weeks).sort();
    if (!keys.length || !roster) return null;
    const weekdays = roster;
    /* anchor = most recent painted week with type votes; walk back while the
     * dominant type holds (consecutive Mondays only — a gap week ends it) */
    let anchorType = null, anchorMon = null, blockWeeks = 0;
    for (let k = keys.length - 1; k >= 0 && blockWeeks < 4; k--) {
      const wk = weeks[keys[k]];
      if (anchorMon && Math.round((anchorMon - wk.mon) / (7 * 864e5)) !== blockWeeks) break;
      if (wk.den + wk.noc === 0) break;
      const t = wk.noc > wk.den ? "noc" : "den";
      if (anchorType === null) { anchorType = t; anchorMon = wk.mon; }
      if (t !== anchorType) break;
      blockWeeks++;
    }
    if (!anchorType) {
      /* painted only nemoc/dovolena — default to day shifts */
      anchorType = "den"; anchorMon = weeks[keys[keys.length - 1]].mon; blockWeeks = 1;
    }
    return { weekdays: weekdays, type: anchorType, anchorMonday: anchorMon, blockWeeks: blockWeeks };
  }

  /** Predicted shift type for a date under the detected roster. */
  function predictType(date, pattern) {
    if (!pattern || pattern.weekdays.indexOf(date.getDay()) === -1) return "volno";
    const weeksDiff = Math.round((mondayOf(date) - pattern.anchorMonday) / (7 * 864e5));
    const blockIdx = Math.floor((pattern.blockWeeks - 1 + weeksDiff) / 4);
    const even = ((blockIdx % 2) + 2) % 2 === 0;
    return even ? pattern.type : (pattern.type === "den" ? "noc" : "den");
  }

  /** Planned shift days in a month under the roster pattern. */
  function countFondDays(year, month, weekdays) {
    let n = 0;
    const dim = daysInMonth(year, month);
    for (let d = 1; d <= dim; d++) {
      if (weekdays.indexOf(new Date(year, month, d).getDay()) !== -1) n++;
    }
    return n;
  }

  function withMonthlyBonus(results, bonusKc) {
    if (!(bonusKc > 0)) return results;
    const worked = results.filter(function (r) { return r.J > 0; });
    if (!worked.length) return results;
    const share = bonusKc / worked.length;
    return results.map(function (r) {
      if (r.J <= 0) return r;
      const copy = Object.assign({}, r);
      copy.E += share - copy.P; /* swap formula bonus for the fixed share */
      copy.P = share;
      return copy;
    });
  }

  /** Sum a per-day result array into month totals (column letters again). */
  /** PHV (průměrný hodinový výdělek) from computed days — § 351+ zákoník práce:
   * gross pay for WORK in the reference quarter ÷ hours worked. Náhrady
   * (vacation O, holiday-stayed-home J, sick pay nem) are excluded from both
   * the numerator and the denominator — only actually worked shifts count. */
  function phvFromDays(results) {
    let num = 0, den = 0;
    results.forEach(function (r) {
      const worked = r.J > 0 && !(r.isHolidayShift && r.holidayWork === false);
      if (worked) { num += r.J + r.K + r.L + r.M + r.N + r.P; den += r.F; }
    });
    return den > 0 ? { phv: num / den, hours: den } : null;
  }

  function calcTotals(results) {
    const totals = { F: 0, G: 0, H: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, E: 0, nem: 0, exempt: 0 };
    results.forEach(function (r) {
      Object.keys(totals).forEach(function (k) { totals[k] += (r[k] || 0); });
    });
    totals.E = Math.round(totals.E * 100) / 100;
    return totals;
  }

  /**
   * Schedule presets (Amazon-style rotation patterns). days = weekday numbers
   * (0 = Sunday … 6 = Saturday) that make up the working part of the pattern.
   */
  const SCHEDULE_PRESETS = [
    { key: "front_half", days: [0, 1, 2, 3] },   /* Sun – Wed */
    { key: "back_half", days: [3, 4, 5, 6] },    /* Wed – Sat */
    { key: "donut", days: [1, 2, 4, 5] },        /* Mon, Tue, Thu, Fri */
    { key: "back_half_3", days: [0, 1, 2] },     /* Sun – Tue (3 days) */
    { key: "donut_3", days: [3, 4, 5] },         /* Wed – Fri (3 days) */
    { key: "weekend", days: [6, 0] }             /* Sat, Sun */
  ];

  /**
   * Build a full month of shifts from a preset: pattern days get the given shift
   * type (den/noc), everything else is volno. Unknown preset or shift type yields
   * an all-off month. Pure function — the caller replaces state and re-renders.
   */
  function applySchedule(year, month0, presetKey, type) {
    const preset = SCHEDULE_PRESETS.filter(function (p) { return p.key === presetKey; })[0];
    const isWorkShift = type === "den" || type === "noc";
    const n = daysInMonth(year, month0);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(year, month0, i + 1);
      if (isWorkShift && preset && preset.days.indexOf(d.getDay()) !== -1) {
        out.push({ type: type, overtime: false, holidayWork: true });
      } else {
        out.push({ type: "volno", overtime: false, holidayWork: true });
      }
    }
    return out;
  }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SCHEDULE_PRESETS: SCHEDULE_PRESETS,
    applySchedule: applySchedule,
    SETTINGS_FIELDS: SETTINGS_FIELDS,
    SHIFT_TYPES: SHIFT_TYPES,
    WORK_TYPES: WORK_TYPES,
    daysInMonth: daysInMonth,
    addDays: addDays,
    isWeekend: isWeekend,
    dateKey: dateKey,
    easterSunday: easterSunday,
    computeHolidays: computeHolidays,
    buildHolidayMap: buildHolidayMap,
    calcDay: calcDay,
    calcNetto: calcNetto,
    calcNettoDetail: calcNettoDetail,
    calcTotals: calcTotals,
    reducePhv: reducePhv,
    phvFromDays: phvFromDays,
    bonusTier: bonusTier,
    attendanceInfo: attendanceInfo,
    withAttendanceBonus: withAttendanceBonus,
    detectPattern: detectPattern,
    predictType: predictType,
    countFondDays: countFondDays,
    withMonthlyBonus: withMonthlyBonus,
    round4: round4,
    round0: round0
  };
});
