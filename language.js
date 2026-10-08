// Traduzioni per i testi fissi dell'interfaccia
const uiTranslations = {
    'it': {
        'order': 'Il tuo ordine',
        'next': 'Avanti',
        'complete': 'Completa',
        'allergens': '- Allergeni -',
        'novelty': 'Novità'
    },
    'en': {
        'order': 'Your order',
        'next': 'Next',
        'complete': 'Complete',
        'allergens': '- Allergens -',
        'novelty': 'New'
    },
    'es': {
        'order': 'Tu pedido',
        'next': 'Siguiente',
        'complete': 'Completar',
        'allergens': '- Alérgenos -',
        'novelty': 'Novedad'
    },
    'fr': {
        'order': 'Votre commande',
        'next': 'Suivant',
        'complete': 'Terminer',
        'allergens': '- Allergènes -',
        'novelty': 'Nouveau'
    },
    'de': {
        'order': 'Ihre Bestellung',
        'next': 'Weiter',
        'complete': 'Abschließen',
        'allergens': '- Allergene -',
        'novelty': 'Neu'
    },
    'pt': {
        'order': 'Seu pedido',
        'next': 'Próximo',
        'complete': 'Concluir',
        'allergens': '- Alérgenos -',
        'novelty': 'Novidade'
    }
};

// Funzione per ottenere la lingua corrente
function getCurrentLanguage() {
    return window.currentLanguage || localStorage.getItem('totemino_language') || 'it';
}

// Funzione per salvare la lingua
function saveLanguage(lang) {
    window.currentLanguage = lang;
    localStorage.setItem('totemino_language', lang);
}

// Funzione per tradurre gli elementi fissi dell'interfaccia
function translateUIElements(lang) {
    const translations = uiTranslations[lang] || uiTranslations['it'];
    
    // Traduci "Il tuo ordine"
    const orderTitle = document.querySelector('.order h2:not(.price)');
    if (orderTitle) {
        orderTitle.textContent = translations.order;
    }
    
    // Traduci il bottone "Avanti" o "Completa"
    const nextBtn = document.querySelector('.next');
    if (nextBtn && typeof window.currentCategoryIndex !== 'undefined' && window.categories) {
        const isLastCategory = window.currentCategoryIndex === window.categories.length - 1;
        nextBtn.textContent = isLastCategory ? translations.complete : translations.next;
    }
    
    // Traduci "Allergeni" nel popup
    const allergenTitle = document.getElementById('titolo-allergeni');
    if (allergenTitle) {
        allergenTitle.textContent = translations.allergens;
    }
    
    // Traduci i badge "Novità"
    const noveltyBadges = document.querySelectorAll('.novita');
    noveltyBadges.forEach(badge => {
        badge.textContent = translations.novelty;
    });
}

// Funzione per cambiare lingua e ricaricare la pagina
function setLanguage(lang) {
    saveLanguage(lang);
    updateLanguageIcon(lang);
    
    // Ricarica la pagina per caricare il menu nella nuova lingua
    window.location.reload();
}

// Aggiorna l'icona con la lingua corrente
function updateLanguageIcon(lang) {
    const currentLangSpan = document.querySelector('.current-language');
    if (currentLangSpan) {
        currentLangSpan.textContent = lang.toUpperCase();
    }
}

// Funzione per ottenere il percorso del file menu in base alla lingua
function getMenuPath(restaurantId, lang) {
    return `IDs/${restaurantId}/menu_${lang}.json`;
}

// Inizializza il selettore di lingua
function initLanguageSwitcher() {
    const langButton = document.querySelector('.language-button');
    const dropdown = document.querySelector('.language-dropdown');
    
    if (!langButton || !dropdown) return;
    
    // Imposta la lingua corrente all'avvio
    const currentLang = getCurrentLanguage();
    updateLanguageIcon(currentLang);
    
    langButton.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
    
    document.addEventListener('click', () => {
        dropdown.style.display = 'none';
    });
    
    dropdown.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const lang = btn.dataset.lang;
            dropdown.style.display = 'none';
            setLanguage(lang);
        });
    });
}

// Aggiungi gli stili CSS per il dropdown
function addLanguageSwitcherStyles() {
    const style = document.createElement('style');
    style.textContent = `
    .language-dropdown {
        position: fixed;
        top: 60px;
        right: 70px;
        background: var(--bg-color, white);
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        overflow: hidden;
        min-width: 180px; /* 3 colonne da 50px + gap */
        min-height: 120px; /* 2 righe da 50px + gap */
        display: grid;
        grid-template-columns: repeat(3, 50px);
        grid-template-rows: repeat(2, 50px);
        gap: 10px;
        padding: 10px;
        z-index: 9998;
    }
    
    .language-dropdown button {
        width: 50px;
        height: 50px;
        padding: 0;
        border: none;
        background: var(--bg-color, white);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease;
    }
    
    .language-dropdown button img {
        max-width: 64px;
        max-height: 42px;
    }
    
    .language-dropdown button:hover {
        background: var(--hover-color, #f5f5f5);
    }
    
    .language-dropdown button:active {
        background: var(--active-color, #e0e0e0);
    }
    
    `;
    document.head.appendChild(style);
}

// Observer per tradurre elementi dinamici (come il bottone Next quando cambia categoria)
function observeUIChanges() {
    const observer = new MutationObserver(() => {
        const currentLang = getCurrentLanguage();
        if (currentLang !== 'it') {
            translateUIElements(currentLang);
        }
    });
    
    const nextBtn = document.querySelector('.next');
    if (nextBtn) {
        observer.observe(nextBtn, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }
}

// Inizializza quando il DOM è pronto
document.addEventListener('DOMContentLoaded', () => {
    addLanguageSwitcherStyles();
    initLanguageSwitcher();
    
    // Traduci gli elementi UI dopo un breve delay per assicurarsi che il menu sia caricato
    setTimeout(() => {
        const currentLang = getCurrentLanguage();
        if (currentLang !== 'it') {
            translateUIElements(currentLang);
        }
        observeUIChanges();
    }, 500);
});

// Esporta la funzione per il menu-script.js
window.getCurrentLanguage = getCurrentLanguage;
window.getMenuPath = getMenuPath;