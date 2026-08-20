(function () {
  try {
    var stored = localStorage.getItem("compart-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : stored === "system"
          ? window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    var font = localStorage.getItem("compart-font");
    document.documentElement.style.fontSize = font === "lg" ? "18px" : "16px";
    var density = localStorage.getItem("compart-density");
    if (density === "compact" || density === "comfortable") {
      document.documentElement.setAttribute("data-density", density);
    }
    var color = theme === "light" ? "#c7c7cc" : "#1c1c1e";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", color);
    var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (bar) bar.setAttribute("content", theme === "light" ? "default" : "black-translucent");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
