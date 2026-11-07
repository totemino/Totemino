// ===============================
// THEME MANAGER
// Applica tema (chiaro/scuro), palette, luci e sfondo scelti in settings.html.
// Funziona solo nelle pagine con ?id= nell'URL.
// ===============================
const BG_PATH_RE = /^img\/sfondi\/[\w.-]+\.svg$/;   // solo gli sfondi previsti
const HEX_RE = /^#[0-9a-f]{6}$/i;

// HEX -> HSL (h in gradi, s e l tra 0 e 1)
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

const hsla = (h, s, l, a = 1) =>
  `hsla(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`;

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

  // Colori: se il ristorante ha scelto una palette si usa quella (accenti + luci di sfondo),
  // altrimenti resta il comportamento originale basato sull'hue.
  // --text-accent non viene mai toccato: titolo e hamburger restano come da CSS.
  updateAccentGold() {
    const dark = (this.html.getAttribute("data-theme") || "light") === "dark";
    const colors = this.appearance?.theme?.colors;

    if (colors && HEX_RE.test(colors.accent) && HEX_RE.test(colors.accent2)) {
      const a = hexToHsl(colors.accent);
      const b = hexToHsl(colors.accent2);

      // In chiaro restano quelli della palette (testo nero leggibile);
      // in scuro si abbassa la luminosità (testo crema leggibile, es. tag "Novità")
      const accent = dark ? hsla(a.h, Math.min(a.s, 0.65), 0.42) : colors.accent;
      const glow = dark ? hsla(a.h, Math.min(a.s, 0.65), 0.42, 0.8) : colors.accent + "cc";
      const accent2 = dark ? hsla(b.h, b.s, 0.45) : colors.accent2;

      this.html.style.setProperty("--accent-gold", accent);
      this.html.style.setProperty("--selected-glow", glow);
      this.html.style.setProperty("--accent-pink", accent2);

      // Luci di sfondo: stesse tonalità della palette, stessa trasparenza delle originali
      const sa = Math.min(1, a.s + 0.2);
      const sb = Math.min(1, b.s + 0.1);
      if (dark) {
        this.html.style.setProperty("--light1", hsla(a.h, sa, 0.5, 0.6));
        this.html.style.setProperty("--light2", hsla(b.h, sb, 0.5, 0.8));
        this.html.style.setProperty("--light3", hsla(b.h + 30, sb, 0.5, 0.6));
      } else {
        this.html.style.setProperty("--light1", hsla(a.h, sa, 0.7, 0.65));
        this.html.style.setProperty("--light2", hsla(b.h, sb, 0.65, 0.5));
        this.html.style.setProperty("--light3", hsla(b.h + 30, sb, 0.65, 0.3));
      }

      // il vecchio hue-rotate non deve spostare i colori della palette
      this.html.style.setProperty("--bg-hue", "0deg");
      this.html.style.setProperty("--bg-sat", "1");
      return;
    }

    // palette "Classico": rimuove ogni override e usa la logica originale
    this.html.style.removeProperty("--accent-pink");
    ["--light1", "--light2", "--light3"].forEach(v => this.html.style.removeProperty(v));

    const hue = parseFloat(
      getComputedStyle(this.html).getPropertyValue("--bg-hue").trim()
    );

    let accentColor;
    if (!dark) {
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

  // Sfondo: livello fisso sotto alle luci, con sfumatura dall'alto
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

          /* invisibile fino a 72px, poi sfuma fino a pieno a 384px */
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
