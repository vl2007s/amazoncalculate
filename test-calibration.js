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

/* --- 5. Nemoc: 60 % of reduced PHV, insured-exempt --- */
ok(close(Payroll.reducePhv(350), 295.734, 0.001), "reducePhv(350)=295.734 (official example)");
ok(close(Payroll.reducePhv(246.06), 221.454, 0.001), "reducePhv(246.06)=221.454 (all in band 1, x0.9)");
const nem = day(2026, 7, 9, "nemoc", {}, S3);
ok(nem.J === 0 && nem.K === 0 && nem.L === 0 && nem.M === 0 && nem.N === 0 && nem.P === 0,
  "nemoc: no base pay, no supplements");
ok(close(nem.O, 0.6 * 221.454 * 9.6667, 0.1) && nem.exempt === nem.O && nem.E === nem.O,
  "nemoc O=E=exempt=" + nem.O.toFixed(2));
ok(Payroll.calcNetto(nem.O, 0) === Math.max(0, nem.O - Math.max(0, Payroll.round0(Math.ceil(nem.O / 100) * 100 * 0.15) - 2570)),
  "nemoc compensation: taxed, zero SP/ZP");

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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
