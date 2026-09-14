/* Calibration test — reproduces real Adecco/Amazon BRQ payslips 05–07/2026
 * and verifies the new pulden/nemoc day types. Run: node test-calibration.js */
"use strict";
const Payroll = require("./js/payroll.js");
const LOCALES = require("./js/locales.js");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name); }
}
function close(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.51 : tol); }

const S = Object.assign({}, Payroll.DEFAULT_SETTINGS);
const hol = Payroll.buildHolidayMap(2026, "en", LOCALES);
function day(y, m, d, type, opts, s) {
  return Payroll.calcDay(new Date(y, m - 1, d), type, opts || {}, s || S, hol);
}

/* --- 1. Netto reproduces payslips exactly (čistá mzda) --- */
ok(Payroll.calcNetto(41088) === 32726, "netto 41088 -> 32726 (payslip 05/2026)");
ok(Payroll.calcNetto(44607) === 35296, "netto 44607 -> 35296 (payslip 06/2026)");
ok(Payroll.calcNetto(43673) === 34621, "netto 43673 -> 34621 (payslip 07/2026)");

/* --- 2. Supplements use PHV, not base (payslip 07/2026: PHV 246.06 vs base 218) --- */
const S3 = Object.assign({}, S, { phvRate: 246.06 });
const noc = day(2026, 7, 6, "noc"); /* Monday night */
ok(close(noc.G, 5.6667, 0.001) && close(noc.K, 5.6667 * 246.06 * 0.1, 0.05),
  "night bonus from PHV: K=" + noc.K.toFixed(2) + " (was 123.40 from base)");

/* weekend day shift: L = H x PHV x 10% — 34.5 h -> 849 Kč on the payslip */
const sat = day(2026, 7, 4, "den", {}, S3); /* Saturday */
ok(close(sat.H, 9.6667, 0.001) && close(sat.L, 9.6667 * 246.06 * 0.1, 0.05),
  "weekend bonus from PHV: L=" + sat.L.toFixed(2));
ok(close(34.5 * 246.06 * 0.1, 849, 0.5) && close(17 * 246.06 * 0.1, 418, 0.5),
  "payslip lines: víkend 34.5h->849, noční 17h->418");

/* holiday supplement = 100 % PHV — svátek 19.34 h -> 4 759 Kč */
ok(close(19.34 * 246.06, 4759, 1), "holiday: 19.34h x PHV 246.06 -> ~4759");

/* --- 3. Overtime bonus from PHV (legal min § 114) --- */
const ot = day(2026, 7, 7, "den", { overtime: true }, S3);
ok(close(ot.M, 9.6667 * 246.06 * 0.25, 0.05), "overtime 25% of PHV: M=" + ot.M.toFixed(2));

/* --- 4. Pulden: half shift + half paid vacation (payslip 05/2026) --- */
const pul = day(2026, 5, 12, "pulden", {}, Object.assign({}, S, { phvRate: 218 }));
ok(close(pul.F, 4.8333, 0.001), "pulden F=4.8333 (half of 9.6667)");
ok(close(pul.J, 4.8333 * 218, 0.05) && close(pul.O, 4.8333 * 218, 0.05),
  "pulden J=O=1053.66 at 218 (payslip: dovolená 4.83h -> 1053)");
const pulQ3 = day(2026, 7, 8, "pulden", {}, S3);
ok(close(pulQ3.E, 4.8333 * 218 * 1.1 + 4.8333 * 246.06, 0.1),
  "pulden Q3: E=" + pulQ3.E.toFixed(2) + " (base half x1.1 attendance + PHV half)");

