// Get restaurant ID from URL or session
const urlParams = new URLSearchParams(window.location.search);
const restaurantId = urlParams.get('id');

// Check session if no ID in URL
if (!restaurantId) {
    fetch('/api/auth/me')
        .then(res => res.json())
        .then(data => {
            if (!data.success || data.requireLogin) {
                window.location.href = 'index.html';
            } else {
                window.location.href = `profile.html?id=${data.user.restaurantId}`;
            }
        })
        .catch(() => window.location.href = 'index.html');
}

// ===== PROFILE (foto + nome) =====
const AVATAR_SIZE = 256;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

let currentSettings = null;   // settings.json completo (serve per non perdere gli altri dati al salvataggio)
let currentName = '';
let currentLogo = null;
let pendingLogoDataUrl = null; // foto 256x256 scelta ma non ancora salvata

const profileAvatar = document.getElementById('profileAvatar');
const profileName = document.getElementById('profileName');
const editProfilePopup = document.getElementById('editProfilePopup');
const editAvatar = document.getElementById('editAvatar');
const editAvatarPreview = document.getElementById('editAvatarPreview');
const logoInput = document.getElementById('logoInput');
const nameInput = document.getElementById('nameInput');
const saveEdit = document.getElementById('saveEdit');
const cancelEdit = document.getElementById('cancelEdit');
const editProfileBtn = document.getElementById('editProfileBtn');

let toastTimeout;
function toast(msg, type = 'success') {
    const el = document.getElementById('profileToast');
    clearTimeout(toastTimeout);
    el.className = `profile-toast ${type}`;
    el.textContent = msg;
    void el.offsetWidth;
    el.classList.add('show');
    toastTimeout = setTimeout(() => el.classList.remove('show'), 3000);
}

function renderAvatar(container, src, name) {
    container.innerHTML = '';
    if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Foto profilo';
        img.onerror = () => renderAvatar(container, null, name);
        container.appendChild(img);
    } else {
        container.textContent = (name || '?').trim().charAt(0).toUpperCase();
    }
}

function renderProfile() {
    profileName.textContent = currentName || 'Il tuo ristorante';
    renderAvatar(profileAvatar, currentLogo, currentName);
}

async function loadProfile() {
    try {
        const res = await fetch(`/IDs/${restaurantId}/settings.json?t=${Date.now()}`);
        if (res.ok) {
            currentSettings = await res.json();
            currentName = currentSettings.restaurant?.name || '';
            currentLogo = currentSettings.restaurant?.logo || null;
        }
    } catch (err) {
        console.error('Errore caricamento profilo:', err);
    }
    renderProfile();
}

// Rende l'immagine quadrata 1:1 aggiungendo bordi trasparenti sui lati corti, poi la porta a 256x256
function squareAndResize(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            canvas.width = AVATAR_SIZE;
            canvas.height = AVATAR_SIZE;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';

            // Il lato lungo diventa 256, quello corto viene centrato (resto trasparente)
            const scale = AVATAR_SIZE / Math.max(img.naturalWidth, img.naturalHeight);
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);
            ctx.drawImage(img, Math.round((AVATAR_SIZE - w) / 2), Math.round((AVATAR_SIZE - h) / 2), w, h);

            resolve(canvas.toDataURL('image/png')); // PNG per mantenere la trasparenza
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Immagine non valida'));
        };
        img.src = url;
    });
}

function openEditPopup() {
    pendingLogoDataUrl = null;
    nameInput.value = currentName;
    nameInput.classList.remove('error');
    renderAvatar(editAvatarPreview, currentLogo, currentName);
    editProfilePopup.classList.add('show');
}

function closeEditPopup() {
    editProfilePopup.classList.remove('show');
    logoInput.value = '';
}

async function uploadLogo(dataUrl) {
    const res = await fetch('/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fileName: `logo-${restaurantId}.png`,
            fileData: dataUrl,
            restaurantId: restaurantId,
            oldImageUrl: currentLogo || null
        })
    });
    if (!res.ok) throw new Error('Errore upload immagine');
    const result = await res.json();
    if (!result.success) throw new Error(result.message || 'Upload fallito');
    return result.imageUrl;
}

