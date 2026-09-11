/* Calendar view: month grid with a popover shift picker.
   CalendarView.render(container, ctx) — ctx: {year, month, shifts, results, onChange(idx, patch)} */
(function (root) {
  "use strict";
  const Payroll = root.Payroll, I18n = root.I18n;

  let popover = null, popDay = -1;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildPopover(wrap) {
    popover = document.getElementById("dayPopover");
    wrap.appendChild(popover); /* absolutely positioned within the calendar wrap */
    popover.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function (e) {
      if (popover.classList.contains("open") && !popover.contains(e.target)) closePopover();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePopover();
    });
  }

  function closePopover() {
    if (!popover) return;
    popover.classList.remove("open");
    popDay = -1;
  }

  function positionPopover(cell) {
    const wrap = popover.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const pw = popover.offsetWidth, ph = popover.offsetHeight;
    let left = cellRect.left - wrapRect.left + wrap.scrollLeft;
    let top = cellRect.bottom - wrapRect.top + wrap.scrollTop + 6;
    /* flip above when there is no room below */
    if (cellRect.bottom - wrapRect.top + ph + 24 > wrap.clientHeight) {
      top = cellRect.top - wrapRect.top + wrap.scrollTop - ph - 6;
    }
    left = Math.max(4, Math.min(left, wrap.clientWidth - pw - 4));
    popover.style.left = left + "px";
    popover.style.top = Math.max(4, top) + "px";
  }

  function openPopover(cell, dayIdx, ctx) {
    const date = new Date(ctx.year, ctx.month, dayIdx + 1);
    const entry = ctx.shifts[dayIdx];
    const holidayName = ctx.results[dayIdx] && ctx.results[dayIdx].holidayName;

    popover.innerHTML = "";

    const head = el("div", "pop-head");
    head.appendChild(el("span", null, I18n.fmtShortDate(date)));
    const closeBtn = el("button", "pop-close", "✕");
    closeBtn.type = "button";
    closeBtn.title = I18n.t("popoverClose");
    closeBtn.addEventListener("click", closePopover);
    head.appendChild(closeBtn);
    popover.appendChild(head);

    const types = el("div", "pop-types");
    Payroll.SHIFT_TYPES.forEach(function (type) {
      const b = el("button", "pop-type" + (entry.type === type ? " sel" : ""), I18n.t("type_" + type));
      b.type = "button";
      b.dataset.type = type;
      b.addEventListener("click", function () {
        ctx.onChange(dayIdx, { type: type });
        closePopover();
      });
      types.appendChild(b);
    });
    popover.appendChild(types);

    const ot = el("label", "pop-ot" + ((entry.type === "den" || entry.type === "noc") ? "" : " disabled"));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!entry.overtime;
    cb.addEventListener("change", function () {
      ctx.onChange(dayIdx, { overtime: cb.checked });
    });
    ot.appendChild(cb);
    ot.appendChild(document.createTextNode(I18n.t("overtime")));
    popover.appendChild(ot);

    if (holidayName) popover.appendChild(el("div", "hol", holidayName));

    popover.classList.add("open");
    popDay = dayIdx;
    positionPopover(cell);
  }

  function render(container, ctx) {
    if (!popover || popover.parentElement !== container) buildPopover(container);
    container.innerHTML = "";
    container.appendChild(popover); /* keep popover after innerHTML reset */
    closePopover();

    const grid = el("div", "cal-grid");
    grid.setAttribute("role", "grid");

    /* Monday-first weekday header */
    I18n.weekdayNames().forEach(function (name) {
      grid.appendChild(el("div", "cal-wd", name));
    });

    const n = Payroll.daysInMonth(ctx.year, ctx.month);
    const offset = (new Date(ctx.year, ctx.month, 1).getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid.appendChild(el("div", "cal-day pad", " "));

    const today = new Date();
    for (let day = 0; day < n; day++) {
      const date = new Date(ctx.year, ctx.month, day + 1);
      const entry = ctx.shifts[day];
      const res = ctx.results[day];

      const cell = el("button", "cal-day t-" + entry.type);
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", I18n.fmtShortDate(date) + " — " + I18n.t("type_" + entry.type));
      if (Payroll.isWeekend(date)) cell.classList.add("is-weekend");
      if (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
      ) cell.classList.add("is-today");
      if (res && res.holidayName) {
        cell.dataset.holiday = "1";
        cell.title = res.holidayName;
      }

      cell.appendChild(el("span", "num", String(day + 1)));
      cell.appendChild(el("span", "chip", I18n.t("ts_" + entry.type)));
      if (res && res.holidayName) cell.appendChild(el("span", "hol", res.holidayName));
      const amt = el("span", "amt tabular", res && res.E ? I18n.fmtMoney(res.E) : "–");
      cell.appendChild(amt);
      if (entry.overtime) cell.appendChild(el("span", "ot-mark", "⚡"));

      cell.addEventListener("click", function () { openPopover(cell, day, ctx); });
      grid.appendChild(cell);
    }

    container.appendChild(grid);
  }

  root.CalendarView = { render: render, closePopover: closePopover };
})(typeof self !== "undefined" ? self : this);