/* --- 5. Nemoc: 60 % of reduced PHV, paid fully outside the gross (08/2026) --- */
ok(close(Payroll.reducePhv(350), 295.734, 0.001), "reducePhv(350)=295.734 (official example)");
ok(close(Payroll.reducePhv(246.06), 221.454, 0.001), "reducePhv(246.06)=221.454 (all in band 1, x0.9)");
const nem = day(2026, 7, 9, "nemoc", {}, S3);
ok(nem.J === 0 && nem.K === 0 && nem.L === 0 && nem.M === 0 && nem.N === 0 && nem.P === 0,
  "nemoc: no base pay, no supplements");
ok(nem.E === 0 && nem.O === 0 && close(nem.nem, 0.6 * 221.454 * 9.6667, 0.1),
  "nemoc: E=O=0, nem (netto náhrada)=" + nem.nem.toFixed(2));
const nemTotals = Payroll.calcTotals([nem]);
ok(nemTotals.E === 0 && close(nemTotals.nem, nem.nem, 0.001),
  "nemoc: totals E=0 (gross untouched), náhrada carried in nem");

/* --- 5b. Colleague payslip 08/2026 (PHV 237.18): gross EXCLUDES náhrada --- */
const SC = Object.assign({}, Payroll.DEFAULT_SETTINGS, { baseRate: 218, phvRate: 237.18 });
const cal8 = {};
[2, 3, 4, 5, 9, 10, 11, 16, 17, 18, 19].forEach(function (d) { cal8[d] = "noc"; });
cal8[12] = "pulden"; [23, 24, 30, 31].forEach(function (d) { cal8[d] = "den"; });
cal8[25] = "nemoc"; cal8[26] = "nemoc";
const res8 = Object.keys(cal8).map(function (d) { return day(2026, 8, +d, cal8[d], {}, SC); });
const t8 = Payroll.calcTotals(res8);
const nemSum8 = res8.reduce(function (a, r) { return a + r.nem; }, 0);
ok(close(t8.J, 32663, 0.8), "08/2026 časová mzda 32 663 (149,83 h x 218) — ours " + t8.J.toFixed(2));
ok(close(t8.L, 850, 0.6), "08/2026 víkend 850 (35,83 h) — ours " + t8.L.toFixed(2));
ok(close(t8.K, 1498, 20.5), "08/2026 noční 1 498 (63,17 h) — ours " + t8.K.toFixed(2) + " (night-window ~20 Kč)");
ok(close(nemSum8, 2477, 1.0), "08/2026 náhrada DPN 2 477 (19,34 h, 60 % reduced PHV) — ours " + nemSum8.toFixed(2));
ok(close(t8.O, 1146, 0.6), "08/2026 dovolená 1 146 (4,83 h) — ours " + t8.O.toFixed(2));
/* gross = 32 663 + 850 + 1 498 + 674 odměna + 1 146 = 36 831 WITHOUT náhrada;
 * net = gross − SP 2 616 − ZP 1 658 − daň 2 965 + náhrada 2 477 = 32 069 */
const gross8 = t8.J + t8.L + t8.K + 674 + t8.O;
ok(close(gross8, 36831, 20.5), "08/2026 hrubá mzda 36 831 (odměna 674 fixed) — ours " + gross8.toFixed(2));
const net8 = Payroll.calcNetto(gross8) + nemSum8;
ok(close(net8, 32069, 20.5), "08/2026 čistá mzda 32 069 — ours " + net8.toFixed(2));

/* --- 6. attendance bonus: 10 % formula + fixed override --- */
const den10 = day(2026, 7, 6, "den", {}, S3); /* default attendanceBonusPct = 10 % */
ok(close(den10.P, 2107.33 * 0.1, 0.05), "10% formula: den P=" + den10.P.toFixed(2) + " (J x 0.10)");
ok(close(0.1 * 218 * 174.01, 3793, 0.5), "June odměna = 218 x fond 174.01 h x 10% = 3793 (exact)");

