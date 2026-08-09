/* Theme contract, shared with the tools on this origin (printor, glyph art):
   localStorage["sazonov-theme"] is "light", "dark", or absent for system, and
   the choice is stamped as data-theme on <html>. Do not rename either side. */
(function () {
  var KEY = "sazonov-theme";
  var ORDER = ["system", "light", "dark"];
  var root = document.documentElement;

  function apply(v) {
    if (v === "light" || v === "dark") root.setAttribute("data-theme", v);
    else root.removeAttribute("data-theme");
  }
  function state() { return root.getAttribute("data-theme") || "system"; }

  // Storage can be blocked outright, so every access is guarded.
  try { apply(localStorage.getItem(KEY)); } catch (e) {}

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    var names, prefix = button.getAttribute("data-theme-prefix") || "Theme";
    try { names = JSON.parse(button.getAttribute("data-theme-labels")); } catch (e) {}

    function sync() {
      var name = (names && names[state()]) || state();
      button.textContent = name;
      button.setAttribute("aria-label", prefix + ": " + name);
    }

    button.hidden = false;
    sync();
    button.addEventListener("click", function () {
      var next = ORDER[(ORDER.indexOf(state()) + 1) % 3];
      try {
        if (next === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch (e) {}
      apply(next);
      sync();
    });
  });
})();
