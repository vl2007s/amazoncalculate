/* App wiring: state, localStorage persistence, rendering (calendar view, brush,
 * summary, breakdown, settings form), language switching.
 *
 * The calendar grid is the only shift editor: click a day for its dropdown
 * (type / overtime / holiday choice), drag with the brush to paint.
 *
 * State shape:
 *   settings — personal rates and bonus parameters (see Payroll.DEFAULT_SETTINGS);
 *              rates are per-user — everyone in the company can have their own
 *   shifts   — [{type, overtime, holidayWork}] for the selected month,
 *              length = days in month
 *   brush    — {active, type, overtime} paint tool
 * Persistence keys are versioned ("_v1") so a future schema change can migrate cleanly.
 */
(function () {
  "use strict";
  const Payroll = window.Payroll, I18n = window.I18n;

  /* ============ Storage (keys kept from the original single-file version) ============ */
  const LS_SETTINGS = "hpp_kalkulacka_settings_v1";
  const LS_NAME = "hpp_kalkulacka_name_v1";
  function lsShiftsKey(y, m) { return "hpp_kalkulacka_shifts_" + y + "-" + String(m + 1).padStart(2, "0"); }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (!raw) return { ...Payroll.DEFAULT_SETTINGS };
      return { ...Payroll.DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) { return { ...Payroll.DEFAULT_SETTINGS }; }
  }
  function saveSettings(s) { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) { } }

  /* Shift arrays are stored per month; tolerate truncated/corrupt entries by
   * normalizing every slot into a valid {type, overtime, holidayWork} triple.
   * holidayWork defaults to true — coming in on a holiday is the common case. */
  function loadShifts(year, month, daysInMonth) {
    const key = lsShiftsKey(year, month);
    let arr = null;
    try { const raw = localStorage.getItem(key); if (raw) arr = JSON.parse(raw); } catch (e) { }
    if (!Array.isArray(arr)) arr = [];
    const out = [];
    for (let i = 0; i < daysInMonth; i++) {
      const s = (arr[i] && typeof arr[i] === "object") ? arr[i] : {};
      const late = +s.lateHours;
      out.push({
        type: Payroll.SHIFT_TYPES.indexOf(s.type) !== -1 ? s.type : "volno",
        overtime: !!s.overtime,
        holidayWork: s.holidayWork !== false,
        lateHours: (isFinite(late) && late > 0) ? late : 0,
        /* auto-filled forecast days are marked until the user touches them */
        predicted: !!s.predicted
      });
    }
    return out;
  }

  /* Pattern built purely from stored months (used before the freshly loaded
   * month lands in state, so a stale state can't leak into detection) */
  function storedPattern() {
    const monthsData = [];
    for (let y = state.year - 1; y <= state.year + 1; y++) {
      for (let m = 0; m < 12; m++) {
        let arr = null;
        try {
          const raw = localStorage.getItem(lsShiftsKey(y, m));
          if (raw) arr = JSON.parse(raw);
        } catch (e) { }
        if (Array.isArray(arr) && arr.some(function (s) { return s && s.type && s.type !== "volno" && !s.predicted; })) {
          monthsData.push({ year: y, month: m, shifts: arr });
        }
      }
    }
    return Payroll.detectPattern(monthsData);
  }

  /* Loads a month. A never-touched month is pre-filled from the roster pattern
   * as a FORECAST: predicted days render dimmed, don't teach the pattern and
   * keep the PHV marked as an estimate. Once a month has a stored entry (even
   * all-volno), the user's choice is respected and nothing is auto-filled. */
  function loadMonthShifts(y, m) {
    let stored = null;
    try { stored = localStorage.getItem(lsShiftsKey(y, m)); } catch (e) { }
    const shifts = loadShifts(y, m, Payroll.daysInMonth(y, m));
    if (stored) return shifts;
    const pattern = storedPattern();
    if (!pattern) return shifts;
    let filled = 0;
    for (let i = 0; i < shifts.length; i++) {
      const t = Payroll.predictType(new Date(y, m, i + 1), pattern);
      if (t === "volno") continue;
      shifts[i] = { type: t, overtime: false, holidayWork: true, lateHours: 0, predicted: true };
      filled++;
    }
    if (filled) {
      try { localStorage.setItem(lsShiftsKey(y, m), JSON.stringify(shifts)); } catch (e) { }
    }
    return shifts;
  }

  /* Roster pattern detected from every month saved in localStorage (including
   * the current, possibly just-painted one). Drives the attendance fond, the
   * 4-weeks-day / 4-weeks-night rotation forecast and the PHV estimate. */
  function currentPattern() {
    const monthsData = [];
    for (let y = state.year - 1; y <= state.year + 1; y++) {
      for (let m = 0; m < 12; m++) {
        let shifts = null;
        if (y === state.year && m === state.month) shifts = state.shifts;
        else {
          try {
            const raw = localStorage.getItem(lsShiftsKey(y, m));
            if (raw) shifts = JSON.parse(raw);
          } catch (e) { }
          if (!Array.isArray(shifts)) continue;
        }
        if (shifts.some(function (s) { return s && s.type && s.type !== "volno"; })) {
          monthsData.push({ year: y, month: m, shifts: shifts });
        }
      }
    }
    return Payroll.detectPattern(monthsData);
  }
  function saveShifts(year, month, shifts) {
    try { localStorage.setItem(lsShiftsKey(year, month), JSON.stringify(shifts)); } catch (e) { }
  }

  /* ============ State ============ */
  const state = {
    settings: loadSettings(),
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    shifts: [],
    name: (function () { try { return localStorage.getItem(LS_NAME) || ""; } catch (e) { return ""; } })(),
    brush: { active: false, type: "den", overtime: false }
  };
  state.shifts = loadMonthShifts(state.year, state.month);

  /* ============ DOM refs ============ */
  const langSelect = document.getElementById("langSelect");
  const monthSelect = document.getElementById("monthSelect");
  const yearSelect = document.getElementById("yearSelect");
  const periodLabel = document.getElementById("periodLabel");
  const calendarWrap = document.getElementById("calendarWrap");
  const brushBar = document.getElementById("brushBar");
  const nameInput = document.getElementById("nameInput");
  const rateBaseInput = document.getElementById("rateBaseInput");
  const ratePhvInput = document.getElementById("ratePhvInput");
  const bonusVoidInput = document.getElementById("bonusVoidInput");
  const settingsGrid = document.getElementById("settingsGrid");
  const breakdownTable = document.getElementById("breakdownTable");
  const toast = document.getElementById("toast");
  const saveIndicator = document.getElementById("saveIndicator");

  langSelect.value = I18n.getLang();
  nameInput.value = state.name;

  /* ============ Theme toggle (initial theme applied by js/theme-init.js) ============ */
  const themeToggle = document.getElementById("themeToggle");
  const LS_THEME = "hpp_kalkulacka_theme_v1";
  function syncThemeIcon() {
    themeToggle.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
  }
  themeToggle.addEventListener("click", function () {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(LS_THEME, next); } catch (e) { }
    syncThemeIcon();
  });
  syncThemeIcon();

  /* ============ Privacy modal ============ */
  const privacyModal = document.getElementById("privacyModal");
  const privacyBody = document.getElementById("privacyBody");
  function renderPrivacy() {
    /* paragraphs are separated by blank lines in the locale string */
    privacyBody.innerHTML = "";
    I18n.t("privacyBody").split("\n\n").forEach(function (text) {
      const p = document.createElement("p");
      p.textContent = text;
      privacyBody.appendChild(p);
    });
  }
  function closePrivacy() { privacyModal.hidden = true; }
  document.getElementById("privacyLink").addEventListener("click", function (e) {
    e.preventDefault();
    renderPrivacy();
    privacyModal.hidden = false;
  });
  document.getElementById("btnPrivacyClose").addEventListener("click", closePrivacy);
  privacyModal.addEventListener("click", function (e) { if (e.target === privacyModal) closePrivacy(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePrivacy(); });

  /* ============ What's-new banner ============
   * Release announcements: bump WHATS_NEW_VERSION and update the "whatsNew"
   * locale strings — everyone who dismissed the previous banner sees the new
   * one exactly once (dismissal is remembered in localStorage). */
  const WHATS_NEW_VERSION = "2026-09-15-2";
  const LS_WHATSNEW = "hpp_kalkulacka_whatsnew_v1";
  (function initWhatsNew() {
    const modal = document.getElementById("whatsNewModal");
    const body = document.getElementById("whatsNewBody");
    /* whatsNew is a bullet list: one line = one bullet */
    I18n.t("whatsNew").split("\n").filter(function (l) { return l.trim(); }).forEach(function (l) {
      const p = document.createElement("p");
      p.textContent = l;
      body.appendChild(p);
    });
    function closeWhatsNew() {
      modal.hidden = true;
      try { localStorage.setItem(LS_WHATSNEW, WHATS_NEW_VERSION); } catch (e) { }
    }
    document.getElementById("whatsNewClose").addEventListener("click", closeWhatsNew);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeWhatsNew(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeWhatsNew();
    });
    let seen = null;
    try { seen = localStorage.getItem(LS_WHATSNEW); } catch (e) { /* private mode */ }
    if (seen !== WHATS_NEW_VERSION) modal.hidden = false;
  })();

  let toastTimer = null;
  /* transient message through the same toast element (restores "Saved" after) */
  function showMsg(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("show");
      toast.textContent = I18n.t("toastSaved");
    }, 2600);
  }
  function showSaved() {
    saveIndicator.classList.remove("idle");
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("show");
      saveIndicator.classList.add("idle");
    }, 1400);
  }

  function persistAll() {
    saveSettings(state.settings);
    saveShifts(state.year, state.month, state.shifts);
    try { localStorage.setItem(LS_NAME, state.name); } catch (e) { }
    showSaved();
  }

  function holidayMapFor(year) {
    return Payroll.buildHolidayMap(year, I18n.getLang(), I18n.locales());
  }

  /* ============ My rates (quick fields — the rest lives in the settings panel) ============ */
  function bindRateInput(input, key) {
    input.addEventListener("change", function () {
      let v = parseFloat(input.value);
      if (isNaN(v) || v < 0) v = Payroll.DEFAULT_SETTINGS[key];
      state.settings[key] = v;
      persistAll();
      buildSettingsForm(); /* keep the advanced form in sync */
      renderAll();
    });
  }
  bindRateInput(rateBaseInput, "baseRate");
  bindRateInput(ratePhvInput, "phvRate");
  /* bonus-void toggle: warning letter / ADAPT this month voids the whole
   * attendance bonus (replaces the old fixed-amount quick field) */
  bonusVoidInput.addEventListener("change", function () {
    state.settings.bonusVoid = bonusVoidInput.checked;
    persistAll();
    renderAll();
  });

  /* ============ Settings form ============ */
  /* Built from Payroll.SETTINGS_FIELDS so the form always matches the math. */
  /* PHV (průměrný hodinový výdělek) is by law derived from the PREVIOUS
   * calendar quarter (§ 351+ ZP). The user paints shifts month by month and
   * they persist in localStorage — so we can recompute those months and divide
   * pay-for-work by worked hours. Returns null when no data is saved. */
  function computePrevQuarterPhv() {
    const qStart = Math.floor(state.month / 3) * 3;
    let py = state.year, pm = qStart - 3;
    if (pm < 0) { pm += 12; py -= 1; }
    const holCache = {};
    const days = [];
    const pattern = currentPattern();
    let estimated = false;
    for (let k = 0; k < 3; k++) {
      const m = pm + k;
      const dim = Payroll.daysInMonth(py, m);
      let shifts = loadShifts(py, m, dim);
      if (!shifts.some(function (s) { return s.type !== "volno" && !s.predicted; })) {
        /* month never painted for real (or only auto-filled) — approximate it
         * from the roster pattern and mark the PHV as an estimate */
        if (!pattern) continue;
        shifts = [];
        for (let i = 0; i < dim; i++) {
          shifts.push({ type: Payroll.predictType(new Date(py, m, i + 1), pattern), overtime: false, holidayWork: true, lateHours: 0 });
        }
        if (!shifts.some(function (s) { return s.type !== "volno"; })) continue;
        estimated = true;
      }
      if (!holCache[py]) holCache[py] = Payroll.buildHolidayMap(py, I18n.getLang(), I18n.locales());
      shifts.forEach(function (sh, i) {
        days.push(Payroll.calcDay(new Date(py, m, i + 1), sh.type, sh, state.settings, holCache[py]));
      });
    }
    const res = days.length ? Payroll.phvFromDays(days) : null;
    if (res) res.estimated = estimated;
    return res;
  }

  function buildSettingsForm() {
    settingsGrid.innerHTML = "";
    const groups = {};
    Payroll.SETTINGS_FIELDS.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    Object.keys(groups).forEach(function (groupKey) {
      const wrap = document.createElement("div");
      wrap.className = "settings-group";
      const h3 = document.createElement("h3");
      h3.textContent = I18n.t(groupKey);
      wrap.appendChild(h3);
      groups[groupKey].forEach(function (f) {
        const row = document.createElement("div"); row.className = "field-row";
        const label = document.createElement("label");
        label.textContent = I18n.t("f_" + f.key);
        label.setAttribute("for", "set_" + f.key);
        const input = document.createElement("input");
        input.type = "number"; input.step = f.step; input.id = "set_" + f.key; input.min = "0";
        /* pct fields are edited as percents (10) but stored as fractions (0.10) */
        input.value = f.pct ? Payroll.round4(state.settings[f.key] * 100) : state.settings[f.key];
        input.addEventListener("change", function () {
          let v = parseFloat(input.value);
          if (isNaN(v) || v < 0) v = f.pct ? (Payroll.DEFAULT_SETTINGS[f.key] * 100) : Payroll.DEFAULT_SETTINGS[f.key];
          state.settings[f.key] = f.pct ? v / 100 : v;
          persistAll();
          renderAll();
        });
        const unit = document.createElement("span");
        unit.className = "unit"; unit.textContent = I18n.t(f.unit);
        row.appendChild(label); row.appendChild(input); row.appendChild(unit);
        /* PHV gets an auto-compute button: the law derives it from the previous
         * calendar quarter — we have those shifts saved in localStorage */
        if (f.key === "phvRate") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn phv-calc";
          btn.textContent = I18n.t("phvCalcBtn");
          btn.title = I18n.t("phvCalcHint");
          btn.addEventListener("click", function () {
            const res = computePrevQuarterPhv();
            if (!res) { showMsg(I18n.t("phvCalcNoData")); return; }
            state.settings.phvRate = Payroll.round4(res.phv);
            persistAll();
            buildSettingsForm();
            renderAll();
            showMsg(I18n.t("phvCalcDone") + ": " + I18n.fmtNum(res.phv) + " " +
              I18n.t("u_kch") + " (" + I18n.fmtNum(res.hours) + " " + I18n.t("hoursUnit") + ")" +
              (res.estimated ? " — " + I18n.t("phvCalcEstimated") : ""));
          });
          row.appendChild(btn);
        }
        wrap.appendChild(row);
      });
      settingsGrid.appendChild(wrap);
    });
  }

  /* ============ Brush toolbar ============ */
  function buildBrushBar() {
    brushBar.innerHTML = "";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "brush-toggle" + (state.brush.active ? " active" : "");
    toggle.textContent = I18n.t("brushBtn");
    toggle.addEventListener("click", function () {
      state.brush.active = !state.brush.active;
      buildBrushBar();
      renderAll();
    });
    brushBar.appendChild(toggle);

    Payroll.WORK_TYPES.forEach(function (type) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "brush-chip t-" + type + (state.brush.type === type && state.brush.active ? " sel" : "");
      b.textContent = I18n.t("ts_" + type);
      b.addEventListener("click", function () {
        state.brush.type = type;
        state.brush.active = true; /* picking a brush activates painting */
        buildBrushBar();
        renderAll();
      });
      brushBar.appendChild(b);
    });

    const ot = document.createElement("label");
    ot.className = "brush-ot" + ((state.brush.type === "den" || state.brush.type === "noc") ? "" : " disabled");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state.brush.overtime;
    cb.addEventListener("change", function () {
      state.brush.overtime = cb.checked;
    });
    ot.appendChild(cb);
    ot.appendChild(document.createTextNode(I18n.t("overtime")));
    brushBar.appendChild(ot);

    const hint = document.createElement("span");
    hint.className = "brush-hint";
    hint.textContent = I18n.t("brushHint");
    brushBar.appendChild(hint);
  }

  /* ============ Summary & breakdown ============ */
  function renderSummary(results) {
    const gross = results.reduce(function (a, r) { return a + r.E; }, 0);
    /* worked hours = actually worked shifts only (den/noc/pulden) — matches the
     * payslip's "Odpracováno hodin": sick and vacation hours are NOT odpracované */
    const hours = results.reduce(function (a, r, i) {
      const t = state.shifts[i] ? state.shifts[i].type : "volno";
      return a + ((t === "den" || t === "noc" || t === "pulden") ? r.F : 0);
    }, 0);
    /* sick-pay compensation (náhrada při DPN) is paid fully outside the gross —
     * not taxed, not insured, simply added to the payout (payslip 08/2026) */
    const nem = results.reduce(function (a, r) { return a + (r.nem || 0); }, 0);
    /* worked days: full shifts count 1, a poludnevka counts 0.5 (16,5 dne style) */
    const workedDays = state.shifts.reduce(function (a, d) {
      return a + (d.type === "den" || d.type === "noc" ? 1 : (d.type === "pulden" ? 0.5 : 0));
    }, 0);
    document.getElementById("sumGross").textContent = I18n.fmtMoney(gross);
    document.getElementById("sumNet").textContent = I18n.fmtMoney(Payroll.calcNetto(gross) + nem);
    document.getElementById("sumHours").textContent = I18n.fmtHours(hours);
    document.getElementById("sumDays").textContent = I18n.fmtNum(workedDays) + " " + I18n.plural(workedDays, I18n.t("daysForms"));
    /* attendance line: counted vs fond hours and the resulting bonus tier */
    const attLine = document.getElementById("attLine");
    const ai = state.attInfo;
    if (attLine) {
      if (ai && ai.fond > 0 && !(state.settings.bonusMonthKc > 0)) {
        attLine.hidden = false;
        attLine.textContent = I18n.t("attShare") + ": " + Math.round(ai.share * 100) + " % (" +
          I18n.fmtNum(ai.counted) + " / " + I18n.fmtNum(ai.fond) + " " + I18n.t("hoursUnit") + ") → " +
          I18n.t("attBonus") + " " +
          (state.settings.bonusVoid ? "0 % — " + I18n.t("attVoid") : Math.round(ai.pct * 100) + " %");
      } else {
        attLine.hidden = true;
      }
    }
  }

  /* The breakdown is the one place where building an HTML string is far more
   * readable than dozens of createElement calls; esc() keeps it safe. */
  function renderBreakdown(results) {
    const cols = [
      ["colNum"], ["colDate"], ["colType"], ["colHours"], ["colNightH"], ["colWeekendH"], ["colHolidayQ"],
      ["colBase"], ["colNightP"], ["colWeekendP"], ["colOtP"], ["colHolidayP"], ["colVacation"], ["colAttend"], ["colTotal"]
    ];
    let thead = "<thead><tr>" + cols.map(function (c) { return "<th>" + I18n.esc(I18n.t(c[0])) + "</th>"; }).join("") + "</tr></thead>";
    let rows = "";
    const totals = { F: 0, G: 0, H: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, E: 0 };
    results.forEach(function (r, i) {
      const date = new Date(state.year, state.month, i + 1);
      const shift = state.shifts[i];
      const isNahr = !!r.isHolidayShift && shift.holidayWork === false;
      /* sick compensation lives in r.nem (outside gross) — show it in the
       * náhrady column and the day total so sick days don't display 0 Kč */
      const dispO = r.O + (r.nem || 0), dispE = r.E + (r.nem || 0);
      Object.keys(totals).forEach(function (k) { totals[k] += r[k]; });
      totals.O += (r.nem || 0); totals.E += (r.nem || 0);
      const typeLabel = I18n.t("type_" + shift.type) +
        (isNahr ? I18n.t("nahrSuffix") : (shift.overtime ? I18n.t("otSuffix") : ""));
      rows += '<tr class="' + (r.isWeekend ? "wknd" : "") + (isNahr ? " nahr" : "") + '">' +
        "<td>" + (i + 1) + "</td>" +
        "<td>" + I18n.esc(I18n.fmtShortDate(date)) + "</td>" +
        "<td>" + I18n.esc(typeLabel) + "</td>" +
        '<td class="tabular">' + I18n.fmtNum(r.F) + "</td>" +
        '<td class="tabular">' + I18n.fmtNum(r.G) + "</td>" +
        '<td class="tabular">' + I18n.fmtNum(r.H) + "</td>" +
        "<td>" + I18n.esc(r.I) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.J) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.K) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.L) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.M) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.N) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(dispO) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.P) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(dispE) + "</td>" +
        "</tr>";
    });
    rows += '<tr class="total-row"><td>' + I18n.esc(I18n.t("totalRow")) + "</td><td></td><td></td>" +
      '<td class="tabular">' + I18n.fmtNum(totals.F) + "</td>" +
      '<td class="tabular">' + I18n.fmtNum(totals.G) + "</td>" +
      '<td class="tabular">' + I18n.fmtNum(totals.H) + "</td><td></td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.J) + "</td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.K) + "</td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.L) + "</td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.M) + "</td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.N) + "</td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.O) + "</td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.P) + "</td>" +
      '<td class="tabular">' + I18n.fmtMoney(totals.E) + "</td></tr>";
    breakdownTable.innerHTML = thead + "<tbody>" + rows + "</tbody>";
  }

  /* ============ Payslip sheet (print only) ============
   * Aggregates the month into an Adecco-style výplatní páska: earnings lines,
   * deductions, net. Rendered on every re-render so printing is always current. */
  function renderPayslip(results) {
    const s = state.settings;
    const agg = { casova: 0, casovaH: 0, nahrSvat: 0, K: 0, G: 0, L: 0, H: 0, M: 0, N: 0, dov: 0, nem: 0, P: 0, E: 0, wDays: 0, prek: 0, prekH: 0, neodp: 0 };
    results.forEach(function (r, i) {
      const t = state.shifts[i] ? state.shifts[i].type : "volno";
      agg.wDays += (t === "den" || t === "noc") ? 1 : (t === "pulden" ? 0.5 : 0);
      if (r.isHolidayShift && r.holidayWork === false) agg.nahrSvat += r.J;
      else { agg.casova += r.J; agg.casovaH += s.baseRate ? r.J / s.baseRate : 0; }
      agg.K += r.K; agg.G += r.G; agg.L += r.L; agg.H += r.H; agg.M += r.M; agg.N += r.N;
      agg.nem += r.nem || 0; /* DPN náhrada — outside gross, paid net (08/2026) */
      agg.dov += (t === "prek") ? 0 : r.O;
      if (t === "prek") { /* doctor/propustka: half paid from PHV (in gross), half unpaid */
        agg.prek += r.O; agg.prekH += s.dayPaidHours / 2; agg.neodp += s.dayPaidHours / 2;
      }
      if (t === "den" || t === "noc" || t === "pulden") agg.neodp += Math.min(+state.shifts[i].lateHours || 0, s.dayPaidHours);
      agg.P += r.P; agg.E += r.E;
    });

    document.getElementById("psPeriod").textContent = I18n.monthName(state.month) + " " + state.year;
    const meta = [];
    if (state.name) meta.push(I18n.t("psName") + ": " + state.name);
    meta.push(I18n.t("psWorked") + ": " + I18n.fmtNum(agg.casovaH) + " " + I18n.t("hoursUnit") +
      " (" + I18n.fmtNum(agg.wDays) + " " + I18n.plural(agg.wDays, I18n.t("daysForms")) + ")");
    meta.push(I18n.t("psRateBase") + ": " + I18n.fmtNum(s.baseRate) + " " + I18n.t("u_kch"));
    meta.push(I18n.t("psRatePhv") + ": " + I18n.fmtNum(s.phvRate) + " " + I18n.t("u_kch"));
    if (state.attInfo && state.attInfo.fond > 0 && !(s.bonusMonthKc > 0)) {
      meta.push(I18n.t("attShare") + ": " + Math.round(state.attInfo.share * 100) + " % → " +
        (s.bonusVoid ? "0 % (" + I18n.t("attVoid") + ")" : Math.round(state.attInfo.pct * 100) + " %"));
    }
    document.getElementById("psMeta").textContent = meta.join("   ·   ");

    function rows(el, title, lines, totalKey, totalVal) {
      let html = '<thead><tr><th colspan="2">' + I18n.esc(title) + '</th><th class="ps-r">' +
        I18n.esc(I18n.t("hoursUnit")) + '</th><th class="ps-r">Kč</th></tr></thead><tbody>';
      lines.forEach(function (ln) {
        if (!ln || (Math.abs(ln.val) <= 0.004 && !ln.h)) return;
        html += '<tr><td colspan="2">' + I18n.esc(ln.label) + '</td><td class="ps-r">' +
          (ln.h ? I18n.fmtNum(ln.h) : "") + '</td><td class="ps-r">' + I18n.fmtNum(ln.val) + '</td></tr>';
      });
      html += '<tr class="ps-total"><td colspan="3">' + I18n.esc(I18n.t(totalKey)) + '</td><td class="ps-r">' +
        I18n.fmtMoney(totalVal) + '</td></tr></tbody>';
      document.getElementById(el).innerHTML = html;
    }

    /* náhrada za nemoc is outside gross/tax/insurance — deductions run on the
     * gross alone, the compensation is added to the payout afterwards */
    const det = Payroll.calcNettoDetail(agg.E, agg.E);
    const netOut = det.net + agg.nem;
    rows("psEarnings", I18n.t("psEarnings"), [
      { label: I18n.t("psTimeWage"), h: agg.casovaH, val: agg.casova },
      agg.nahrSvat ? { label: I18n.t("psNahrHoliday"), val: agg.nahrSvat } : null,
      agg.K ? { label: I18n.t("psNight"), h: agg.G, val: agg.K } : null,
      agg.L ? { label: I18n.t("psWeekend"), h: agg.H, val: agg.L } : null,
      agg.M ? { label: I18n.t("psOvertime"), val: agg.M } : null,
      agg.N ? { label: I18n.t("psHolidaySup"), val: agg.N } : null,
      agg.dov ? { label: I18n.t("psVacation"), val: agg.dov } : null,
      agg.prek ? { label: I18n.t("psPrek"), h: agg.prekH, val: agg.prek } : null,
      agg.neodp ? { label: I18n.t("psUnpaid"), h: agg.neodp, val: 0 } : null,
      agg.nem ? { label: I18n.t("psSick"), val: agg.nem } : null,
      agg.P ? { label: I18n.t("psBonus"), val: agg.P } : null
    ], "psGross", agg.E);

    rows("psDeductions", I18n.t("psDeductions"), [
      { label: I18n.t("psSocial"), val: det.socialni },
      { label: I18n.t("psHealth"), val: det.zdrav },
      { label: I18n.t("psTax"), val: det.dan }
    ], "psNet", netOut);

    document.getElementById("psNetLine").textContent = I18n.t("psNet") + ": " + I18n.fmtMoney(netOut);
  }

  /* ============ Render ============ */
  function renderMonthSelect() {
    monthSelect.innerHTML = "";
    for (let idx = 0; idx < 12; idx++) {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = I18n.monthName(idx);
      monthSelect.appendChild(opt);
    }
    monthSelect.value = state.month;
  }

  /* Years 2026 – 2126: far enough to never be a limit in practice. */
  function buildYearSelect() {
    yearSelect.innerHTML = "";
    const nowY = new Date().getFullYear();
    const start = Math.min(2026, nowY - 1);
    for (let y = start; y <= 2126; y++) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    }
    if (state.year >= start && state.year <= 2126) yearSelect.value = state.year;
    else yearSelect.value = String(nowY);
  }

  /* Single entry point re-render. The full-month result set is computed once and
   * shared between the calendar, the summary and the breakdown. */
  function renderAll() {
    document.documentElement.lang = I18n.getLang();
    document.title = I18n.t("appTitle");
    periodLabel.textContent = I18n.monthName(state.month) + " " + state.year;

    /* keep the quick rate fields in sync (also after changes from the settings panel) */
    if (document.activeElement !== rateBaseInput) rateBaseInput.value = state.settings.baseRate;
    if (document.activeElement !== ratePhvInput) ratePhvInput.value = state.settings.phvRate;
    if (document.activeElement !== bonusVoidInput) bonusVoidInput.checked = !!state.settings.bonusVoid;

    const holidayMap = holidayMapFor(state.year);

    const n = Payroll.daysInMonth(state.year, state.month);
    const resultsRaw = [];
    for (let i = 0; i < n; i++) {
      const entry = state.shifts[i] || { type: "volno", overtime: false, holidayWork: true };
      resultsRaw.push(Payroll.calcDay(new Date(state.year, state.month, i + 1), entry.type, entry, state.settings, holidayMap));
    }
    /* attendance bonus: tier model (10/6/2/0 % by counted-vs-fond share);
     * the fixed monthly amount from a payslip overrides the tiers */
    state.pattern = currentPattern();
    state.fondDays = state.pattern ? Payroll.countFondDays(state.year, state.month, state.pattern.weekdays) : 0;
    state.attInfo = Payroll.attendanceInfo(resultsRaw, state.shifts, state.settings, state.fondDays);
    const results = Payroll.withAttendanceBonus(resultsRaw, state.shifts, state.settings, state.fondDays);

    window.CalendarView.render(calendarWrap, {
      year: state.year, month: state.month,
      shifts: state.shifts, results: results,
      brush: state.brush,
      onChange: function (idx, patch) {
        state.shifts[idx].predicted = false; /* any manual edit makes the day real */
        if (patch.type) {
          state.shifts[idx].type = patch.type;
          if (patch.type !== "den" && patch.type !== "noc") {
            state.shifts[idx].overtime = false;
            state.shifts[idx].holidayWork = true;
          }
        }
        if (patch.overtime !== undefined && (state.shifts[idx].type === "den" || state.shifts[idx].type === "noc")) {
          state.shifts[idx].overtime = patch.overtime;
        }
        if (patch.holidayWork !== undefined &&
          (state.shifts[idx].type === "den" || state.shifts[idx].type === "noc" || state.shifts[idx].type === "pulden")) {
          state.shifts[idx].holidayWork = !!patch.holidayWork;
        }
        if (patch.lateHours !== undefined) {
          const lv = +patch.lateHours;
          state.shifts[idx].lateHours = (isFinite(lv) && lv > 0) ? Math.min(lv, 12) : 0;
        }
        persistAll();
        renderAll();
      },
      onPaint: function (idx) {
        const b = state.brush;
        const prev = state.shifts[idx] || {};
        state.shifts[idx] = {
          type: b.type,
          overtime: (b.type === "den" || b.type === "noc") ? !!b.overtime : false,
          /* keep the user's holiday preference for the day when repainting */
          holidayWork: prev.holidayWork !== false,
          /* lateness survives repainting the same day */
          lateHours: prev.lateHours || 0,
          predicted: false
        };
        /* update the shared result for this day so the totals stay live while painting;
         * re-derive the bonus layer from raw results (never double-apply) */
        resultsRaw[idx] = Payroll.calcDay(new Date(state.year, state.month, idx + 1), b.type, state.shifts[idx], state.settings, holidayMap);
        const painted = Payroll.withAttendanceBonus(resultsRaw, state.shifts, state.settings, state.fondDays || 0);
        window.CalendarView.refreshCell(calendarWrap, { year: state.year, month: state.month, shifts: state.shifts, results: painted, brush: b }, idx);
        renderSummary(painted);
        renderBreakdown(painted);
        renderPayslip(painted);
      },
      onPaintEnd: function () {
        persistAll();
        renderAll();
      }
    });

    renderSummary(results);
    renderBreakdown(results);
    renderPayslip(results);
  }

  /* ============ Events ============ */
  langSelect.addEventListener("change", function () {
    I18n.setLang(langSelect.value);
    I18n.apply(document);
    renderMonthSelect();
    buildSettingsForm();
    buildBrushBar();
    renderAll();
  });

  /* Changing month/year reloads that month's shifts from storage */
  monthSelect.addEventListener("change", function () {
    state.month = parseInt(monthSelect.value, 10);
    state.shifts = loadMonthShifts(state.year, state.month);
    renderAll();
  });
  yearSelect.addEventListener("change", function () {
    const y = parseInt(yearSelect.value, 10);
    if (isNaN(y)) return;
    state.year = y;
    state.shifts = loadMonthShifts(state.year, state.month);
    renderAll();
  });
  nameInput.addEventListener("change", function () { state.name = nameInput.value; persistAll(); });

  document.getElementById("btnResetDefaults").addEventListener("click", function () {
    state.settings = { ...Payroll.DEFAULT_SETTINGS };
    buildSettingsForm();
    persistAll();
    renderAll();
  });
  document.getElementById("btnPrint").addEventListener("click", function () {
    /* the print stylesheet hides interactive controls but keeps the breakdown */
    document.getElementById("breakdownPanel").open = true;
    window.print();
  });

  /* ============ Init ============ */
  I18n.apply(document);
  renderMonthSelect();
  buildYearSelect();
  buildSettingsForm();
  buildBrushBar();
  renderAll();
})();