const raw = [day(2026, 7, 6, "den", {}, S3), day(2026, 7, 7, "den", {}, S3), day(2026, 7, 8, "volno", {}, S3)];
const bon = Payroll.withMonthlyBonus(raw, 908);
ok(bon !== raw && close(raw[0].P, 210.73, 0.05), "withMonthlyBonus does not mutate input");
ok(close(bon[0].P, 454, 0.01) && close(bon[1].P, 454, 0.01) && bon[2].P === 0,
  "fixed 908 REPLACES formula, split over 2 worked days only");
ok(close(bon[0].E, raw[0].E - raw[0].P + 454, 0.01), "E swapped: formula bonus out, fixed share in");
ok(Payroll.withMonthlyBonus(raw, 0) === raw, "bonus 0 -> formula stays");

/* --- 7. i18n key parity across all 5 locales --- */
const langs = Object.keys(LOCALES);
const enKeys = Object.keys(LOCALES.en).sort().join(",");
langs.forEach(function (l) {
  ok(Object.keys(LOCALES[l]).sort().join(",") === enKeys, "locale " + l + " key parity with en");
});

/* --- 8. phvFromDays: PHV from previous quarter data (§ 351+ ZP) --- */
/* 10 worked days of 10 h at 200 base + supplements/bonus -> known average */
const qDays = [];
for (let i = 0; i < 10; i++) qDays.push({ J: 2000, K: 100, L: 50, M: 0, N: 0, P: 200, O: 0, F: 10, isHolidayShift: false });
qDays.push({ J: 0, K: 0, L: 0, M: 0, N: 0, P: 0, O: 2460, F: 9.67, isHolidayShift: false });   /* dovolená — excluded */
qDays.push({ J: 2460, K: 0, L: 0, M: 0, N: 0, P: 0, O: 0, F: 9.67, isHolidayShift: true, holidayWork: false }); /* svátek náhrada — excluded */
qDays.push({ J: 0, K: 0, L: 0, M: 0, N: 0, P: 0, O: 0, F: 9.67, nem: 1284, isHolidayShift: false }); /* nemoc — excluded */
const phvRes = Payroll.phvFromDays(qDays);
ok(phvRes && close(phvRes.hours, 100, 0.001), "phvFromDays: only worked hours counted (100) — got " + (phvRes && phvRes.hours));
ok(phvRes && close(phvRes.phv, 235, 0.001), "phvFromDays: (2000+100+50+200)*10 / 100 h = 235 Kč/h — got " + (phvRes && phvRes.phv));
ok(Payroll.phvFromDays([{ J: 0, F: 9.67, nem: 1284 }]) === null, "phvFromDays: no worked shifts -> null");


/* --- 9. Lateness: unpaid, shrinks pay + counted hours --- */
const lateDen = day(2026, 7, 6, "den", { lateHours: 2 }, S3);
ok(close(lateDen.F, 7.6667, 0.001) && close(lateDen.J, 7.6667 * 218, 0.5),
  "late 2h: F=7.67, J=" + lateDen.J.toFixed(2) + " (7.67h x 218)");
const lateNoc = day(2026, 7, 7, "noc", { lateHours: 1.5 }, S3);
ok(close(lateNoc.F, 9.6667 - 1.5, 0.001) && lateNoc.K < day(2026, 7, 7, "noc", {}, S3).K,
  "late night: hours and night supplement scale down");
ok(close(day(2026, 7, 8, "pulden", { lateHours: 6 }, S3).F, 0, 0.001),
  "pulden late 6h: worked half fully eaten (clamped at 0)");

/* --- 10. Attendance tiers (agency slide): 100+/90+/85+ -> 10/6/2 % --- */
ok(Payroll.bonusTier(1.05) === 0.10 && Payroll.bonusTier(1.0) === 0.10, "tier 100%+ -> 10%");
ok(Payroll.bonusTier(0.95) === 0.06 && Payroll.bonusTier(0.90) === 0.06, "tier 90-99% -> 6%");
ok(Payroll.bonusTier(0.87) === 0.02 && Payroll.bonusTier(0.85) === 0.02, "tier 85-89% -> 2%");
ok(Payroll.bonusTier(0.84) === 0 && Payroll.bonusTier(0) === 0, "tier <85% -> 0%");

