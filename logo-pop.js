const LOGO_SWAP_CONFIG = {
  maxLogos: 4,
  basePath: 'img/logo/',
  popImages: { light: 'img/logo/pop_light.png', dark: 'img/logo/pop_dark.png' },
  startNumber: 1
};

// ===== STILI CSS PER ANIMAZIONE CLICK E POP =====
const clickAnimationStyles = `<style id="logo-click-styles">
  #logoSwap {
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.1s ease;
  }
  
  #logoSwap:active {
    transform: scale(0.95);
  }
  
  .logo-pop-wrapper {
    position: relative;
    display: inline-block;
  }
  
  .logo-pop-effect {
    position: absolute;
    pointer-events: none;
    opacity: 0;
  }
  
  .logo-pop-effect.animate {
    animation: popEffect 0.4s ease-out forwards;
  }
  
  @keyframes popEffect {
    0% {
      opacity: 0;
      transform: scale(0.8) rotateZ(var(--pop-rotation));
    }
    50% {
      opacity: 1;
      transform: scale(1.2) rotateZ(var(--pop-rotation));
    }
    100% {
      opacity: 0;
      transform: scale(1.4) rotateZ(var(--pop-rotation));
    }
  }
</style>`;

// ===== GESTIONE LOGO SWAP =====
class SimpleLogoSwapper {
  constructor() {
    this.currentLogoNum = LOGO_SWAP_CONFIG.startNumber;
    this.rotation = 0;
    this.loadState();
    this.init();
  }

  init() {
    // Inserisci gli stili CSS se non presenti
    if (!document.getElementById('logo-click-styles')) {
      document.head.insertAdjacentHTML('beforeend', clickAnimationStyles);
    }

    // Trova tutte le immagini con id logoSwap
    this.logoImages = document.querySelectorAll('#logoSwap');
    
    if (this.logoImages.length === 0) {
      console.warn('Nessuna immagine con id="logoSwap" trovata');
      return;
    }

    // Aggiungi evento click e pop effect a ciascuna immagine
    this.logoImages.forEach(img => {
      // Crea un wrapper per il pop effect se non esiste già
      if (!img.parentElement.classList.contains('logo-pop-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'logo-pop-wrapper';
        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);
      }

      const wrapper = img.parentElement;

      // Crea l'elemento pop effect se non esiste
      let popEffect = wrapper.querySelector('.logo-pop-effect');
      if (!popEffect) {
        popEffect = document.createElement('img');
        popEffect.className = 'logo-pop-effect';
        popEffect.alt = '';
        wrapper.appendChild(popEffect);
      }

      img.addEventListener('click', (e) => this.handleClick(e, img));
    });

    // Imposta il logo iniziale su tutte le immagini
    this.updateAllLogos();
    this.updatePopImages();
  }

  updatePopImages() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    document.querySelectorAll('.logo-pop-effect').forEach(img => {
      img.src = LOGO_SWAP_CONFIG.popImages[theme];
    });
  }

  handleClick(event, img) {
    event.preventDefault();
    
    // Ottieni le dimensioni ATTUALI del logo al momento del click
    const logoRect = img.getBoundingClientRect();
    const logoSize = Math.max(logoRect.width, logoRect.height);
    const popSize = logoSize * 1.2; // 20% più grande
    
    // Gestisci animazione pop
    this.rotation = (this.rotation + 90) % 360;
    const wrapper = img.parentElement;
    const popEffect = wrapper.querySelector('.logo-pop-effect');
    
    if (popEffect) {
      // Aggiorna dimensioni e posizione del pop al momento del click
      popEffect.style.width = `${popSize}px`;
      popEffect.style.height = `${popSize}px`;
      
      // Calcola la posizione centrale rispetto al logo
      const wrapperRect = wrapper.getBoundingClientRect();
      const centerX = logoRect.left - wrapperRect.left + logoRect.width / 2;
      const centerY = logoRect.top - wrapperRect.top + logoRect.height / 2;
      
      popEffect.style.left = `${centerX}px`;
      popEffect.style.top = `${centerY}px`;
      popEffect.style.marginLeft = `${-popSize / 2}px`;
      popEffect.style.marginTop = `${-popSize / 2}px`;
      
      popEffect.style.setProperty('--pop-rotation', `${this.rotation}deg`);
      popEffect.classList.remove('animate');
      void popEffect.offsetWidth;
      popEffect.classList.add('animate');
    }
    
    // Passa al logo successivo (con loop)
    this.currentLogoNum++;
    if (this.currentLogoNum > LOGO_SWAP_CONFIG.maxLogos) {
      this.currentLogoNum = LOGO_SWAP_CONFIG.startNumber;
    }
    
    this.saveState();
    this.updateAllLogos();
  }

  updateAllLogos() {
    // Determina il tema corrente
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const logoPath = `${LOGO_SWAP_CONFIG.basePath}${this.currentLogoNum}_${theme}.png`;

    // Aggiorna tutte le immagini con id logoSwap
    this.logoImages.forEach(img => {
      img.src = logoPath;
      img.setAttribute('data-light', `${LOGO_SWAP_CONFIG.basePath}${this.currentLogoNum}_light.png`);
      img.setAttribute('data-dark', `${LOGO_SWAP_CONFIG.basePath}${this.currentLogoNum}_dark.png`);
    });
  }

  saveState() {
    localStorage.setItem('logo_swap_num', this.currentLogoNum.toString());
  }

  loadState() {
    const saved = localStorage.getItem('logo_swap_num');
    if (saved) {
      const num = parseInt(saved, 10);
      if (num >= LOGO_SWAP_CONFIG.startNumber && num <= LOGO_SWAP_CONFIG.maxLogos) {
        this.currentLogoNum = num;
      }
    }
  }

  reset() {
    this.currentLogoNum = LOGO_SWAP_CONFIG.startNumber;
    this.rotation = 0;
    this.saveState();
    this.updateAllLogos();
  }
}

// ===== INIZIALIZZAZIONE =====
function initLogoSwapper() {
  window.logoSwapper = new SimpleLogoSwapper();
  
  // Aggiorna quando cambia il tema
  document.addEventListener('themeChanged', () => {
    if (window.logoSwapper) {
      window.logoSwapper.updateAllLogos();
      window.logoSwapper.updatePopImages();
    }
  });
}

// Inizializza al caricamento della pagina
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLogoSwapper);
} else {
  initLogoSwapper();
}

// Esporta per uso globale
window.SimpleLogoSwapper = SimpleLogoSwapper;
window.LOGO_SWAP_CONFIG = LOGO_SWAP_CONFIG;