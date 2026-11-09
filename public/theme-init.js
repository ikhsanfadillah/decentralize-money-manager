(function () {
  try {
    var saved = window.localStorage.getItem("dmm-theme-mode");
    var theme = saved === "light" ? "light" : "dark";
    var root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute(
        "content",
        theme === "dark" ? "#09090b" : "#fafafa"
      );
    }
    var metaScheme = document.querySelector('meta[name="color-scheme"]');
    if (metaScheme) {
      metaScheme.setAttribute("content", theme);
    }
  } catch (_) {}
})();