/* colleague 08/2026: fond 18 shifts x 9.6667 = 174 h; counted = worked 149.83
 * + pulden vacation half 4.83 = 154.66 (sick 19.34 h stays in fond, uncounted)
 * -> share 88.9 % -> 2 % tier */
const sh8 = Array.from({ length: 31 }, function () { return { type: "volno" }; });
Object.keys(cal8).forEach(function (d) { sh8[d - 1] = { type: cal8[d] }; });
const res8raw = Array.from({ length: 31 }, function (_, i) {
  return day(2026, 8, i + 1, sh8[i].type, {}, SC);
});
const ai8 = Payroll.attendanceInfo(res8raw, sh8, SC, 18);
ok(close(ai8.fond, 174, 0.01), "fond 18 x 9.6667 = 174 h — got " + ai8.fond.toFixed(2));
ok(close(ai8.counted, 154.66, 0.05), "counted 154.66 h (sick excluded) — got " + ai8.counted.toFixed(2));
ok(ai8.pct === 0.02, "share 88.9% -> tier 2%");
const res8tier = Payroll.withAttendanceBonus(res8raw, sh8, SC, 18);
const P8 = res8tier.reduce(function (a, r) { return a + r.P; }, 0);
ok(close(P8, 32663.67 * 0.02, 1.0), "tier 2% of worked time wage = " + P8.toFixed(0) + " Kč (payslip 674, Adecco specifics aside)");

/* perfect month -> 10 %, extra overtime day outside the roster saves the tier */
const perfect = [day(2026, 7, 6, "den", {}, S3), day(2026, 7, 7, "den", {}, S3)];
const shP = [{ type: "den" }, { type: "den" }];
ok(Payroll.attendanceInfo(perfect, shP, S3, 2).pct === 0.10, "2/2 worked -> 10%");
const withExtra = perfect.concat([day(2026, 7, 8, "den", { overtime: true }, S3)]);
const shE = shP.concat([{ type: "den", overtime: true }]);
ok(Payroll.attendanceInfo(withExtra, shE, S3, 2).share > 1, "extra shift beyond fond -> share > 100% (bonus saved)");

/* --- 11. Roster pattern: detect from painted weeks, rotate 4/4 --- */
/* user painted 2 weeks of Sun-Wed day shifts (weeks of 2026-08-02 and 08-09) */
const md = [{ year: 2026, month: 7, shifts: Array.from({ length: 31 }, function () { return { type: "volno" }; }) }];
[2, 3, 4, 5, 9, 10, 11, 12].forEach(function (d) { md[0].shifts[d - 1] = { type: "den" }; });
const pat = Payroll.detectPattern(md);
ok(pat && pat.weekdays.join("") === "0123", "pattern weekdays = Sun..Wed — got " + (pat && pat.weekdays));
/* the painted span covers 3 calendar weeks (Sun 2.8 belongs to the week of
 * Mon 27.7) -> the block is already 3 weeks in */
ok(pat && pat.type === "den" && pat.blockWeeks === 3, "current block: day, 3 weeks in — got " + (pat && pat.type + "/" + pat.blockWeeks));
ok(Payroll.predictType(new Date(2026, 7, 19), pat) === "den", "week 4 of block -> still day");
ok(Payroll.predictType(new Date(2026, 7, 26), pat) === "noc", "week 5 -> rotation to nights");
ok(Payroll.predictType(new Date(2026, 8, 2), pat) === "noc", "night block continues");
ok(Payroll.predictType(new Date(2026, 8, 23), pat) === "den", "week of 21.9 -> back to days (4/4)");
ok(Payroll.predictType(new Date(2026, 7, 22), pat) === "volno", "Friday not in pattern -> volno");
ok(Payroll.predictType(new Date(2026, 6, 29), pat) === "den", "2 weeks before anchor -> day (same block backwards)");
ok(Payroll.predictType(new Date(2026, 6, 22), pat) === "noc", "3 weeks before anchor -> nights (previous block)");
ok(Payroll.countFondDays(2026, 7, [0, 1, 2, 3]) === 18, "Aug 2026 Sun-Wed = 18 fond days (payslip: 174 h = 18 x 9.67)");


