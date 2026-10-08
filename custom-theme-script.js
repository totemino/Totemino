class CustomThemeManager {
  constructor() {
    this.restaurantId = null;
    this.activeMode = 'light';
    this.themes = { light: { hue: 0, sat: 1 }, dark: { hue: 0, sat: 1 } };
    
    this.elements = {
      hueSlider: document.getElementById('hue-slider'),
      satSlider: document.getElementById('sat-slider'),
      hueValue: document.getElementById('hue-value'),
      satValue: document.getElementById('sat-value'),
      saveBtn: document.getElementById('save-theme-btn'),
      backBtn: document.getElementById('back-btn'),
      resetBtn: document.getElementById('reset-btn'),
      presetCards: document.querySelectorAll('.preset-card'),
      modeButtons: document.querySelectorAll('.mode-btn'),
      lightPreview: document.querySelector('.light-preview'),
      darkPreview: document.querySelector('.dark-preview'),
      notification: document.getElementById('notification')
    };
    
    this.init();
  }
  
  async init() {
    await this.checkAuth();
    await this.loadSettings();
    this.setupEventListeners();
    this.updateAll();
  }
  
  async checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (!data.success || data.requireLogin) {
        window.location.href = 'login.html';
        return;
      }
      this.restaurantId = data.user.restaurantId;
    } catch (error) {
      window.location.href = 'login.html';
    }
  }
  
  async loadSettings() {
    if (!this.restaurantId) return;
    
    try {
      const res = await fetch(`/IDs/${this.restaurantId}/settings.json`);
      if (!res.ok) return;
      
      const settings = await res.json();
      if (settings.customTheme?.light && settings.customTheme?.dark) {
        this.themes.light = settings.customTheme.light;
        this.themes.dark = settings.customTheme.dark;
        this.checkActivePreset();
      }
    } catch (error) {
      console.error('Errore caricamento:', error);
    }
  }
  
  checkActivePreset() {
    this.elements.presetCards.forEach(card => {
      const lightHue = parseInt(card.dataset.lightHue);
      const lightSat = parseFloat(card.dataset.lightSat);
      const darkHue = parseInt(card.dataset.darkHue);
      const darkSat = parseFloat(card.dataset.darkSat);
      
      if (this.themes.light.hue === lightHue && 
          this.themes.light.sat === lightSat &&
          this.themes.dark.hue === darkHue && 
          this.themes.dark.sat === darkSat) {
        card.classList.add('active');
      }
    });
  }
  
  setupEventListeners() {
    this.elements.hueSlider.addEventListener('input', () => this.handleSliderChange());
    this.elements.satSlider.addEventListener('input', () => this.handleSliderChange());
    
    this.elements.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });
    
    this.elements.presetCards.forEach(card => {
      card.addEventListener('click', () => this.applyPreset(card));
    });
    
    this.elements.resetBtn.addEventListener('click', () => this.resetToDefault());
    this.elements.saveBtn.addEventListener('click', () => this.saveTheme());
    this.elements.backBtn.addEventListener('click', () => {
      window.location.href = `profile.html?id=${this.restaurantId}`;
    });
    
    // Listener cambio tema pagina
    new MutationObserver(() => {
      this.updateGlows();
      this.applyToPage();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }
  
  handleSliderChange() {
    const current = this.themes[this.activeMode];
    current.hue = parseInt(this.elements.hueSlider.value);
    current.sat = parseFloat(this.elements.satSlider.value);
    
    this.updateAll();
    this.clearActivePreset();
  }
  
  switchMode(mode) {
    this.activeMode = mode;
    
    this.elements.modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    this.updateAll();
  }
  
  applyPreset(card) {
    this.themes.light = {
      hue: parseInt(card.dataset.lightHue),
      sat: parseFloat(card.dataset.lightSat)
    };
    this.themes.dark = {
      hue: parseInt(card.dataset.darkHue),
      sat: parseFloat(card.dataset.darkSat)
    };
    
    this.updateAll();
    this.setActivePreset(card);
  }
  
  resetToDefault() {
    this.themes = { light: { hue: 0, sat: 1 }, dark: { hue: 0, sat: 1 } };
    this.updateAll();
    this.clearActivePreset();
  }
  
  updateAll() {
    this.updateSliders();
    this.updateValues();
    this.updatePreviews();
    this.updateGlows();
    this.updateResetButton();
    this.applyToPage();
  }
  
  updateSliders() {
    const current = this.themes[this.activeMode];
    this.elements.hueSlider.value = current.hue;
    this.elements.satSlider.value = current.sat;
  }
  
  updateValues() {
    const current = this.themes[this.activeMode];
    this.elements.hueValue.textContent = `${current.hue}°`;
    this.elements.satValue.textContent = current.sat.toFixed(1);
  }
  
  updatePreviews() {
    const lightCircles = document.querySelectorAll('.light-preview .preview-circle');
    lightCircles.forEach(circle => {
      circle.style.filter = `hue-rotate(${this.themes.light.hue}deg) saturate(${this.themes.light.sat})`;
    });
    
    const darkCircles = document.querySelectorAll('.dark-preview .preview-circle');
    darkCircles.forEach(circle => {
      circle.style.filter = `hue-rotate(${this.themes.dark.hue}deg) saturate(${this.themes.dark.sat})`;
    });
  }
  
  updateGlows() {
    // Rimuovi tutti i glow
    this.elements.lightPreview.style.borderColor = '';
    this.elements.lightPreview.style.boxShadow = '';
    this.elements.darkPreview.style.borderColor = '';
    this.elements.darkPreview.style.boxShadow = '';
    
    // Applica glow solo al tema in editing
    const lightAccent = this.getAccentColor(this.themes.light.hue, 'light');
    const darkAccent = this.getAccentColor(this.themes.dark.hue, 'dark');
    
    if (this.activeMode === 'light') {
      this.elements.lightPreview.style.borderColor = lightAccent;
      this.elements.lightPreview.style.boxShadow = `0 0 15px ${lightAccent}cc`;
    } else {
      this.elements.darkPreview.style.borderColor = darkAccent;
      this.elements.darkPreview.style.boxShadow = `0 0 15px ${darkAccent}cc`;
    }
  }
  
  applyToPage() {
    const pageTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const current = this.themes[pageTheme];
    
    // Applica i valori CSS
    document.documentElement.style.setProperty('--bg-hue', `${current.hue}deg`);
    document.documentElement.style.setProperty('--bg-sat', current.sat);
    
    // Forza l'aggiornamento di accent-gold
    if (window.themeManager) {
      // Piccolo delay per assicurarsi che i valori CSS siano applicati
      setTimeout(() => {
        window.themeManager.updateAccentGold();
      }, 0);
    }
  }
  
  getAccentColor(hue, theme) {
    if (theme === 'light') {
      if (hue < 60) return "#ffd700";
      if (hue < 120) return "#c4ff30";
      if (hue < 180) return "#2aff95";
      if (hue < 240) return "#4eefe7";
      if (hue < 300) return "#9e9eff";
      return "#ff7cbe";
    } else {
      if (hue < 60) return "#468af7";
      if (hue < 120) return "#de4793";
      if (hue < 180) return "#dc7d00";
      if (hue < 240) return "#4fa910";
      if (hue < 300) return "#00a251";
      return "#00b4be";
    }
  }
  
  setActivePreset(card) {
    this.elements.presetCards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');
  }
  
  clearActivePreset() {
    this.elements.presetCards.forEach(c => c.classList.remove('active'));
  }
  
  updateResetButton() {
    const isDefault = this.themes.light.hue === 0 && this.themes.light.sat === 1 &&
                      this.themes.dark.hue === 0 && this.themes.dark.sat === 1;
    this.elements.resetBtn.style.display = isDefault ? 'none' : 'flex';
  }
  
  async saveTheme() {
    if (!this.restaurantId) {
      this.showNotification('Errore: ID ristorante non trovato', 'error');
      return;
    }
    
    try {
      const res = await fetch(`/IDs/${this.restaurantId}/settings.json`);
      if (!res.ok) throw new Error('Impossibile caricare le impostazioni');
      
      const settings = await res.json();
      settings.customTheme = this.themes;
      
      const saveRes = await fetch(`/save-settings/${this.restaurantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      
      const result = await saveRes.json();
      
      if (result.success) {
        this.showNotification('✓ Tema applicato con successo!', 'success');
      } else {
        throw new Error(result.message || 'Errore nel salvataggio');
      }
    } catch (error) {
      console.error('Errore salvataggio:', error);
      this.showNotification('✗ Errore nel salvataggio del tema', 'error');
    }
  }
  
  showNotification(message, type = 'success') {
    const notif = this.elements.notification;
    notif.textContent = message;
    notif.className = `notification ${type} show`;
    setTimeout(() => notif.classList.remove('show'), 3000);
  }
}

// Init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CustomThemeManager());
} else {
  new CustomThemeManager();
}