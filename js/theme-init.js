/* Applies the stored theme (or the OS preference) before first paint — no flash. */
(function () {
  "use strict";
  var theme = null;
  try { theme = localStorage.getItem("hpp_kalkulacka_theme_v1"); } catch (e) { /* private mode */ }
  if (theme !== "dark" && theme !== "light") {
    theme = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