/* --- 12. Shift switch: move a shift off-roster, bonus untouched --- */
/* Sun-Wed roster, week fully worked; then one Tue shift moved to a Friday.
 * fond must stay 4 shifts (pattern), the Friday work counts -> share stays 100% */
function augWeek(typesByDay) { /* week of Mon 2026-08-03 .. Sun 09-08 */
  const shifts = Array.from({ length: 7 }, function () { return { type: "volno" }; });
  Object.keys(typesByDay).forEach(function (d) { shifts[+d] = { type: typesByDay[d] }; });
  return shifts;
}
const weekNormal = augWeek({ 6: "noc", 0: "noc", 1: "noc", 2: "noc" }); /* Su,Mo,Tu,We */
const weekSwitch = augWeek({ 6: "noc", 0: "noc", 1: "noc", 4: "noc" }); /* Tue -> Fri */
function weekResults(sh) {
  return sh.map(function (x, i) { return Payroll.calcDay(new Date(2026, 7, 3 + i), x.type, x, S3, hol); });
}
const fondN = Payroll.attendanceInfo(weekResults(weekNormal), weekNormal, S3, 4);
const fondS = Payroll.attendanceInfo(weekResults(weekSwitch), weekSwitch, S3, 4);
ok(fondN.pct === 0.10 && fondS.pct === 0.10 && close(fondS.share, 1, 0.001),
  "switch Tue->Fri: share stays 100%, tier 10% (fond unchanged, extra day counted)");
/* pattern detection survives occasional switches: Fri painted once in 4 weeks
 * must NOT join the roster */
/* one fully painted month (4 weeks of Sun-Wed) with one switch in week 2:
 * Wed 12.8 -> Fri 14.8 */
const swSh = Array.from({ length: 31 }, function () { return { type: "volno" }; });
[2, 3, 4, 5, 9, 10, 11, 12, 16, 17, 18, 19, 23, 24, 25, 26].forEach(function (d) { swSh[d - 1] = { type: "den" }; });
swSh[11] = { type: "volno" }; swSh[13] = { type: "den" }; /* Wed 12.8 -> Fri 14.8 */
const patSw = Payroll.detectPattern([{ year: 2026, month: 7, shifts: swSh }]);
ok(patSw && patSw.weekdays.indexOf(5) === -1 && patSw.weekdays.length === 4,
  "one-off switch: Friday ignored, roster still 4 weekdays — got " + (patSw && patSw.weekdays));


/* --- 13. Roster learned only from a fully painted month; newest wins --- */
function monthData(y, m, days, type) {
  const sh = Array.from({ length: 31 }, function () { return { type: "volno" }; });
  days.forEach(function (d) { sh[d - 1] = { type: type }; });
  return { year: y, month: m, shifts: sh };
}
ok(Payroll.detectPattern([monthData(2026, 7, [3, 4, 5], "den")]) === null,
  "3 painted days (partial month) -> no pattern, no guessing");
/* older complete month Sun-Wed days, newer complete month Mon-Thu nights */
const oldM = monthData(2026, 6, [5, 6, 7, 8, 12, 13, 14, 15, 19, 20, 21, 22, 26, 27, 28, 29], "den"); /* Su-Wed July */
const newM = monthData(2026, 7, [3, 4, 5, 6, 10, 11, 12, 13, 17, 18, 19, 20, 24, 25, 26, 27], "noc"); /* Mon-Thu Aug */
const patCh = Payroll.detectPattern([oldM, newM]);
ok(patCh && patCh.weekdays.join("") === "1234", "roster changed: newest complete month wins (Mon-Thu) — got " + (patCh && patCh.weekdays));
ok(patCh && patCh.type === "noc", "block type from the newest month: nights");

