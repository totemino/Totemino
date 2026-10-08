/**
 * SISTEMA AUTENTICAZIONE CLIENT - VERSIONE OTTIMIZZATA
 */
(function() {
'use strict';

// === CONFIGURAZIONE ===
const CONFIG = {
    LOGIN_PAGE: 'login.html',
    ENDPOINTS: {
        ME: '/api/auth/me',
        LOGIN: '/api/auth/login',
        LOGOUT: '/api/auth/logout',
        REGISTER: '/api/auth/register'
    },
    REFRESH_INTERVAL: 5 * 60 * 1000,
    PROTECTED_PAGES: {
        hobby: ['gestione-menu.html'],
        premium: ['gestione.html','create-banners.html'],
        pro: ['statistics.html','create-promo.html','custom-theme.html']
    }
};

let currentUser = null;
let sessionInterval = null;

// === UTILITY ===
function showMessage(message, type = 'error') {
    const container = document.getElementById('message-container');
    if (container) {
        container.innerHTML = `<div class="message ${type}">${message}</div>`;
        setTimeout(() => container.innerHTML = '', type === 'success' ? 3000 : 5000);
    }
}

function redirectToLogin(message = null) {
    if (message) showMessage(message);
    setTimeout(() => window.location.href = CONFIG.LOGIN_PAGE, 1500);
}

function updateUrl(userId) {
    const url = new URL(window.location.href);
    url.searchParams.set('id', userId);
    window.history.replaceState({}, '', url.toString());
}

// === GERARCHIA PIANI ===
const PLAN_HIERARCHY = {
    'free': 0,
    'hobby': 1,
    'premium': 2,
    'pro': 3
};

function getPlanLevel(user) {
    // Trial = accesso Pro temporaneo
    if (user.isTrialActive) return PLAN_HIERARCHY['pro'];
    
    // Altrimenti usa planType
    return PLAN_HIERARCHY[user.planType || 'free'];
}

function hasAccess(userLevel, requiredPlan) {
    const requiredLevel = PLAN_HIERARCHY[requiredPlan] || 0;
    return userLevel >= requiredLevel;
}

// === API CALLS ===
async function apiCall(endpoint, options = {}) {
    const response = await fetch(endpoint, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    const data = await response.json();
    if (data.requireLogin) throw new Error('REQUIRE_LOGIN');
    return { response, data };
}

async function checkSession() {
    try {
        const { response, data } = await apiCall(CONFIG.ENDPOINTS.ME);
        return response.ok && data.success ? data.user : null;
    } catch (error) {
        return error.message === 'REQUIRE_LOGIN' ? null : null;
    }
}

// === CONTROLLO ACCESSO PAGINA ===
function checkPageAccess(user) {
    const currentPage = window.location.pathname.split('/').pop();
    const userLevel = getPlanLevel(user);
    
    // Controlla se la pagina richiede un piano specifico
    for (const [requiredPlan, pages] of Object.entries(CONFIG.PROTECTED_PAGES)) {
        if (pages.includes(currentPage)) {
            if (!hasAccess(userLevel, requiredPlan)) {
                // Redirect a upgrade.html con parametro need
                window.location.href = `upgrade.html?need=${requiredPlan}`;
                return false;
            }
        }
    }
    
    return true;
}

// === POPUP MANAGER ===
function createNeedPopup(planNeeded) {
    // Rimuovi popup esistenti
    document.querySelectorAll('[class*="need-"][class*="-popup"]').forEach(el => el.remove());
    
    const popup = document.createElement('div');
    popup.className = `need-${planNeeded}-popup`;
    popup.innerHTML = `
        <div class="popup-content">
            <p>Hai scoperto una funzione ${planNeeded}</p>
            <button class="close-popup">Chiudi</button>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // Chiusura popup
    popup.querySelector('.close-popup').addEventListener('click', () => {
        popup.remove();
    });
    
    // Chiusura cliccando fuori
    popup.addEventListener('click', (e) => {
        if (e.target === popup) popup.remove();
    });
}

function attachNeedHandlers(user) {
    const userLevel = getPlanLevel(user);
    
    // Handler per .need-hobby
    document.querySelectorAll('.need-hobby').forEach(el => {
        if (!hasAccess(userLevel, 'hobby')) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                createNeedPopup('hobby');
            }, true);
            
            el.style.cursor = 'not-allowed';
            el.style.opacity = '0.6';
        }
    });
    
    // Handler per .need-premium
    document.querySelectorAll('.need-premium').forEach(el => {
        if (!hasAccess(userLevel, 'premium')) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                createNeedPopup('premium');
            }, true);
            
            el.style.cursor = 'not-allowed';
            el.style.opacity = '0.6';
        }
    });
    
    // Handler per .need-pro
    document.querySelectorAll('.need-pro').forEach(el => {
        if (!hasAccess(userLevel, 'pro')) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                createNeedPopup('pro');
            }, true);
            
            el.style.cursor = 'not-allowed';
            el.style.opacity = '0.6';
        }
    });
}

// === AUTENTICAZIONE ===
async function validateAccess() {
    const user = await checkSession();
    if (!user) return redirectToLogin('Sessione non valida');

    // Verifica URL
    const urlId = new URLSearchParams(window.location.search).get('id');
    if (!urlId) {
        updateUrl(user.userCode);
    } else if (urlId !== user.userCode) {
        updateUrl(user.userCode);
        return window.location.reload();
    }

    // Controlla accesso alla pagina
    if (!checkPageAccess(user)) {
        return;
    }

    currentUser = user;
    applyUIControls(user);
    attachNeedHandlers(user);
    startSessionMonitoring();
    
    window.dispatchEvent(new CustomEvent('userAuthenticated', { detail: user }));
    return true;
}

function applyUIControls(user) {
    const userLevel = getPlanLevel(user);
    
    // Premium = hobby o superiore
    const isPremium = userLevel >= PLAN_HIERARCHY['hobby'];

    // Elementi premium (backward compatibility)
    document.querySelectorAll('.paywall-premium').forEach(el => {
        if (isPremium) {
            el.style.display = el.dataset.originalDisplay || 'block';
            el.classList.remove('paywall-blocked');
        } else {
            el.dataset.originalDisplay = el.style.display || 'block';
            el.style.display = 'none';
            el.classList.add('paywall-blocked');
        }
    });

    // Messaggi free
    document.querySelectorAll('.paywall-free-only').forEach(el => {
        el.style.display = isPremium ? 'none' : (el.dataset.originalDisplay || 'block');
    });

    // Badge trial
    if (user.isTrialActive) {
        document.querySelectorAll('[data-trial-badge]').forEach(el => {
            el.style.display = 'block';
            el.textContent = `🎁 Trial Pro: ${user.trialDaysLeft} giorni rimasti`;
        });
    } else {
        document.querySelectorAll('[data-trial-badge]').forEach(el => {
            el.style.display = 'none';
        });
    }

    // Aggiorna info utente
    document.querySelectorAll('[data-user-code]').forEach(el => el.textContent = user.userCode);
    document.querySelectorAll('[data-user-status]').forEach(el => {
        let statusText = 'Free';
        
        if (user.isTrialActive) {
            statusText = `Trial Pro (${user.trialDaysLeft}g)`;
        } else {
            // Mappa diretta planType → label
            const statusMap = {
                'free': 'Free',
                'hobby': 'Hobby',
                'premium': 'Premium',
                'pro': 'Pro'
            };
            statusText = statusMap[user.planType] || 'Free';
        }
        
        el.textContent = statusText;
        el.className = `status-${user.isTrialActive ? 'trial' : user.planType}`;
    });
}

function startSessionMonitoring() {
    if (sessionInterval) clearInterval(sessionInterval);
    sessionInterval = setInterval(async () => {
        const user = await checkSession();
        if (!user) {
            clearInterval(sessionInterval);
            redirectToLogin('Sessione scaduta');
        } else if (JSON.stringify(currentUser) !== JSON.stringify(user)) {
            currentUser = user;
            applyUIControls(user);
            attachNeedHandlers(user);
            
            // Ricontrolla accesso pagina (es. trial scaduto)
            checkPageAccess(user);
        }
    }, CONFIG.REFRESH_INTERVAL);
}

// === FORM HANDLERS ===
async function handleLogin(event) {
    event.preventDefault();
    
    const userCode = document.getElementById('loginUserCode').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');

    if (!userCode || !password) return showMessage('Inserisci ID utente e password');

    btn.innerHTML = '<span class="loading"></span>Accesso...';
    btn.disabled = true;

    try {
        const { data } = await apiCall(CONFIG.ENDPOINTS.LOGIN, {
            method: 'POST',
            body: JSON.stringify({ userCode, password })
        });

        if (data.success) {
            showMessage('Login effettuato con successo!', 'success');
            setTimeout(() => window.location.href = `gestione.html?id=${userCode}`, 1500);
        } else {
            showMessage(data.message);
        }
    } catch (error) {
        showMessage(error.message);
    } finally {
        btn.innerHTML = 'Accedi';
        btn.disabled = false;
    }
}

async function handleRegister(event) {
    event.preventDefault();
    
    const userCode = document.getElementById('newUserCode').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const btn = document.getElementById('registerBtn');

    // Validazioni
    if (!userCode || !/^\d{4}$/.test(userCode)) return showMessage('ID deve essere di 4 cifre numeriche');
    if (password !== confirmPassword) return showMessage('Le password non corrispondono');
    if (password.length < 8) return showMessage('Password deve avere almeno 8 caratteri');

    btn.innerHTML = '<span class="loading"></span>Registrazione...';
    btn.disabled = true;

    try {
        const { data } = await apiCall(CONFIG.ENDPOINTS.REGISTER, {
            method: 'POST',
            body: JSON.stringify({ userCode, password })
        });

        if (data.success) {
            showMessage('Registrazione completata! Ora puoi accedere.', 'success');
            setTimeout(() => {
                if (typeof switchTab === 'function') {
                    switchTab('login');
                    const loginField = document.getElementById('loginUserCode');
                    if (loginField) loginField.value = userCode;
                }
            }, 1000);
        } else {
            showMessage(data.message);
        }
    } catch (error) {
        showMessage(error.message);
    } finally {
        btn.innerHTML = 'Registrati';
        btn.disabled = false;
    }
}

async function handleLogout() {
    if (!confirm('Sei sicuro di voler uscire?')) return;
    
    try {
        await apiCall(CONFIG.ENDPOINTS.LOGOUT, { method: 'POST' });
    } catch (error) {
        console.error('Errore logout:', error);
    } finally {
        currentUser = null;
        clearInterval(sessionInterval);
        window.location.href = CONFIG.LOGIN_PAGE;
    }
}

// === INIZIALIZZAZIONE ===
function initForms() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    
    document.querySelectorAll('[data-logout-btn]').forEach(btn => {
        btn.addEventListener('click', handleLogout);
    });

    // Mostra errore dall'URL
    const error = new URLSearchParams(window.location.search).get('error');
    if (error) showMessage(decodeURIComponent(error));
}

function initialize() {
    const currentPage = window.location.pathname.split('/').pop();
    
    if (currentPage === 'login.html' || currentPage === '' || currentPage === 'index.html') {
        initForms();
    } else {
        validateAccess();
    }

    // Event listeners globali
    window.addEventListener('focus', () => currentUser && checkSession());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentUser) checkSession();
    });
}

// === API PUBBLICHE ===
window.SecureAuth = {
    getCurrentUser: () => currentUser,
    
    isPremiumUser: () => {
        if (!currentUser) return false;
        const userLevel = getPlanLevel(currentUser);
        return userLevel >= PLAN_HIERARCHY['hobby'];
    },
    
    isTrialActive: () => currentUser?.isTrialActive || false,
    
    getTrialDaysLeft: () => currentUser?.trialDaysLeft || 0,
    
    getUserPlanLevel: () => {
        if (!currentUser) return 0;
        return getPlanLevel(currentUser);
    },
    
    hasAccess: (requiredPlan) => {
        if (!currentUser) return false;
        const userLevel = getPlanLevel(currentUser);
        return hasAccess(userLevel, requiredPlan);
    },
    
    logout: handleLogout,
    
    refreshSession: () => checkSession().then(user => {
        if (user) {
            currentUser = user;
            applyUIControls(user);
            attachNeedHandlers(user);
            checkPageAccess(user);
            return user;
        } else {
            redirectToLogin('Sessione scaduta');
            return null;
        }
    })
};

// === AVVIO ===
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

})();