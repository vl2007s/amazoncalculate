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
      out.push({
        type: Payroll.SHIFT_TYPES.indexOf(s.type) !== -1 ? s.type : "volno",
        overtime: !!s.overtime,
        holidayWork: s.holidayWork !== false
      });
    }
    return out;
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
  state.shifts = loadShifts(state.year, state.month, Payroll.daysInMonth(state.year, state.month));

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
  const settingsGrid = document.getElementById("settingsGrid");
  const breakdownTable = document.getElementById("breakdownTable");
  const toast = document.getElementById("toast");
  const saveIndicator = document.getElementById("saveIndicator");

  langSelect.value = I18n.getLang();
  nameInput.value = state.name;

  let toastTimer = null;
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

  /* ============ Settings form ============ */
  /* Built from Payroll.SETTINGS_FIELDS so the form always matches the math. */
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
    const hours = results.reduce(function (a, r) { return a + r.F; }, 0);
    const workedDays = state.shifts.filter(function (d) { return d.type !== "volno"; }).length;
    document.getElementById("sumGross").textContent = I18n.fmtMoney(gross);
    document.getElementById("sumNet").textContent = I18n.fmtMoney(Payroll.calcNetto(gross));
    document.getElementById("sumHours").textContent = I18n.fmtHours(hours);
    document.getElementById("sumDays").textContent = workedDays + " " + I18n.plural(workedDays, I18n.t("daysForms"));
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
      Object.keys(totals).forEach(function (k) { totals[k] += r[k]; });
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
        '<td class="tabular">' + I18n.fmtMoney(r.O) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.P) + "</td>" +
        '<td class="tabular">' + I18n.fmtMoney(r.E) + "</td>" +
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

    const holidayMap = holidayMapFor(state.year);

    const n = Payroll.daysInMonth(state.year, state.month);
    const results = [];
    for (let i = 0; i < n; i++) {
      const entry = state.shifts[i] || { type: "volno", overtime: false, holidayWork: true };
      results.push(Payroll.calcDay(new Date(state.year, state.month, i + 1), entry.type, entry, state.settings, holidayMap));
    }

    window.CalendarView.render(calendarWrap, {
      year: state.year, month: state.month,
      shifts: state.shifts, results: results,
      brush: state.brush,
      onChange: function (idx, patch) {
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
        if (patch.holidayWork !== undefined && (state.shifts[idx].type === "den" || state.shifts[idx].type === "noc")) {
          state.shifts[idx].holidayWork = !!patch.holidayWork;
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
          holidayWork: prev.holidayWork !== false
        };
        /* update the shared result for this day so the totals stay live while painting */
        results[idx] = Payroll.calcDay(new Date(state.year, state.month, idx + 1), b.type, state.shifts[idx], state.settings, holidayMap);
        window.CalendarView.refreshCell(calendarWrap, { year: state.year, month: state.month, shifts: state.shifts, results: results, brush: b }, idx);
        renderSummary(results);
        renderBreakdown(results);
      },
      onPaintEnd: function () {
        persistAll();
        renderAll();
      }
    });

    renderSummary(results);
    renderBreakdown(results);
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
    state.shifts = loadShifts(state.year, state.month, Payroll.daysInMonth(state.year, state.month));
    renderAll();
  });
  yearSelect.addEventListener("change", function () {
    const y = parseInt(yearSelect.value, 10);
    if (isNaN(y)) return;
    state.year = y;
    state.shifts = loadShifts(state.year, state.month, Payroll.daysInMonth(state.year, state.month));
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
