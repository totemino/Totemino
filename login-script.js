// ===== CONFIGURAZIONE =====
const API_BASE = '/api/auth';
const MIN_PASSWORD_LENGTH = 8;

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

    static resetPasswordRequirements() {
        const container = document.getElementById('passwordRequirements');
        if (container) {
            container.classList.remove('success', 'error');
            container.querySelectorAll('.requirement').forEach(req => {
                req.classList.remove('valid', 'invalid');
            });
        }
    }
}

// ===== VALIDAZIONE =====
class Validator {
    static validateUserCode(code) {
        if (!code) return { valid: false, error: 'ID utente richiesto' };
        if (!/^\d{4}$/.test(code)) return { valid: false, error: 'ID deve essere di 4 cifre numeriche' };
        return { valid: true };
    }

    static validatePassword(password, isRegistration = false) {
        if (!password) return { valid: false, error: 'Password richiesta' };
        
        if (isRegistration) {
            const requirements = {
                length: password.length >= MIN_PASSWORD_LENGTH,
                number: /\d/.test(password)
            };

            if (!requirements.length) {
                return { valid: false, error: `Password deve essere di almeno ${MIN_PASSWORD_LENGTH} caratteri` };
            }
            if (!requirements.number) {
                return { valid: false, error: 'Password deve contenere almeno un numero' };
            }

            return { valid: true, requirements };
        }

        return { valid: true };
    }

    static validatePasswordMatch(password, confirm) {
        if (password !== confirm) {
            return { valid: false, error: 'Le password non coincidono' };
        }
        return { valid: true };
    }
}

// ===== GESTIONE PASSWORD REQUIREMENTS =====
function updatePasswordRequirements(password) {
    const requirements = {
        length: password.length >= MIN_PASSWORD_LENGTH,
        number: /\d/.test(password)
    };

    Object.keys(requirements).forEach(req => {
        const element = document.querySelector(`[data-req="${req}"]`);
        if (element) {
            element.classList.toggle('valid', requirements[req]);
            element.classList.toggle('invalid', !requirements[req] && password.length > 0);
        }
    });

    const allValid = Object.values(requirements).every(Boolean);
    const container = document.getElementById('passwordRequirements');
    if (container && password.length > 0) {
        container.classList.toggle('success', allValid);
        container.classList.toggle('error', !allValid);
    }

    return allValid;
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

    static async register(userCode, password) {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userCode, password })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Errore durante la registrazione');
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
            document.getElementById('registerForm').reset();
            UIManager.resetPasswordRequirements();
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

    // Password strength checker
    const newPasswordInput = document.getElementById('newUserPassword');
    if (newPasswordInput) {
        newPasswordInput.addEventListener('input', (e) => {
            updatePasswordRequirements(e.target.value);
        });
    }

    // Confirm password checker
    const confirmInput = document.getElementById('confirmPassword');
    if (confirmInput) {
        confirmInput.addEventListener('input', (e) => {
            const password = document.getElementById('newUserPassword').value;
            const confirm = e.target.value;
            
            if (confirm.length > 0) {
                e.target.classList.toggle('error', password !== confirm);
            } else {
                e.target.classList.remove('error');
            }
        });
    }
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

// ===== REGISTER FORM =====
async function handleRegister(e) {
    e.preventDefault();
    
    const userCode = document.getElementById('newUserCode').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    UIManager.clearMessage();
    
    // Validazione user code
    const codeValidation = Validator.validateUserCode(userCode);
    if (!codeValidation.valid) {
        UIManager.showMessage(codeValidation.error, 'error');
        return;
    }
    
    // Validazione password
    const passwordValidation = Validator.validatePassword(password, true);
    if (!passwordValidation.valid) {
        UIManager.showMessage(passwordValidation.error, 'error');
        return;
    }
    
    // Validazione password match
    const matchValidation = Validator.validatePasswordMatch(password, confirm);
    if (!matchValidation.valid) {
        UIManager.showMessage(matchValidation.error, 'error');
        return;
    }
    
    // Submit
    UIManager.setButtonLoading(submitBtn, true);
    
    try {
        const result = await AuthAPI.register(userCode, password);
        UIManager.showMessage('Registrazione completata! Accesso in corso...', 'success');
        
        // Auto-login dopo registrazione
        setTimeout(async () => {
            try {
                await AuthAPI.login(userCode, password);
                window.location.href = `profile.html?id=${userCode}`;
            } catch (error) {
                UIManager.showMessage('Registrazione completata. Effettua il login.', 'success');
                // Switch to login tab
                document.querySelector('[data-tab="login"]').click();
                UIManager.setButtonLoading(submitBtn, false);
            }
        }, 1000);
        
    } catch (error) {
        UIManager.showMessage(error.message, 'error');
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
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    
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
