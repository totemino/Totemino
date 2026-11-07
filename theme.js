// ===============================
// THEME MANAGER
// Applica tema (chiaro/scuro), palette e sfondo scelti in settings.html.
// Funziona solo nelle pagine con ?id= nell'URL.
// ===============================
const BG_PATH_RE = /^img\/sfondi\/[\w.-]+\.svg$/;   // solo gli sfondi previsti
const HEX_RE = /^#[0-9a-f]{6}$/i;

class ThemeManager {
  constructor() {
    this.html = document.documentElement;
    this.themeButton = document.getElementById("theme");
    this.customTheme = null;     // vecchio sistema (hue/sat), mantenuto per compatibilità
    this.appearance = null;      // nuovo: { background, theme: { preset, mode, colors } }
    this.bgEl = null;

    const id = new URLSearchParams(window.location.search).get("id");
    this.restaurantId = id && /^[\w-]{1,20}$/.test(id) ? id : null;
    this.cacheKey = this.restaurantId ? `totemino_appearance_${this.restaurantId}` : null;

    this.init();
  }

  init() {
    // Al refresh della pagina la scelta del cliente viene scartata:
    // torna a valere la modalità (chiaro/scuro/auto) impostata dal ristorante.
    if (this.isReload()) {
      try { localStorage.removeItem("totemino_theme"); } catch (e) {}
    }

    // Ultima configurazione nota: evita lo sfarfallio tra una pagina e l'altra
    if (this.cacheKey) {
      try {
        this.appearance = JSON.parse(localStorage.getItem(this.cacheKey) || "null");
      } catch (e) {}
    }

    this.setTheme(this.resolveTheme());
    this.applyBackground();

    this.loadSettings();
    this.themeButton?.addEventListener("click", () => this.toggleTheme());
  }

  isReload() {
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav) return nav.type === "reload";
      return !!(performance.navigation && performance.navigation.type === 1);
    } catch (e) {
      return false;
    }
  }

  // Priorità: scelta del cliente (bottone tema) > modalità del ristorante > sistema
  resolveTheme() {
    const saved = localStorage.getItem("totemino_theme");
    if (saved === "dark" || saved === "light") return saved;

    const mode = this.appearance?.theme?.mode;
    if (mode === "dark" || mode === "light") return mode;

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  // persist = true solo quando è il cliente a scegliere con il bottone
  setTheme(theme, persist = false) {
    this.html.setAttribute("data-theme", theme);
    if (persist) localStorage.setItem("totemino_theme", theme);

    if (this.customTheme) {
      this.applyCustomTheme();
    } else {
      this.html.style.setProperty("--bg-hue", "0deg");
      this.html.style.setProperty("--bg-sat", "1");
    }

    this.updateAccentGold();
    this.dispatchThemeChange(theme);
  }

  toggleTheme() {
    const current = this.html.getAttribute("data-theme");
    this.setTheme(current === "dark" ? "light" : "dark", true);

    this.themeButton?.classList.add("theme-clicked");
    setTimeout(() => this.themeButton?.classList.remove("theme-clicked"), 200);
  }

  async loadSettings() {
    if (!this.restaurantId) return;

    try {
      const res = await fetch(`/IDs/${this.restaurantId}/settings.json`);
      if (!res.ok) return;
      const settings = await res.json();

      // vecchio tema hue/sat
      if (settings.customTheme?.light && settings.customTheme?.dark) {
        this.customTheme = settings.customTheme;
      }

      // nuovo aspetto da settings.html
      this.appearance = settings.appearance || null;
      try {
        localStorage.setItem(this.cacheKey, JSON.stringify(this.appearance));
      } catch (e) {}

      // se il cliente non ha scelto, vale la modalità del ristorante
      this.setTheme(this.resolveTheme());
      this.applyBackground();
    } catch (err) {
      console.error("Errore caricamento impostazioni:", err);
    }
  }

  applyCustomTheme() {
    if (!this.customTheme) return;

    const currentTheme = this.html.getAttribute("data-theme") || "light";
    const themeConfig = this.customTheme[currentTheme];
    if (!themeConfig) return;

    this.html.style.setProperty("--bg-hue", `${themeConfig.hue}deg`);
    this.html.style.setProperty("--bg-sat", themeConfig.sat);

    this.updateAccentGold();
  }

  // Colori: se il ristorante ha scelto una palette si usa quella,
  // altrimenti resta il comportamento originale basato sull'hue.
  updateAccentGold() {
    const currentTheme = this.html.getAttribute("data-theme") || "light";
    const colors = this.appearance?.theme?.colors;

    if (colors && HEX_RE.test(colors.accent) && HEX_RE.test(colors.accent2)) {
      const text = currentTheme === "dark" ? colors.textDark : colors.textLight;
      this.html.style.setProperty("--accent-gold", colors.accent);
      this.html.style.setProperty("--selected-glow", colors.accent + "cc");
      this.html.style.setProperty("--accent-pink", colors.accent2);
      if (HEX_RE.test(text)) this.html.style.setProperty("--text-accent", text);
      return;
    }

    // palette "Classico": rimuove eventuali override e usa la logica originale
    this.html.style.removeProperty("--accent-pink");
    this.html.style.removeProperty("--text-accent");

    const hue = parseFloat(
      getComputedStyle(this.html).getPropertyValue("--bg-hue").trim()
    );

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

    this.html.style.setProperty("--accent-gold", accentColor);
    this.html.style.setProperty("--selected-glow", accentColor + "cc");
  }

  // Sfondo: livello fisso sotto alle luci, chiaro al 20%
  applyBackground() {
    if (!this.restaurantId) return;

    const path = this.appearance?.background?.image;
    const valid = typeof path === "string" && BG_PATH_RE.test(path);

    if (!this.bgEl) {
      if (!valid) return;
      const style = document.createElement("style");
      style.textContent = `
        .bg-pattern {
          position: fixed; inset: 0; z-index: -2; pointer-events: none;
          background-position: center; background-size: cover; background-repeat: no-repeat;
          opacity: 0; transition: opacity .4s;
      
          /* invisibile fino a 100px, poi sfuma fino a pieno a 200px */
          -webkit-mask-image: linear-gradient(to bottom, transparent 72px, #000 384px);
                  mask-image: linear-gradient(to bottom, transparent 72px, #000 384px);
        }
        .bg-pattern.show { opacity: .08; }
        [data-theme="dark"] .bg-pattern { filter: invert(1); }
      `;
      document.head.appendChild(style);

      this.bgEl = document.createElement("div");
      this.bgEl.className = "bg-pattern";
      document.body.insertBefore(this.bgEl, document.body.firstChild);
    }

    if (!valid) {
      this.bgEl.classList.remove("show");
      return;
    }
    this.bgEl.style.backgroundImage = `url("${path}")`;
    requestAnimationFrame(() => this.bgEl.classList.add("show"));
  }

  dispatchThemeChange(theme) {
    document.dispatchEvent(new CustomEvent("themeChanged", { detail: { theme } }));
  }
}

// ===============================
// THEME IMAGES HANDLER
// ===============================
function updateThemeImages() {
  const theme = document.documentElement.getAttribute("data-theme") || "light";

  document.querySelectorAll(".theme-img:not(#logoSwap)").forEach(img => {
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
