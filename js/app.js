/* App wiring: state, localStorage persistence, rendering (list view, calendar view,
 * summary, breakdown, settings form), language switching.
 *
 * State shape:
 *   settings — company rates (see Payroll.DEFAULT_SETTINGS)
 *   shifts   — [{type, overtime}] for the currently selected month, length = days in month
 * Persistence keys are versioned ("_v1") so a future schema change can migrate cleanly.
 */
(function () {
  "use strict";
  const Payroll = window.Payroll, I18n = window.I18n;

  /* ============ Storage (keys kept from the original single-file version) ============ */
  const LS_SETTINGS = "hpp_kalkulacka_settings_v1";
  const LS_NAME = "hpp_kalkulacka_name_v1";
  const LS_VIEW = "hpp_kalkulacka_view_v1";
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
   * normalizing every slot into a valid {type, overtime} pair. */
  function loadShifts(year, month, daysInMonth) {
    const key = lsShiftsKey(year, month);
    let arr = null;
    try { const raw = localStorage.getItem(key); if (raw) arr = JSON.parse(raw); } catch (e) { }
    if (!Array.isArray(arr)) arr = [];
    const out = [];
    for (let i = 0; i < daysInMonth; i++) {
      out.push(arr[i] && typeof arr[i] === "object"
        ? { type: arr[i].type || "volno", overtime: !!arr[i].overtime }
        : { type: "volno", overtime: false });
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
    view: (function () { try { return localStorage.getItem(LS_VIEW) || "calendar"; } catch (e) { return "calendar"; } })()
  };
  state.shifts = loadShifts(state.year, state.month, Payroll.daysInMonth(state.year, state.month));

  /* ============ DOM refs ============ */
  const langSelect = document.getElementById("langSelect");
  const monthSelect = document.getElementById("monthSelect");
  const yearInput = document.getElementById("yearInput");
  const periodLabel = document.getElementById("periodLabel");
  const dayList = document.getElementById("dayList");
  const calendarWrap = document.getElementById("calendarWrap");
  const nameInput = document.getElementById("nameInput");
  const settingsGrid = document.getElementById("settingsGrid");
  const breakdownTable = document.getElementById("breakdownTable");
  const toast = document.getElementById("toast");
  const saveIndicator = document.getElementById("saveIndicator");
  const btnViewCalendar = document.getElementById("btnViewCalendar");
  const btnViewList = document.getElementById("btnViewList");

  langSelect.value = I18n.getLang();
  yearInput.value = state.year;
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
        input.type = "number"; input.step = f.step; input.id = "set_" + f.key;
        /* pct fields are edited as percents (10) but stored as fractions (0.10) */
        input.value = f.pct ? Payroll.round4(state.settings[f.key] * 100) : state.settings[f.key];
        input.addEventListener("change", function () {
          let v = parseFloat(input.value);
          if (isNaN(v)) v = f.pct ? (Payroll.DEFAULT_SETTINGS[f.key] * 100) : Payroll.DEFAULT_SETTINGS[f.key];
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

  /* ============ Day list view ============ */
  /* One row per day. Dynamic text (holiday names) goes through textContent —
   * never innerHTML — so locale data can't become an injection vector. */
  function renderDayList(holidayMap) {
    const n = Payroll.daysInMonth(state.year, state.month);
    dayList.innerHTML = "";
    const results = [];
    for (let i = 0; i < n; i++) {
      const date = new Date(state.year, state.month, i + 1);
      const entry = state.shifts[i] || { type: "volno", overtime: false };
      const res = Payroll.calcDay(date, entry.type, entry.overtime, state.settings, holidayMap);
      results.push(res);

      const row = document.createElement("div");
      row.className = "day-row" + (res.isWeekend ? " is-weekend" : "") + (res.holidayName ? " is-holiday" : "");

      const dateCol = document.createElement("div"); dateCol.className = "date-col";
      const d1 = document.createElement("div"); d1.className = "d1";
      d1.textContent = I18n.fmtShortDate(date);
      const d2 = document.createElement("div"); d2.className = "d2";
      d2.textContent = res.holidayName || " ";
      dateCol.appendChild(d1); dateCol.appendChild(d2);
      row.appendChild(dateCol);

      const select = document.createElement("select");
      select.className = "type-select t-" + entry.type;
      Payroll.SHIFT_TYPES.forEach(function (key) {
        const opt = document.createElement("option");
        opt.value = key; opt.textContent = I18n.t("type_" + key);
        if (key === entry.type) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", function () {
        state.shifts[i].type = select.value;
        if (select.value !== "den" && select.value !== "noc") state.shifts[i].overtime = false;
        persistAll();
        renderAll();
      });
      row.appendChild(select);

      /* Overtime only makes sense for actual shifts (den/noc) */
      const otLabel = document.createElement("label");
      otLabel.className = "ot-label" + ((entry.type === "den" || entry.type === "noc") ? "" : " disabled");
      const otCheck = document.createElement("input");
      otCheck.type = "checkbox"; otCheck.checked = !!entry.overtime;
      otCheck.addEventListener("change", function () {
        state.shifts[i].overtime = otCheck.checked;
        persistAll();
        renderAll();
      });
      otLabel.appendChild(otCheck);
      otLabel.appendChild(document.createTextNode(I18n.t("overtime")));
      row.appendChild(otLabel);

      const totalCol = document.createElement("div"); totalCol.className = "total-col";
      const kc = document.createElement("div");
      kc.className = "kc tabular" + (res.E === 0 ? " zero" : "");
      kc.textContent = I18n.fmtMoney(res.E);
      totalCol.appendChild(kc);
      row.appendChild(totalCol);

      dayList.appendChild(row);
    }
    return results;
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
      Object.keys(totals).forEach(function (k) { totals[k] += r[k]; });
      rows += '<tr class="' + (r.isWeekend ? "wknd" : "") + '">' +
        "<td>" + (i + 1) + "</td>" +
        "<td>" + I18n.esc(I18n.fmtShortDate(date)) + "</td>" +
        "<td>" + I18n.esc(I18n.t("type_" + shift.type) + (shift.overtime ? I18n.t("otSuffix") : "")) + "</td>" +
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

  /* ============ View toggle ============ */
  function applyView() {
    const isCalendar = state.view === "calendar";
    calendarWrap.hidden = !isCalendar;
    dayList.hidden = isCalendar;
    btnViewCalendar.classList.toggle("active", isCalendar);
    btnViewList.classList.toggle("active", !isCalendar);
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

  /* Single entry point re-render. The full-month result set is computed once and
   * shared between the active view, the summary and the breakdown. */
  function renderAll() {
    document.documentElement.lang = I18n.getLang();
    document.title = I18n.t("appTitle");
    periodLabel.textContent = I18n.monthName(state.month) + " " + state.year;

    const holidayMap = holidayMapFor(state.year);

    const n = Payroll.daysInMonth(state.year, state.month);
    const results = [];
    for (let i = 0; i < n; i++) {
      const entry = state.shifts[i] || { type: "volno", overtime: false };
      results.push(Payroll.calcDay(new Date(state.year, state.month, i + 1), entry.type, entry.overtime, state.settings, holidayMap));
    }

    if (state.view === "calendar") {
      window.CalendarView.render(calendarWrap, {
        year: state.year, month: state.month,
        shifts: state.shifts, results: results,
        onChange: function (idx, patch) {
          if (patch.type) {
            state.shifts[idx].type = patch.type;
            if (patch.type !== "den" && patch.type !== "noc") state.shifts[idx].overtime = false;
          }
          if (patch.overtime !== undefined && (state.shifts[idx].type === "den" || state.shifts[idx].type === "noc")) {
            state.shifts[idx].overtime = patch.overtime;
          }
          persistAll();
          renderAll();
        }
      });
    } else {
      renderDayList(holidayMap);
    }

    renderSummary(results);
    renderBreakdown(results);
  }

  /* ============ Events ============ */
  langSelect.addEventListener("change", function () {
    I18n.setLang(langSelect.value);
    I18n.apply(document);
    renderMonthSelect();
    buildSettingsForm();
    renderAll();
  });

  /* Changing month/year reloads that month's shifts from storage */
  monthSelect.addEventListener("change", function () {
    state.month = parseInt(monthSelect.value, 10);
    state.shifts = loadShifts(state.year, state.month, Payroll.daysInMonth(state.year, state.month));
    renderAll();
  });
  yearInput.addEventListener("change", function () {
    let y = parseInt(yearInput.value, 10);
    if (isNaN(y) || y < 1900) y = new Date().getFullYear();
    state.year = y; yearInput.value = y;
    state.shifts = loadShifts(state.year, state.month, Payroll.daysInMonth(state.year, state.month));
    renderAll();
  });
  nameInput.addEventListener("change", function () { state.name = nameInput.value; persistAll(); });

  btnViewCalendar.addEventListener("click", function () {
    state.view = "calendar";
    try { localStorage.setItem(LS_VIEW, state.view); } catch (e) { }
    applyView(); renderAll();
  });
  btnViewList.addEventListener("click", function () {
    state.view = "list";
    try { localStorage.setItem(LS_VIEW, state.view); } catch (e) { }
    applyView(); renderAll();
  });

  /* Quick actions mutate the whole month at once (delegated, one listener) */
  document.querySelector(".quick-actions").addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const n = Payroll.daysInMonth(state.year, state.month);
    if (action === "clear" || action === "reset-month") {
      for (let i = 0; i < n; i++) state.shifts[i] = { type: "volno", overtime: false };
    } else if (action === "weekdays-den" || action === "weekdays-noc") {
      const t = action === "weekdays-den" ? "den" : "noc";
      for (let i = 0; i < n; i++) {
        const d = new Date(state.year, state.month, i + 1);
        if (!Payroll.isWeekend(d)) state.shifts[i] = { type: t, overtime: false };
      }
    } else if (action === "weekends-off") {
      for (let i = 0; i < n; i++) {
        const d = new Date(state.year, state.month, i + 1);
        if (Payroll.isWeekend(d)) state.shifts[i] = { type: "volno", overtime: false };
      }
    }
    persistAll();
    renderAll();
  });

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
  buildSettingsForm();
  applyView();
  renderAll();
})();
