/* Tiny i18n engine: dictionary lookup, plural forms, locale-aware number/date formatting,
 * and data-i18n attribute application for static markup.
 *
 * Conventions:
 *   - t(key) resolves against the active locale, falls back to English, then to the key
 *   - plural(n, forms) takes locale-specific word forms ("день/дня/дней" style)
 *   - esc() is the single escape helper for the rare cases where we build HTML strings;
 *     everywhere else prefer textContent/setAttribute over innerHTML
 */
(function (root) {
  "use strict";
  const LOCALES = root.PAYROLL_LOCALES || {};
  const LS_LANG = "hpp_kalkulacka_lang_v1";

  /* Browser language wins on first visit; the user's explicit choice is stored after that. */
  function detect() {
    let saved = null;
    try { saved = localStorage.getItem(LS_LANG); } catch (e) { /* private mode */ }
    if (saved && LOCALES[saved]) return saved;
    const nav = ((root.navigator && root.navigator.language) || "en").slice(0, 2).toLowerCase();
    return LOCALES[nav] ? nav : "en";
  }

  let lang = detect();

  function t(key) {
    const dict = LOCALES[lang] || {};
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    if (Object.prototype.hasOwnProperty.call(LOCALES.en || {}, key)) return LOCALES.en[key];
    return key;
  }

  function setLang(l) {
    if (!LOCALES[l]) return;
    lang = l;
    try { localStorage.setItem(LS_LANG, l); } catch (e) { /* private mode */ }
  }

  function getLang() { return lang; }
  function locales() { return LOCALES; }

  /* Slavic-style 3-form plurals (ru/uk/pl/cs) + default one/other.
   * forms = [singular, paucal(2-4), genitive plural(5+)] for Slavic locales. */
  function plural(n, forms) {
    n = Math.abs(n);
    const m100 = n % 100, m10 = n % 10;
    let idx;
    if (lang === "ru" || lang === "uk" || lang === "pl") {
      idx = (m100 > 10 && m100 < 20) ? 2 : (m10 > 1 && m10 < 5 ? 1 : (m10 === 1 ? 0 : 2));
    } else if (lang === "cs") {
      idx = (m10 === 1 && m100 !== 11) ? 0 : (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? 1 : 2);
    } else {
      idx = n === 1 ? 0 : 1;
    }
    return forms[Math.min(idx, forms.length - 1)];
  }

  /* HTML-escape for the few places that still build markup as strings
   * (the breakdown table). Output of t()/Intl is trusted, user input is not —
   * belt and suspenders either way. */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function nf(options) { return new Intl.NumberFormat(lang, options); }

  function fmtMoney(x) {
    return nf({ maximumFractionDigits: 0 }).format(x) + " " + t("currency");
  }
  function fmtNum(x, maxFrac) {
    return nf({ maximumFractionDigits: maxFrac === undefined ? 2 : maxFrac }).format(x);
  }
  function fmtHours(x) { return fmtNum(x) + " " + t("hoursUnit"); }

  function fmtShortDate(d) {
    return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "numeric" }).format(d);
  }
  function monthName(monthIdx) {
    return new Intl.DateTimeFormat(lang, { month: "long" }).format(new Date(2020, monthIdx, 1));
  }
  /* Monday-first short weekday names (2024-01-01 was a Monday). */
  function weekdayNames() {
    const out = [];
    for (let i = 0; i < 7; i++) {
      out.push(new Intl.DateTimeFormat(lang, { weekday: "short" }).format(new Date(2024, 0, 1 + i)));
    }
    return out;
  }

  /* Apply translations to [data-i18n] / [data-i18n-placeholder] / [data-i18n-aria] inside rootEl.
   * Only touches leaf elements — markup inside them (icons, chevrons) is preserved. */
  function apply(rootEl) {
    const scope = rootEl || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
  }

  root.I18n = {
    t: t, setLang: setLang, getLang: getLang, locales: locales,
    plural: plural, esc: esc, nf: nf,
    fmtMoney: fmtMoney, fmtNum: fmtNum, fmtHours: fmtHours,
    fmtShortDate: fmtShortDate, monthName: monthName, weekdayNames: weekdayNames,
    apply: apply
  };
})(typeof self !== "undefined" ? self : this);
