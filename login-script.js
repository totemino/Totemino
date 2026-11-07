// ===== CONFIGURAZIONE =====
const API_BASE = '/api/auth';
const INFO_ENDPOINT = '/api/info-request';

// ===== GESTIONE UI =====
class UIManager {
    static showMessage(message, type = 'error') {
        const container = document.getElementById('message-container');
        container.textContent = message;
        container.className = `message ${type}`;
        container.style.display = 'block';
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => this.clearMessage(), 3000);
        }
    }

    static clearMessage() {
        const container = document.getElementById('message-container');
        container.style.display = 'none';
        container.className = '';
        container.textContent = '';
    }

    static setButtonLoading(button, isLoading) {
        button.disabled = isLoading;
        button.textContent = isLoading ? 'Attendere...' : button.dataset.originalText;
    }
}

// ===== VALIDAZIONE =====
class Validator {
    static validateUserCode(code) {
        if (!code) return { valid: false, error: 'ID utente richiesto' };
        if (!/^\d{4}$/.test(code)) return { valid: false, error: 'ID deve essere di 4 cifre numeriche' };
        return { valid: true };
    }

    static validatePassword(password) {
        if (!password) return { valid: false, error: 'Password richiesta' };
        return { valid: true };
    }

    static validateEmail(email) {
        if (!email) return { valid: false, error: 'Email richiesta' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { valid: false, error: 'Inserisci un indirizzo email valido' };
        return { valid: true };
    }
}

// ===== API CALLS =====
class AuthAPI {
    static async login(userCode, password) {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userCode, password })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Errore durante il login');
        }

        return data;
    }

    static async checkAuth() {
        try {
            const response = await fetch(`${API_BASE}/me`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            
        }
        return null;
    }
}

class InfoAPI {
    static async send(payload) {
        const response = await fetch(INFO_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (!response.ok) {
            throw new Error(data.message || 'Impossibile inviare la richiesta. Riprova tra poco.');
        }

        return data;
    }
}

// ===== TAB SWITCHING =====
function initTabSwitching() {
    document.querySelectorAll('.login-toggle-btn').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabType = this.dataset.tab;
            
            // Update active tab
            document.querySelectorAll('.login-toggle-btn').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Update tabs container animation
            const tabsContainer = document.getElementById('loginTabs');
            tabsContainer.classList.toggle('register-active', tabType === 'register');
            
            // Show correct section
            document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`${tabType}-section`).classList.add('active');
            
            // Reset forms and UI
            UIManager.clearMessage();
            document.getElementById('loginForm').reset();
            document.getElementById('infoForm').reset();
            document.querySelectorAll('#infoForm .error').forEach(el => el.classList.remove('error'));
        });
    });
}

// ===== PASSWORD TOGGLE =====
function initPasswordToggle() {
    document.querySelectorAll('.password-toggle').forEach(toggle => {
        toggle.addEventListener('click', function() {
            const targetId = this.dataset.target;
            const input = document.getElementById(targetId);
            const eyeSlash = this.querySelector('.eye-slash');
            
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            eyeSlash.classList.toggle('visible', isPassword);
        });
    });
}

// ===== INPUT FORMATTING =====
function initInputFormatting() {
    // Auto-format user code (only numbers)
    document.querySelectorAll('input[pattern="[0-9]{4}"]').forEach(input => {
        input.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
        });
    });
}

// ===== LOGIN FORM =====
async function handleLogin(e) {
    e.preventDefault();
    
    const userCode = document.getElementById('loginUserCode').value.trim();
    const password = document.getElementById('loginPassword').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    UIManager.clearMessage();
    
    // Validazione
    const codeValidation = Validator.validateUserCode(userCode);
    if (!codeValidation.valid) {
        UIManager.showMessage(codeValidation.error, 'error');
        return;
    }
    
    const passwordValidation = Validator.validatePassword(password);
    if (!passwordValidation.valid) {
        UIManager.showMessage(passwordValidation.error, 'error');
        return;
    }
    
    // Submit
    UIManager.setButtonLoading(submitBtn, true);
    
    try {
        const result = await AuthAPI.login(userCode, password);
        UIManager.showMessage('Login effettuato con successo!', 'success');
        
        // Redirect dopo breve delay
        setTimeout(() => {
            window.location.href = `profile.html?id=${userCode}`;
        }, 500);
        
    } catch (error) {
        UIManager.showMessage(error.message, 'error');
        UIManager.setButtonLoading(submitBtn, false);
    }
}

// ===== INFO REQUEST FORM =====
async function handleInfoRequest(e) {
    e.preventDefault();

    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const val = id => document.getElementById(id).value.trim();

    UIManager.clearMessage();
    form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));

    const data = {
        restaurantName: val('restaurantName'),
        contactName: val('contactName'),
        contactEmail: val('contactEmail'),
        contactPhone: val('contactPhone'),
        city: val('city'),
        venueType: document.getElementById('venueType').value,
        tables: (form.querySelector('input[name="tables"]:checked') || {}).value || '',
        interests: Array.from(form.querySelectorAll('input[name="interests"]:checked'), i => i.value),
        currentSystem: document.getElementById('currentSystem').value,
        notes: val('notes'),
        privacyConsent: document.getElementById('privacyConsent').checked
    };

    const fail = (message, el) => {
        UIManager.showMessage(message, 'error');
        if (el) {
            el.classList.add('error');
            if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    if (!data.restaurantName) return fail('Inserisci il nome del locale', document.getElementById('restaurantName'));
    if (!data.contactName) return fail('Inserisci il tuo nome', document.getElementById('contactName'));

    const emailValidation = Validator.validateEmail(data.contactEmail);
    if (!emailValidation.valid) return fail(emailValidation.error, document.getElementById('contactEmail'));

    if (!data.venueType) return fail('Seleziona il tipo di locale', document.getElementById('venueType'));
    if (!data.tables) return fail('Indica quanti tavoli ha il tuo locale', form.querySelector('.choice-group').closest('.form-group'));
    if (!data.privacyConsent) return fail('Devi acconsentire al trattamento dei dati per inviare la richiesta', document.querySelector('.choice.consent'));

    UIManager.setButtonLoading(submitBtn, true);

    try {
        await InfoAPI.send(data);
        form.reset();
        UIManager.showMessage('Richiesta inviata! Ti ricontatteremo al più presto.', 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        UIManager.showMessage(error.message, 'error');
    } finally {
        UIManager.setButtonLoading(submitBtn, false);
    }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    // Store original button text
    document.querySelectorAll('button[type="submit"]').forEach(btn => {
        btn.dataset.originalText = btn.textContent;
    });
    
    // Initialize components
    initTabSwitching();
    initPasswordToggle();
    initInputFormatting();
    
    // Attach form handlers
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('infoForm').addEventListener('submit', handleInfoRequest);
    
    // Check if already authenticated
    const authData = await AuthAPI.checkAuth();
    if (authData && authData.success) {
        
        window.location.href = `profile.html?id=${authData.user.userCode}`;
    }
    
    
});

// ===== SECURITY =====
// Prevent context menu in production
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    document.addEventListener('contextmenu', (e) => e.preventDefault());

}
