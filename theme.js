// ===============================
// THEME MANAGER
// ===============================
class ThemeManager {
  constructor() {
    this.html = document.documentElement;
    this.themeButton = document.getElementById("theme");
    this.customTheme = null;

    this.init();
  }

  init() {
    const savedTheme =
      localStorage.getItem("totemino_theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");

    this.setTheme(savedTheme);
    this.loadCustomTheme();

    this.themeButton?.addEventListener("click", () => this.toggleTheme());
  }

  setTheme(theme) {
    this.html.setAttribute("data-theme", theme);
    localStorage.setItem("totemino_theme", theme);

    if (this.customTheme) {
      this.applyCustomTheme();
    } else {
      document.documentElement.style.setProperty("--bg-hue", "0deg");
      document.documentElement.style.setProperty("--bg-sat", "1");
    }

    this.updateAccentGold();
    this.dispatchThemeChange(theme);
  }

  toggleTheme() {
    const current = this.html.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";

    this.setTheme(next);

    this.themeButton?.classList.add("theme-clicked");
    setTimeout(() => {
      this.themeButton?.classList.remove("theme-clicked");
    }, 200);
  }

  async loadCustomTheme() {
    const params = new URLSearchParams(window.location.search);
    const restaurantId = params.get("id");
    if (!restaurantId) return;

    try {
      const res = await fetch(`/IDs/${restaurantId}/settings.json`);
      if (!res.ok) return;

      const settings = await res.json();

      if (
        settings.customTheme &&
        settings.customTheme.light &&
        settings.customTheme.dark
      ) {
        this.customTheme = settings.customTheme;
        this.applyCustomTheme();
      }
    } catch (err) {
      console.error("Errore caricamento tema custom:", err);
    }
  }

  applyCustomTheme() {
    if (!this.customTheme) return;

    const currentTheme =
      this.html.getAttribute("data-theme") || "light";

    const themeConfig = this.customTheme[currentTheme];
    if (!themeConfig) return;

    document.documentElement.style.setProperty(
      "--bg-hue",
      `${themeConfig.hue}deg`
    );
    document.documentElement.style.setProperty(
      "--bg-sat",
      themeConfig.sat
    );

    this.updateAccentGold();
  }

  updateAccentGold() {
    const bgHueValue = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg-hue")
      .trim();

    const hue = parseFloat(bgHueValue);
    const currentTheme = this.html.getAttribute("data-theme") || "light";

    let accentColor;

    if (currentTheme === "light") {
      if (hue >= 0 && hue < 60) accentColor = "#ffd700";
      else if (hue >= 60 && hue < 120) accentColor = "#c4ff30";
      else if (hue >= 120 && hue < 180) accentColor = "#2aff95";
      else if (hue >= 180 && hue < 240) accentColor = "#4eefe7";
      else if (hue >= 240 && hue < 300) accentColor = "#9e9eff";
      else accentColor = "#ff7cbe";
    } else {
      if (hue >= 0 && hue < 60) accentColor = "#468af7";
      else if (hue >= 60 && hue < 120) accentColor = "#de4793";
      else if (hue >= 120 && hue < 180) accentColor = "#dc7d00";
      else if (hue >= 180 && hue < 240) accentColor = "#4fa910";
      else if (hue >= 240 && hue < 300) accentColor = "#00a251";
      else accentColor = "#00b4be";
    }

    document.documentElement.style.setProperty("--accent-gold", accentColor);
    document.documentElement.style.setProperty(
      "--selected-glow",
      accentColor + "cc"
    );
  }

  dispatchThemeChange(theme) {
    document.dispatchEvent(
      new CustomEvent("themeChanged", { detail: { theme } })
    );
  }
}

// ===============================
// THEME IMAGES HANDLER
// ===============================
function updateThemeImages() {
  const theme =
    localStorage.getItem("totemino_theme") || "light";

  document
    .querySelectorAll(".theme-img:not(#logoSwap)")
    .forEach(img => {
      const light = img.getAttribute("data-light");
      const dark = img.getAttribute("data-dark");

      if (!light || !dark) return;
      img.src = theme === "dark" ? dark : light;
    });
}

// ===============================
// INIT (DOM READY ONLY)
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  window.themeManager = new ThemeManager();

  updateThemeImages();
  document.addEventListener("themeChanged", updateThemeImages);
});
