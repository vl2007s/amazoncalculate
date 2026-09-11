/**
 * Calendar view: month grid with an inline dropdown day editor and a paint brush.
 *
 * Interaction model (brush mode decides everything):
 *   - brush OFF -> click a day to open the dropdown editor (type / overtime / holiday)
 *   - brush ON  -> every touch paints: a plain click paints that one day, a drag
 *     paints everything under the pointer; no menus open while the brush is on
 *
 * Brush tracking uses pointermove + document.elementFromPoint, NOT pointerenter:
 * on touch devices the pointer is captured by the cell under the initial touch,
 * so pointerenter never fires for the cells the finger slides over. elementFromPoint
 * asks the DOM what is under the finger regardless of capture — works for mouse
 * and touch alike. touch-action:none on the active grid keeps drags from scrolling.
 *
 * CalendarView.render(container, ctx) — ctx:
 *   year, month            — the visible month
 *   shifts                 — [{type, overtime, holidayWork}] for the month (mutated via callbacks only)
 *   results                — per-day Payroll.calcDay results (amounts, holiday info)
 *   brush                  — {active, type, overtime}
 *   onChange(idx, patch)   — structured edit from the dropdown ({type} | {overtime} | {holidayWork});
 *                            the app patches state, persists and re-renders
 *   onPaint(idx)           — brush stroke over one day; app mutates state ONLY (no re-render)
 *   onPaintEnd()           — press released; app persists and does a full re-render
 *
 * All dynamic text is attached via textContent, so nothing here can inject markup.
 */