async function saveProfile() {
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.classList.add('error');
        nameInput.focus();
        return;
    }

    saveEdit.disabled = true;
    saveEdit.textContent = 'Salvataggio...';

    try {
        let logoUrl = currentLogo;
        if (pendingLogoDataUrl) {
            logoUrl = await uploadLogo(pendingLogoDataUrl);
        }

        // Rileggo le impostazioni più recenti per non sovrascrivere altri dati
        let settings = currentSettings || {};
        try {
            const res = await fetch(`/IDs/${restaurantId}/settings.json?t=${Date.now()}`);
            if (res.ok) settings = await res.json();
        } catch (_) {}

        settings.restaurant = { ...(settings.restaurant || {}), name, logo: logoUrl };

        const saveRes = await fetch(`/save-settings/${restaurantId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings })
        });
        const result = await saveRes.json();
        if (!result.success) throw new Error(result.message || 'Errore salvataggio');

        currentSettings = settings;
        currentName = name;
        currentLogo = logoUrl;
        renderProfile();
        closeEditPopup();
        toast('Profilo aggiornato!');
    } catch (err) {
        console.error('Errore salvataggio profilo:', err);
        toast(err.message || 'Errore salvataggio', 'error');
    } finally {
        saveEdit.disabled = false;
        saveEdit.textContent = 'Salva';
    }
}

editProfileBtn.addEventListener('click', openEditPopup);
cancelEdit.addEventListener('click', closeEditPopup);
saveEdit.addEventListener('click', saveProfile);
editProfilePopup.addEventListener('click', (e) => {
    if (e.target === editProfilePopup) closeEditPopup();
});
nameInput.addEventListener('input', () => nameInput.classList.remove('error'));
nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveProfile();
});

editAvatar.addEventListener('click', () => logoInput.click());
editAvatar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        logoInput.click();
    }
});

logoInput.addEventListener('change', async () => {
    const file = logoInput.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        toast('Seleziona un\'immagine valida', 'error');
        return;
    }
    if (file.size > MAX_FILE_SIZE) {
        toast('Immagine troppo grande (max 5MB)', 'error');
        return;
    }

    try {
        pendingLogoDataUrl = await squareAndResize(file);
        renderAvatar(editAvatarPreview, pendingLogoDataUrl, currentName);
    } catch (err) {
        console.error('Errore elaborazione immagine:', err);
        toast('Impossibile leggere l\'immagine', 'error');
    }
});

// Set menu links

function setMenuLinks() {
    document.getElementById('menuCard').href = `gestione-menu.html?id=${restaurantId}`;
    document.getElementById('bannersCard').href = `create-banners.html?id=${restaurantId}`;
    document.getElementById('themeCard').href = `custom-theme.html?id=${restaurantId}`;

    const previewCard = document.getElementById('previewCard');
    previewCard.href = `menu.html?id=${restaurantId}`;

    previewCard.addEventListener('click', async (e) => {
        e.preventDefault();

        try {
            const response = await fetch(`IDs/${restaurantId}/menuTypes.json`);
            if (!response.ok) throw new Error('Errore caricamento menu');

            const data = await response.json();
            const menus = data.menuTypes || [];

            if (menus.length > 1) {
                window.location.href = `menu-select.html?id=${restaurantId}`;
            } else {
                const type = menus.length === 1
                    ? `&type=${encodeURIComponent(menus[0].id)}`
                    : '';

                window.location.href = `menu.html?id=${restaurantId}${type}`;
            }
        } catch (error) {
            console.error('Errore durante il controllo dei menu:', error);
            alert('Impossibile verificare i menu. Riprova.');
        }
    });
}

// QR Code functionality
function initQRCode() {
    const qrCard = document.getElementById('qrCard');
    const qrMenuPopup = document.getElementById('qrMenuPopup');
    const qrDisplayPopup = document.getElementById('qrDisplayPopup');
    const closeMenuSelect = document.getElementById('closeMenuSelect');
    const closeQR = document.getElementById('closeQR');
    const downloadQR = document.getElementById('downloadQR');
    const qrMenuList = document.getElementById('qrMenuList');
    
    let currentMenuName = '';

    // Open menu selection
    qrCard.addEventListener('click', async (e) => {
        e.preventDefault();
        await loadMenuTypes();
        qrMenuPopup.classList.add('show');
    });

    // Close menu selection
    closeMenuSelect.addEventListener('click', () => qrMenuPopup.classList.remove('show'));
    qrMenuPopup.addEventListener('click', (e) => {
        if (e.target === qrMenuPopup) qrMenuPopup.classList.remove('show');
    });

    // Close QR display
    closeQR.addEventListener('click', () => qrDisplayPopup.classList.remove('show'));
    qrDisplayPopup.addEventListener('click', (e) => {
        if (e.target === qrDisplayPopup) qrDisplayPopup.classList.remove('show');
    });

    // Load menu types
    async function loadMenuTypes() {
        try {
            const response = await fetch(`IDs/${restaurantId}/menuTypes.json`);
            const data = await response.json();
            
            qrMenuList.innerHTML = '';
            
            // Add menu-select option
            const selectItem = document.createElement('div');
            selectItem.className = 'qr-menu-item';
            selectItem.textContent = '> Pagina Scegli Menu';
            selectItem.addEventListener('click', () => {
                currentMenuName = 'Pagina Scegli Menu';
                generateQRCode('menu-select');
                qrMenuPopup.classList.remove('show');
                qrDisplayPopup.classList.add('show');
            });
            qrMenuList.appendChild(selectItem);
            
            // Add other menu types
            data.menuTypes.forEach(menu => {
                const menuItem = document.createElement('div');
                menuItem.className = 'qr-menu-item';
                menuItem.textContent = menu.name;
                menuItem.addEventListener('click', () => {
                    currentMenuName = menu.name;
                    generateQRCode(menu.id);
                    qrMenuPopup.classList.remove('show');
                    qrDisplayPopup.classList.add('show');
                });
                qrMenuList.appendChild(menuItem);
            });
            
        } catch (error) {
            console.error('Error loading menu types:', error);
            qrMenuList.innerHTML = '<div class="qr-error">Errore nel caricamento dei menu</div>';
        }
    }

    // Generate QR code using API with short URL and logo
    async function generateQRCode(menuType) {
        const canvas = document.getElementById('qrCanvas');
        const qrMenuName = document.getElementById('qrMenuName');
        
        const menuUrl = menuType === 'menu-select' 
            ? `https://totemino.it/menu-select.html?id=${restaurantId}`
            : `https://totemino.it/menu.html?id=${restaurantId}&type=${menuType}`;
        
        qrMenuName.textContent = currentMenuName;
        canvas.innerHTML = 'Generazione QR Code...';
        
        try {
            // Prova a creare short URL (opzionale, se fallisce usa l'originale)
            let finalUrl = menuUrl;
            
            try {
                const shortUrlResponse = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(menuUrl)}`);
                const shortData = await shortUrlResponse.json();
                if (shortData.shorturl) {
                    finalUrl = shortData.shorturl;
                }
            } catch (err) {
                
            }
            
            // Genera QR Code con logo più grande (0.3 = 30%)
            // NON codificare due volte - QuickChart si aspetta parametri normali
            const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(finalUrl)}&size=400&format=png&margin=1&ecLevel=H&centerImageUrl=https://totemino.it/img/faviconQR.png&centerImageSizeRatio=0.293`;
            
            // Crea immagine QR
            const img = document.createElement('img');
            img.src = qrImageUrl;
            img.alt = 'QR Code';
            img.style.width = '100%';
            img.style.height = 'auto';
            
            // Gestisci errore di caricamento immagine
            img.onerror = () => {
                canvas.innerHTML = 'Errore: impossibile generare il QR Code. Verifica che il logo sia accessibile.';
            };
            
            canvas.innerHTML = '';
            canvas.appendChild(img);
            
            // Salva l'URL dell'immagine per il download
            canvas.dataset.qrImageUrl = qrImageUrl;
            
        } catch (error) {
            console.error('Errore generazione QR:', error);
            canvas.innerHTML = 'Errore nella generazione del QR Code';
        }
    }

    // Download QR code
    downloadQR.addEventListener('click', async () => {
        const canvas = document.getElementById('qrCanvas');
        const qrImageUrl = canvas.dataset.qrImageUrl;
        
        if (qrImageUrl) {
            try {
                // Scarica l'immagine dal servizio API
                const response = await fetch(qrImageUrl);
                
                if (!response.ok) {
                    throw new Error('Impossibile scaricare il QR Code');
                }
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                const fileName = currentMenuName.toLowerCase().replace(/\s+/g, '-');
                link.download = `totemino-qr-${fileName}-${restaurantId}.png`;
                link.href = url;
                document.body.appendChild(link); // Aggiungi al DOM
                link.click();
                document.body.removeChild(link); // Rimuovi dal DOM
                
                // Libera memoria dopo un piccolo delay
                setTimeout(() => window.URL.revokeObjectURL(url), 100);
                
            } catch (error) {
                console.error('Errore download QR:', error);
                alert('Errore durante il download del QR Code. Riprova.');
            }
        } else {
            alert('Nessun QR Code da scaricare. Genera prima un QR Code.');
        }
    });
}