/* --- 14. Rotation rule: type change starts a new 4-week block --- */
/* 3 weeks of days + 1 week of nights painted (Aug 2026, Sun-Wed roster):
 * -> 3 more night weeks, then 4 day weeks */
const rot = monthData(2026, 7, [2, 3, 4, 5, 9, 10, 11, 12, 16, 17, 18, 19], "den");
[23, 24, 25, 26].forEach(function (d) { rot.shifts[d - 1] = { type: "noc" }; });
const patRot = Payroll.detectPattern([rot]);
ok(patRot && patRot.type === "noc" && patRot.blockWeeks === 1, "anchor: night block, week 1 — got " + (patRot && patRot.blockWeeks));
ok(Payroll.predictType(new Date(2026, 7, 30), patRot) === "noc", "next week -> nights (block week 2)");
ok(Payroll.predictType(new Date(2026, 8, 9), patRot) === "noc", "week 3 -> nights");
ok(Payroll.predictType(new Date(2026, 8, 16), patRot) === "noc", "week 4 -> nights");
ok(Payroll.predictType(new Date(2026, 8, 23), patRot) === "den", "week 5 -> days (new block)");
ok(Payroll.predictType(new Date(2026, 9, 14), patRot) === "den", "day block holds 4 weeks");
ok(Payroll.predictType(new Date(2026, 9, 21), patRot) === "noc", "then nights again");
/* and backwards: the 3 painted day weeks sit inside a 4-week day block */
ok(Payroll.predictType(new Date(2026, 6, 29), patRot) === "den", "1 week before painted days -> day (block week 1)");
ok(Payroll.predictType(new Date(2026, 6, 22), patRot) === "noc", "before that -> nights");


/* --- 15. Predicted (auto-filled) days never teach the pattern --- */
const predM = monthData(2026, 7, [2, 3, 4, 5, 9, 10, 11, 12, 16, 17, 18, 19], "den");
predM.shifts.forEach(function (x) { if (x.type !== "volno") x.predicted = true; });
ok(Payroll.detectPattern([predM]) === null, "fully predicted month -> no pattern (forecast does not self-confirm)");
const mixM = monthData(2026, 7, [2, 3, 4, 5, 9, 10, 11, 12, 16, 17, 18, 19], "den");
[7, 14, 21, 28].forEach(function (d) { mixM.shifts[d - 1] = { type: "den", predicted: true }; }); /* predicted Fridays */
const patMix = Payroll.detectPattern([mixM]);
ok(patMix && patMix.weekdays.indexOf(5) === -1 && patMix.weekdays.length === 4,
  "predicted Fridays ignored, roster stays Sun-Wed — got " + (patMix && patMix.weekdays));


/* 16. bonusVoid (warning letter / ADAPT) voids the whole monthly bonus */
{
  const dimV = Payroll.daysInMonth(2026, 7);
  const shV = []; for (let i = 0; i < dimV; i++) shV.push(day(2026, 7, i, "volno"));
  [2, 3, 4, 5, 9, 10, 11, 12, 16, 17, 18, 19, 23, 24, 25, 26, 30, 31].forEach(function (d) {
    shV[d - 1] = day(2026, 7, d, "den");
  });
  const holV = Payroll.buildHolidayMap(2026, "cs", {});
  const rawV = shV.map(function (s2, i) { return Payroll.calcDay(new Date(2026, 7, i + 1), s2.type, s2, S, holV); });
  const sv = Object.assign({}, S, { bonusVoid: true });
  const resV = Payroll.withAttendanceBonus(rawV, shV, sv, 18);
  const resN = Payroll.withAttendanceBonus(rawV, shV, S, 18);
  ok(resV.every(function (r) { return r.P === 0; }), "bonusVoid -> all P zeroed");
  ok(Math.abs(resV.reduce(function (a, r) { return a + r.E; }, 0) -
    (resN.reduce(function (a, r) { return a + r.E; }, 0) - resN.reduce(function (a, r) { return a + r.P; }, 0))) < 0.01,
    "bonusVoid -> gross drops by the bonus");
  const sf = Object.assign({}, S, { bonusVoid: true, bonusMonthKc: 5000 });
  const resF = Payroll.withAttendanceBonus(rawV, shV, sf, 18);
  ok(resF.every(function (r) { return r.P === 0; }), "bonusVoid beats fixed override");
}