(function (root) {
  "use strict";
  const Payroll = root.Payroll, I18n = root.I18n;

  /* The popover is a single element reused for every day; it lives inside the
   * calendar wrap (position:relative) so absolute positioning is cell-relative.
   * On small screens CSS turns it into a fixed bottom sheet instead. */
  let popover = null;

  /* State of the current brush press, started on pointerdown and ended on
   * pointerup/pointercancel. Painting a single click is just a press that never moved. */
  let press = null;
  let paintEndCallback = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buildPopover(wrap) {
    popover = document.getElementById("dayPopover");
    wrap.appendChild(popover);
    /* stop clicks inside the popover from reaching the document-level closer */
    popover.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function (e) {
      if (!popover.classList.contains("open")) return;
      if (popover.contains(e.target)) return;
      /* a cell click opens its own dropdown while bubbling here — never close on it */
      if (e.target.closest && e.target.closest(".cal-day")) return;
      closePopover();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePopover();
    });
    document.addEventListener("pointermove", onBrushMove);
    document.addEventListener("pointerup", endBrushPress);
    /* the browser may cancel the press instead (scroll, OS gesture) — treat as release */
    document.addEventListener("pointercancel", endBrushPress);
  }

  function endBrushPress() {
    if (press && paintEndCallback) paintEndCallback();
    press = null;
  }

  /* While a press is active, paint whatever day is currently under the pointer.
   * Coordinates (not event targets) make this work on touch, where events are
   * delivered only to the cell that captured the pointer. */
  function onBrushMove(e) {
    if (!press || !press.ctx.brush.active) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const cell = hit && hit.closest ? hit.closest(".cal-day") : null;
    if (!cell || cell.classList.contains("pad") || cell.dataset.day === undefined) return;
    const day = parseInt(cell.dataset.day, 10);
    if (isNaN(day) || day === press.lastDay) return; /* dedupe repeated moves over one cell */
    press.lastDay = day;
    paintDay(press.container, press.ctx, day);
  }

  function closePopover() {
    if (!popover) return;
    popover.classList.remove("open");
  }

  function isMobileSheet() {
    return window.matchMedia("(max-width: 680px)").matches;
  }

  /* Place the dropdown just below the clicked cell, flipping above it near the
   * bottom edge of the wrap, and clamping horizontally so it never overflows. */
  function positionPopover(cell) {
    if (isMobileSheet()) { popover.style.left = popover.style.top = ""; return; }
    const wrap = popover.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const pw = popover.offsetWidth, ph = popover.offsetHeight;
    let left = cellRect.left - wrapRect.left + wrap.scrollLeft;
    let top = cellRect.bottom - wrapRect.top + wrap.scrollTop + 6;
    if (cellRect.bottom - wrapRect.top + ph + 24 > wrap.clientHeight) {
      top = cellRect.top - wrapRect.top + wrap.scrollTop - ph - 6;
    }
    left = Math.max(4, Math.min(left, wrap.clientWidth - pw - 4));
    popover.style.left = left + "px";
    popover.style.top = Math.max(4, top) + "px";
  }

  /* One dropdown row: color dot + label + checkmark on the active option. */
  function optionRow(cls, label, selected, onPick) {
    const b = el("button", "pop-opt" + (selected ? " sel" : ""));
    b.type = "button";
    b.appendChild(el("span", "dot " + cls));
    b.appendChild(el("span", "opt-label", label));
    if (selected) b.appendChild(el("span", "check", "✓"));
    b.addEventListener("click", onPick);
    return b;
  }

  function openDropdown(cell, dayIdx, ctx) {
    const date = new Date(ctx.year, ctx.month, dayIdx + 1);
    const entry = ctx.shifts[dayIdx];
    const res = ctx.results[dayIdx] || {};

    popover.innerHTML = "";

    const head = el("div", "pop-head");
    head.appendChild(el("span", null, I18n.fmtShortDate(date)));
    const closeBtn = el("button", "pop-close", "✕");
    closeBtn.type = "button";
    closeBtn.title = I18n.t("popoverClose");
    closeBtn.addEventListener("click", closePopover);
    head.appendChild(closeBtn);
    popover.appendChild(head);

    /* shift type options (legacy "svatek" is intentionally not offered) */
    const list = el("div", "pop-list");
    Payroll.WORK_TYPES.forEach(function (type) {
      list.appendChild(optionRow("t-" + type, I18n.t("type_" + type), entry.type === type, function () {
        ctx.onChange(dayIdx, { type: type });
      }));
    });
    popover.appendChild(list);

    popover.appendChild(el("div", "pop-sep"));

    /* overtime (přesčas) — only for real shifts, and irrelevant on a not-worked holiday */
    const ot = el("label", "pop-ot" + ((entry.type === "den" || entry.type === "noc") && entry.holidayWork !== false ? "" : " disabled"));
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!entry.overtime;
    cb.addEventListener("change", function () {
      ctx.onChange(dayIdx, { overtime: cb.checked });
    });
    ot.appendChild(cb);
    ot.appendChild(document.createTextNode(I18n.t("overtime")));
    popover.appendChild(ot);

    /* holiday choice — only shown when the shift actually touches a holiday */
    if (res.isHolidayShift) {
      popover.appendChild(el("div", "pop-sep"));
      const hol = el("div", "pop-hol");
      hol.appendChild(el("div", "pop-hol-title", I18n.t("holTitle") + (res.holidayName ? " — " + res.holidayName : "")));
      hol.appendChild(optionRow("t-den", I18n.t("holWork"), entry.holidayWork !== false, function () {
        ctx.onChange(dayIdx, { holidayWork: true });
      }));
      hol.appendChild(optionRow("t-volno", I18n.t("holOff"), entry.holidayWork === false, function () {
        ctx.onChange(dayIdx, { holidayWork: false });
      }));
      popover.appendChild(hol);
    }

    popover.classList.add("open");
    positionPopover(cell);
  }

  /* ---- brush painting ---- */

  function paintDay(container, ctx, day) {
    ctx.onPaint(day);                    /* app mutates state.shifts[day] */
    refreshCell(container, ctx, day);    /* update just this cell — a full re-render
                                            would replace the node under the cursor */
  }

  /**
   * In-place refresh of one cell (used by the brush). Cell index math mirrors
   * render(): grid children = 7 weekday headers + offset pads + day cells.
   */
  function refreshCell(container, ctx, dayIdx) {
    const grid = container.querySelector(".cal-grid");
    if (!grid || !grid.dataset.offset) return;
    const offset = parseInt(grid.dataset.offset, 10);
    const cell = grid.children[7 + offset + dayIdx];
    if (cell && cell.classList.contains("cal-day") && !cell.classList.contains("pad")) {
      fillCell(cell, dayIdx, ctx);
      /* pop animation as paint feedback (restart-safe if cells repaint fast) */
      cell.classList.remove("painted");
      void cell.offsetWidth; /* reflow restarts the animation */
      cell.classList.add("painted");
      cell.addEventListener("animationend", function done() {
        cell.classList.remove("painted");
        cell.removeEventListener("animationend", done);
      });
    }
  }

  function fillCell(cell, day, ctx) {
    const date = new Date(ctx.year, ctx.month, day + 1);
    const entry = ctx.shifts[day];
    const res = ctx.results[day] || {};
    const today = new Date();
    const isNahr = !!res.isHolidayShift && entry.holidayWork === false;

    cell.className = "cal-day t-" + entry.type +
      (Payroll.isWeekend(date) ? " is-weekend" : "") +
      (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate() ? " is-today" : "") +
      (isNahr ? " nahrada" : "");
    if (res.holidayName) cell.dataset.holiday = "1"; else delete cell.dataset.holiday;
    cell.title = res.holidayName || "";

    cell.setAttribute("aria-label", I18n.fmtShortDate(date) + " — " + I18n.t("type_" + entry.type));

    cell.innerHTML = "";
    cell.appendChild(el("span", "num", String(day + 1)));
    cell.appendChild(el("span", "chip", isNahr ? I18n.t("ts_nahr") : I18n.t("ts_" + entry.type)));
    if (res.holidayName) cell.appendChild(el("span", "hol", res.holidayName));
    cell.appendChild(el("span", "amt tabular", res.E ? I18n.fmtMoney(res.E) : "–"));
    if (entry.overtime && !isNahr) cell.appendChild(el("span", "ot-mark", "⚡"));
  }

  function createCell(day, ctx, container) {
    const cell = el("button", "cal-day");
    cell.type = "button";
    cell.setAttribute("role", "gridcell");
    cell.dataset.day = String(day); /* lets the brush find the day via elementFromPoint */
    fillCell(cell, day, ctx);

    cell.addEventListener("pointerdown", function (e) {
      if (!ctx.brush.active) return;
      /* brush owns the gesture: paint immediately and suppress the click entirely */
      e.preventDefault();
      press = { ctx: ctx, container: container, lastDay: day };
      paintDay(container, ctx, day);
    });
    cell.addEventListener("click", function (e) {
      /* brush on -> clicks paint (handled on pointerdown), menus stay shut */
      if (ctx.brush.active) return;
      /* the same click bubbles up to the document-level closer — keep the dropdown open */
      e.stopPropagation();
      openDropdown(cell, day, ctx);
    });
    return cell;
  }

  function render(container, ctx) {
    if (!popover || popover.parentElement !== container) buildPopover(container);
    /* rebuild the grid from scratch every render; keep the popover element alive */
    container.innerHTML = "";
    container.appendChild(popover);
    closePopover();
    paintEndCallback = ctx.onPaintEnd || null;

    const grid = el("div", "cal-grid" + (ctx.brush.active ? " brushing" : ""));
    grid.setAttribute("role", "grid");

    /* Monday-first weekday header (I18n.weekdayNames is already Monday-first) */
    I18n.weekdayNames().forEach(function (name) {
      grid.appendChild(el("div", "cal-wd", name));
    });

    const n = Payroll.daysInMonth(ctx.year, ctx.month);
    const offset = (new Date(ctx.year, ctx.month, 1).getDay() + 6) % 7;
    grid.dataset.offset = String(offset);
    for (let i = 0; i < offset; i++) grid.appendChild(el("div", "cal-day pad", " "));

    for (let day = 0; day < n; day++) {
      grid.appendChild(createCell(day, ctx, container));
    }

    container.appendChild(grid);
  }

  root.CalendarView = { render: render, closePopover: closePopover, refreshCell: refreshCell };
})(typeof self !== "undefined" ? self : this);