// Logout functionality
const logoutBtn = document.getElementById('logoutBtn');
const logoutPopup = document.getElementById('logoutPopup');
const cancelLogout = document.getElementById('cancelLogout');
const confirmLogout = document.getElementById('confirmLogout');

logoutBtn.addEventListener('click', () => logoutPopup.classList.add('show'));
cancelLogout.addEventListener('click', () => logoutPopup.classList.remove('show'));
logoutPopup.addEventListener('click', (e) => {
    if (e.target === logoutPopup) logoutPopup.classList.remove('show');
});

confirmLogout.addEventListener('click', async () => {
    try {
        confirmLogout.disabled = true;
        confirmLogout.textContent = 'Disconnessione...';
        
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            localStorage.removeItem('restaurantId');
            window.location.href = 'index.html';
        } else {
            throw new Error('Logout fallito');
        }
        
    } catch (error) {
        console.error('Errore durante il logout:', error);
        alert('Errore durante la disconnessione. Riprova.');
        confirmLogout.disabled = false;
        confirmLogout.textContent = 'Esci';
    }
});

// Initialize
if (restaurantId) {
    loadProfile();
    setMenuLinks();
}

// Initialize QR Code (non serve più la libreria QRCode.js)
window.addEventListener('load', () => {
    if (restaurantId) {
        initQRCode();
    }
});