/* 17. Vladyslav's own payslip 08/2026 — doctor day (překážky) + lateness:
 * časová 35 523, víkend 644, noční 1 673, odměna 3 523 (= 10 % — the full
 * bonus!), Překážky 4,83 h -> 1 188 inside gross, Neodpracované 6,22 -> 0,
 * hrubá 42 551, čistá 33 794. Fond 174 (Sun–Wed x 9,6667), PHV 246,06. */
{
  const SV = Object.assign({}, S, { baseRate: 218, phvRate: 246.06 });
  const dimV = Payroll.daysInMonth(2026, 7);
  const shV = []; for (let i = 0; i < dimV; i++) shV.push({ type: "volno", overtime: false, holidayWork: true, lateHours: 0 });
  [2, 3, 4, 5, 9, 10, 11, 12, 16, 17, 18, 19].forEach(function (d) { shV[d - 1].type = "noc"; });
  [23, 24, 25, 30, 31].forEach(function (d) { shV[d - 1].type = "den"; });
  shV[25].type = "prek";          /* 26.8 — doctor with propustka */
  shV[16].lateHours = 1.39;       /* lateness -> 6,22 h unpaid total with the doctor half */
  const rawV = shV.map(function (s2, i) { return Payroll.calcDay(new Date(2026, 7, i + 1), s2.type, s2, SV, hol); });

  const prek = rawV[25];
  ok(prek.F === 0 && prek.J === 0, "prek: not worked hours, no time wage");
  ok(Math.abs(prek.O - 246.06 * SV.dayPaidHours / 2) < 0.01 && Math.abs(prek.E - prek.O) < 0.01,
    "prek: half shift at full PHV inside gross — got " + prek.O);

  const ai = Payroll.attendanceInfo(rawV, shV, SV, 18);
  ok(Math.abs(ai.fond - 167.78) < 0.1 && Math.abs(ai.counted - 167.78) < 0.1,
    "attendance: fond 174-6,22 = counted 162,95+4,83 — got " + ai.counted.toFixed(2) + "/" + ai.fond.toFixed(2));
  ok(ai.pct === 0.10, "share 100 % -> full 10 % odměna (payslip) — got " + ai.pct);

  const resV = Payroll.withAttendanceBonus(rawV, shV, SV, 18);
  const gross = resV.reduce(function (a, r) { return a + r.E; }, 0);
  const bonus = resV.reduce(function (a, r) { return a + r.P; }, 0);
  /* NB: payslip víkend = 26,17 h while the painted roster has 35,83 weekend h —
   * the difference is exactly ONE Sunday day shift (9,67 h ≈ 238 Kč), i.e. one
   * of 23./30.8 was in reality a weekday shift. Model follows the painted data. */
  ok(Math.abs(gross - 42551) < 260, "gross ~ 42 551 (minus the Sunday-shift anomaly) — got " + Math.round(gross));
  ok(Math.abs(bonus - 3523) < 40, "odměna ~ 3 523 — got " + Math.round(bonus));
  ok(Math.abs(Payroll.calcNetto(gross) - 33794) < 260, "netto ~ 33 794 — got " + Math.round(Payroll.calcNetto(gross)));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
