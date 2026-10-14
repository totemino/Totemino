/**
 * AUTENTICAZIONE CLIENT
 * Verifica la sessione, tiene l'URL allineato all'ID utente e gestisce il logout.
 * Non esistono piani: chi è loggato accede a tutte le pagine di gestione.
 */
(function() {
'use strict';

const CONFIG = {
    LOGIN_PAGE: 'login.html',
    ENDPOINTS: {
        ME: '/api/auth/me',
        LOGOUT: '/api/auth/logout'
    },
    REFRESH_INTERVAL: 5 * 60 * 1000
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

// === API ===
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
        return null;
    }
}

// === UI ===
function applyUserInfo(user) {
    document.querySelectorAll('[data-user-code]').forEach(el => el.textContent = user.userCode);
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

    currentUser = user;
    applyUserInfo(user);
    startSessionMonitoring();

    window.dispatchEvent(new CustomEvent('userAuthenticated', { detail: user }));
    return true;
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
            applyUserInfo(user);
        }
    }, CONFIG.REFRESH_INTERVAL);
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
function initialize() {
    document.querySelectorAll('[data-logout-btn]').forEach(btn => {
        btn.addEventListener('click', handleLogout);
    });

    validateAccess();

    window.addEventListener('focus', () => currentUser && checkSession());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentUser) checkSession();
    });
}

// === API PUBBLICHE ===
window.SecureAuth = {
    getCurrentUser: () => currentUser,
    logout: handleLogout,
    refreshSession: () => checkSession().then(user => {
        if (user) {
            currentUser = user;
            applyUserInfo(user);
            return user;
        }
        redirectToLogin('Sessione scaduta');
        return null;
    })
};

// === AVVIO ===
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

})();
