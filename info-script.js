// ===== CONFIG =====
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const restaurantId = new URLSearchParams(window.location.search).get("id") || "default";
let VAPID_PUBLIC_KEY = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  renderHoursInputs('opening-hours');
  renderHoursInputs('delivery-hours');
  setupEventListeners();
  await loadSettings(); // Unica fonte di verità
  await loadVapidKey();
  await checkNotificationStatus();
  await verifyStripeConnection();
});

// ===== EVENT LISTENERS =====
function setupEventListeners() {
  // Auto-save è stato rimosso. Tutto ora viene salvato solo su file.
  
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = `profile.html?id=${restaurantId}`;
  });
  
  document.getElementById('logo-input').addEventListener('change', handleLogoUpload);
  
  // Validazione campo telefono
  document.getElementById('phone').addEventListener('input', (e) => {
    let digits = e.target.value.replace(/\D/g, '').substring(0, 11);
    e.target.value = digits;
  });
  
  document.getElementById('reservations-enabled').addEventListener('change', e => {
    toggle('reservations-settings', e.target.checked);
  });
  
  document.getElementById('tables-enabled').addEventListener('change', e => {
    toggle('tables-management', e.target.checked);
  });

  document.getElementById('delivery-cost-type').addEventListener('change', e => {
    toggle('cost-fixed-group', e.target.value === 'fixed');
    toggle('cost-per-km-group', e.target.value === 'distance');
  });
  
  document.getElementById('same-hours-delivery').addEventListener('change', e => {
    toggle('delivery-hours-container', !e.target.checked);
  });
  
  document.getElementById('notify-whatsapp').addEventListener('change', e => {
    toggle('whatsapp-numbers-section', e.target.checked);
  });
  
  // ✅ LISTENER PER NOTIFICHE APP
  document.getElementById('notify-app').addEventListener('change', handleNotificationToggle);
}

// ===== NOTIFICATION TOGGLE =====
async function handleNotificationToggle(e) {
  const checkbox = e.target;
  
  if (checkbox.checked) {
    // Vuole attivare
    const success = await enablePushNotifications();
    if (!success) {
      checkbox.checked = false;
    }
  } else {
    // Vuole disattivare
    await disablePushNotifications();
  }
}

// ===== ENABLE PUSH NOTIFICATIONS =====
async function enablePushNotifications() {
  try {
    console.log('🔔 Tentativo attivazione notifiche...');
    
    // 1. Verifica supporto
    if (!('serviceWorker' in navigator)) {
      notify('Il browser non supporta i Service Worker', 'error');
      return false;
    }
    
    if (!('PushManager' in window)) {
      notify('Il browser non supporta le notifiche push', 'error');
      return false;
    }
    
    if (!('Notification' in window)) {
      notify('Il browser non supporta le notifiche', 'error');
      return false;
    }
    
    // 2. Controlla permesso esistente
    console.log('📋 Permesso attuale:', Notification.permission);
    
    if (Notification.permission === 'denied') {
      notify('Hai bloccato le notifiche. Abilitale nelle impostazioni del browser', 'error');
      return false;
    }
    
    // 3. Richiedi permesso se necessario
    if (Notification.permission === 'default') {
      console.log('🔔 Richiesta permesso...');
      const permission = await Notification.requestPermission();
      console.log('✅ Permesso ricevuto:', permission);
      
      if (permission !== 'granted') {
        notify('Devi concedere il permesso per ricevere notifiche', 'error');
        return false;
      }
    }
    
    // 4. Disregistra SW vecchi
    const registrations = await navigator.serviceWorker.getRegistrations();
    console.log('🔍 SW registrati:', registrations.length);
    
    for (const reg of registrations) {
      console.log('❌ Rimozione SW vecchio...');
      await reg.unregister();
    }
    
    // 5. Registra nuovo SW
    console.log('📝 Registrazione nuovo SW...');
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/'
    });
    
    console.log('✅ SW registrato:', registration);
    
    // 6. Aspetta che sia pronto
    await navigator.serviceWorker.ready;
    console.log('✅ SW pronto');
    
    // 7. Carica chiave VAPID
    if (!VAPID_PUBLIC_KEY) {
      console.log('🔑 Caricamento chiave VAPID...');
      await loadVapidKey();
    }
    
    if (!VAPID_PUBLIC_KEY) {
      notify('Errore: chiave VAPID non disponibile', 'error');
      return false;
    }
    
    console.log('🔑 Chiave VAPID caricata');
    
    // 8. Rimuovi subscription vecchia
    const oldSub = await registration.pushManager.getSubscription();
    if (oldSub) {
      console.log('❌ Rimozione subscription vecchia...');
      await oldSub.unsubscribe();
    }
    
    // 9. Crea nuova subscription
    console.log('📝 Creazione subscription...');
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    
    console.log('✅ Subscription creata:', subscription);
    
    // 10. Invia al server
    console.log('📤 Invio al server...');
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
    
    const data = await res.json();
    console.log('📥 Risposta server:', data);
    
    if (!data.success) {
      throw new Error(data.message || 'Errore nella sottoscrizione');
    }
    
    notify('✅ Notifiche push attivate!', 'success');
    return true;
    
  } catch (err) {
    console.error('❌ Errore attivazione notifiche:', err);
    notify('Errore: ' + err.message, 'error');
    return false;
  }
}

// ===== DISABLE PUSH NOTIFICATIONS =====
async function disablePushNotifications() {
  try {
    console.log('🔕 Disattivazione notifiche...');
    
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      notify('Nessuna notifica attiva', 'success');
      return;
    }
    
    // Rimuovi dal server
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    
    // Disiscriviti
    await subscription.unsubscribe();
    console.log('✅ Notifiche disattivate');
    
    notify('Notifiche push disattivate', 'success');
    
  } catch (err) {
    console.error('❌ Errore disattivazione:', err);
    notify('Errore nella disattivazione', 'error');
  }
}

// ===== CHECK NOTIFICATION STATUS =====
async function checkNotificationStatus() {
  try {
    console.log('🔍 Verifica stato notifiche...');
    
    const checkbox = document.getElementById('notify-app');
    
    // Verifica supporto
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('❌ Browser non supportato');
      checkbox.disabled = true;
      checkbox.checked = false;
      const card = checkbox.closest('.option-card');
      card.classList.add('disabled');
      return;
    }
    
    // Verifica permesso
    if (Notification.permission === 'denied') {
      console.log('❌ Permesso negato');
      checkbox.disabled = true;
      checkbox.checked = false;
      const card = checkbox.closest('.option-card');
      card.classList.add('disabled');
      return;
    }
    
    // Verifica subscription
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
    if (subscription) {
      console.log('✅ Subscription attiva');
      checkbox.checked = true;
      checkbox.disabled = false;

      const card = checkbox.closest('.option-card');
      card.classList.remove('disabled');

    } else {
      console.log('ℹ️ Nessuna subscription');
      checkbox.checked = false;
      checkbox.disabled = false;

      const card = checkbox.closest('.option-card');
      card.classList.remove('disabled');
    }

    } catch (err) {
      console.log('⚠️ SW non registrato');
      checkbox.checked = false;
      checkbox.disabled = false;

      const card = checkbox.closest('.option-card');
      card.classList.remove('disabled');
    }    
  } catch (err) {
    console.error('❌ Errore verifica notifiche:', err);
    document.getElementById('notify-app').checked = false;
  }
}

// ===== LOAD VAPID KEY =====
async function loadVapidKey() {
  try {
    console.log('🔑 Caricamento chiave VAPID...');
    const res = await fetch('/api/push/vapid-public-key');
    
    if (!res.ok) {
      throw new Error('Errore caricamento chiave VAPID');
    }
    
    const data = await res.json();
    
    if (!data.success || !data.publicKey) {
      throw new Error('Chiave VAPID non trovata');
    }
    
    VAPID_PUBLIC_KEY = data.publicKey;
    console.log('✅ Chiave VAPID caricata');
    
  } catch (err) {
    console.error('❌ Errore caricamento VAPID:', err);
    throw err;
  }
}

// ===== UTILITY: VAPID CONVERSION =====
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ===== TABLES MANAGEMENT =====
function addTable() {
  const list = document.getElementById('tables-list');
  const tableCount = list.children.length + 1;
  
  const div = document.createElement('div');
  div.className = 'table-item';
  div.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.8rem; align-items: center;';
  div.innerHTML = `
    <input type="text" placeholder="Nome tavolo (es. Tavolo 1)" data-field="name" 
          value="Tavolo ${tableCount}" 
          style="padding: 0.8rem; border: 2px solid var(--btn-secondary); border-radius: 1rem; background: var(--pill-bg); color: var(--text-primary);">
    <input type="number" placeholder="Posti" data-field="seats" min="1" max="20" 
          style="padding: 0.8rem; border: 2px solid var(--btn-secondary); border-radius: 1rem; background: var(--pill-bg); color: var(--text-primary);">
    <button class="remove-table-btn" onclick="removeTable(this)" 
            style="background: #e53e3e; color: white; border: none; border-radius: 50%; width: 2.5rem; height: 2.5rem; cursor: pointer; font-size: 1.5rem;">
      ×
    </button>
  `;
  
  list.appendChild(div);
}

function removeTable(btn) {
  btn.parentElement.remove();
}

function collectTables() {
  return Array.from(document.querySelectorAll('.table-item')).map(item => ({
    name: item.querySelector('[data-field="name"]').value,
    seats: parseInt(item.querySelector('[data-field="seats"]').value) || 0
  })).filter(t => t.name && t.seats > 0);
}

// ===== RENDER HOURS =====
function renderHoursInputs(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = DAYS.map(day => `
    <div class="day-hours">
      <label>${day}</label>
      <div class="time-pills">
        ${[1, 2].map(slot => `
          <div class="time-pill" data-day="${day}" data-slot="${slot}">
            <input type="time" data-type="open" value="${slot === 1 ? '11:00' : '18:00'}">
            <span class="time-pill-divider">-</span>
            <input type="time" data-type="close" value="${slot === 1 ? '14:00' : '01:00'}">
          </div>
          <button class="reset-slot-btn" onclick="toggleSlot(this)">
            <i class="fas fa-times"></i>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleSlot(btn) {
  const pill = btn.previousElementSibling;
  const inputs = pill.querySelectorAll('input');
  const icon = btn.querySelector('i');
  const isRemoved = pill.dataset.removed === 'true';
  
  if (isRemoved) {
    inputs[0].value = pill.dataset.savedOpen || '';
    inputs[1].value = pill.dataset.savedClose || '';
    pill.dataset.removed = 'false';
    pill.style.opacity = '1';
    pill.style.pointerEvents = 'auto';
    icon.className = 'fas fa-times';
    btn.classList.remove('restore');
  } else {
    pill.dataset.savedOpen = inputs[0].value;
    pill.dataset.savedClose = inputs[1].value;
    inputs[0].value = '';
    inputs[1].value = '';
    pill.dataset.removed = 'true';
    pill.style.opacity = '0.3';
    pill.style.pointerEvents = 'none';
    icon.className = 'fas fa-redo';
    btn.classList.add('restore');
  }
}

function collectHours(containerId) {
  const container = document.getElementById(containerId);
  const hours = {};
  
  DAYS.forEach((day, idx) => {
    const dayLower = day.toLowerCase();
    const dayRow = container.children[idx];
    const slots = {};
    let hasSlots = false;
    
    [1, 2].forEach(slot => {
      const pill = dayRow.querySelector(`.time-pill[data-slot="${slot}"]`);
      const inputs = pill.querySelectorAll('input');
      const open = inputs[0].value;
      const close = inputs[1].value;
      
      if (open && close) {
        slots[`slot${slot}`] = { open, close };
        hasSlots = true;
      }
    });
    
    hours[dayLower] = hasSlots ? slots : { closed: true };
  });
  
  return hours;
}

function loadHours(containerId, hoursData) {
  if (!hoursData) return;
  
  DAYS.forEach((day, idx) => {
    const dayLower = day.toLowerCase();
    const dayHours = hoursData[dayLower];
    if (!dayHours) return;
    
    const container = document.getElementById(containerId);
    const dayRow = container.children[idx];
    
    [1, 2].forEach(slot => {
      const pill = dayRow.querySelector(`.time-pill[data-slot="${slot}"]`);
      const btn = pill.nextElementSibling;
      const inputs = pill.querySelectorAll('input');
      const slotData = dayHours[`slot${slot}`];
      
      if (slotData) {
        inputs[0].value = slotData.open || '';
        inputs[1].value = slotData.close || '';
      } else {
        pill.dataset.savedOpen = inputs[0].value;
        pill.dataset.savedClose = inputs[1].value;
        inputs[0].value = '';
        inputs[1].value = '';
        pill.dataset.removed = 'true';
        pill.style.opacity = '0.3';
        pill.style.pointerEvents = 'none';
        btn.querySelector('i').className = 'fas fa-redo';
        btn.classList.add('restore');
      }
    });
  });
}

// ===== CLOSURES =====
function addClosure() {
  const container = document.getElementById('exceptional-closures');
  const div = document.createElement('div');
  div.className = 'closure-item';
  div.innerHTML = `
    <input type="text" placeholder="Motivo (es. Ferie)" data-field="title">
    <input type="date" data-field="start">
    <input type="date" data-field="end">
    <button class="remove-closure-btn" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(div);
}

function collectClosures() {
  return Array.from(document.querySelectorAll('.closure-item')).map(item => ({
    title: item.querySelector('[data-field="title"]').value,
    start: item.querySelector('[data-field="start"]').value,
    end: item.querySelector('[data-field="end"]').value
  })).filter(c => c.title && c.start && c.end);
}

// ===== LOGO (Senza localStorage) =====
async function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const preview = document.getElementById('logo-preview');
  const existingImg = preview.querySelector('img');
  const existingImgSrc = existingImg?.src;

  // Validazione tipo file
  if (!file.type.startsWith('image/')) {
    notify('Seleziona un\'immagine valida', 'error');
    return;
  }

  // Validazione dimensione (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    notify('Immagine troppo grande (max 5MB)', 'error');
    return;
  }

  try {
    notify('Caricamento logo...', 'success');

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target.result;

      try {
        const uploadRes = await fetch('/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileData: base64Data,
            restaurantId: restaurantId,
            oldImageUrl: existingImgSrc || null
          })
        });

        if (!uploadRes.ok) throw new Error('Errore upload immagine');

        const result = await uploadRes.json();
        if (!result.success) throw new Error(result.message || 'Upload fallito');

        // Preview definitiva solo se l'upload ha successo
        preview.innerHTML = `<img src="${result.imageUrl}" alt="Logo Ristorante">`;
        notify('Logo caricato con successo!', 'success');

      } catch (uploadErr) {
        console.error('❌ Errore upload:', uploadErr);
        
        // Ripristino: se c'era un'immagine prima, la mantengo
        if (existingImgSrc) {
          preview.innerHTML = `<img src="${existingImgSrc}" alt="Logo Ristorante">`;
        } else {
          // Se non c'era nessun logo, mostra il placeholder
          preview.innerHTML = `<div class="logo-preview-placeholder">Nessun logo</div>`;
        }
        
        notify(uploadErr.message || 'Errore caricamento logo', 'error');
      }
    };

    reader.onerror = () => {
      notify('Errore lettura file', 'error');
    };

    reader.readAsDataURL(file);

  } catch (err) {
    console.error('❌ Errore:', err);
    notify('Errore nel caricamento', 'error');
  }
}

// ===== WHATSAPP =====
function addWhatsAppNumber() {
  const list = document.getElementById('whatsapp-numbers-list');
  if (list.children.length >= 5) {
    notify('Massimo 5 numeri', 'error');
    return;
  }
  
  const div = document.createElement('div');
  div.className = 'whatsapp-number-item';
  div.style.cssText = 'display: flex; gap: 0.5rem; align-items: center;';
  div.innerHTML = `
    <input type="tel" placeholder="321 456 7890" style="flex: 1; padding: 0.6rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--bg-secondary);">
    <button onclick="removeWhatsAppNumber(this)" style="padding: 0.6rem 0.8rem; background: #ef4444; color: white; border: none; border-radius: 0.5rem; cursor: pointer;">
      <i class="fas fa-trash"></i>
    </button>
  `;
  
  list.appendChild(div);
  
  const input = div.querySelector('input');
  input.addEventListener('input', (e) => {
    let digits = e.target.value.replace(/\D/g, '').substring(0, 10);
    let formatted = '';
    if (digits.length > 0) formatted += digits.substring(0, 3);
    if (digits.length > 3) formatted += ' ' + digits.substring(3, 6);
    if (digits.length > 6) formatted += ' ' + digits.substring(6, 10);
    e.target.value = formatted;
  });
  
  if (list.children.length >= 5) {
    document.getElementById('add-whatsapp-btn').style.display = 'none';
  }
}

function removeWhatsAppNumber(btn) {
  btn.parentElement.remove();
  document.getElementById('add-whatsapp-btn').style.display = 'block';
}

function collectWhatsAppNumbers() {
  return Array.from(document.querySelectorAll('.whatsapp-number-item input'))
    .map(input => input.value.trim())
    .filter(num => num);
}

// ===== LOAD SETTINGS (Unica fonte di verità) =====
async function loadSettings() {
  try {
    const res = await fetch(`/IDs/${restaurantId}/settings.json`);
    if (!res.ok) {
      console.log('ℹ️ Nessun file settings trovato, utilizzo valori di default');
      return;
    }
    
    const settings = await res.json();
    
    // Restaurant
    if (settings.restaurant) {
      setValue('#restaurant-name', settings.restaurant.name);
      setValue('#owner-name', settings.restaurant.owner);
      setValue('#restaurant-street', settings.restaurant.street);
      setValue('#restaurant-number', settings.restaurant.number);
      setValue('#restaurant-cap', settings.restaurant.cap);
      setValue('#phone', settings.restaurant.phone);
      setValue('#email', settings.restaurant.email);
      
      if (settings.restaurant.logo) {
        document.getElementById('logo-preview').innerHTML = 
          `<img src="${settings.restaurant.logo}" alt="Logo Ristorante">`;
      }
    }
    
    // Hours
    loadHours('opening-hours', settings.schedule?.openingHours);
    
    // Closures
    document.getElementById('exceptional-closures').innerHTML = '';
    settings.schedule?.exceptionalClosures?.forEach(closure => {
      addClosure();
      const item = document.querySelector('.closure-item:last-child');
      item.querySelector('[data-field="title"]').value = closure.title || '';
      item.querySelector('[data-field="start"]').value = closure.start || '';
      item.querySelector('[data-field="end"]').value = closure.end || '';
    });
    
    // Prenotazioni
    if (settings.reservations) {
      const r = settings.reservations;
      
      document.getElementById('reservations-enabled').checked = r.enabled || false;
      toggle('reservations-settings', r.enabled);
      
      setValue('#max-people-per-slot', r.maxPeoplePerSlot);
      setValue('#slot-duration', r.slotDuration);
      setValue('#advance-booking-days', r.advanceBookingDays);
      setValue('#min-advance-minutes', r.minAdvanceMinutes);
      
      document.getElementById('tables-enabled').checked = r.tablesEnabled || false;
      toggle('tables-management', r.tablesEnabled);
      
      if (r.tables && r.tables.length > 0) {
        document.getElementById('tables-list').innerHTML = '';
        r.tables.forEach(table => {
          addTable();
          const item = document.querySelector('.table-item:last-child');
          item.querySelector('[data-field="name"]').value = table.name;
          item.querySelector('[data-field="seats"]').value = table.seats;
        });
      }
    }

    // Delivery
    const d = settings.delivery || {};
    setValue('#delivery-radius', d.radius);
    setValue('#min-order', d.minOrder);
    setValue('#prep-time', d.prepTime);
    setValue('#delivery-cost-type', d.costType || 'distance');
    setValue('#delivery-cost-fixed', d.costFixed);
    setValue('#delivery-cost-per-km', d.costPerKm);
    setValue('#free-delivery-threshold', d.freeDeliveryThreshold);
    
    document.getElementById('same-hours-delivery').checked = d.sameAsOpeningHours || false;
    toggle('cost-fixed-group', d.costType === 'fixed');
    toggle('cost-per-km-group', d.costType !== 'fixed');
    toggle('delivery-hours-container', !d.sameAsOpeningHours);
    
    if (!d.sameAsOpeningHours) {
      loadHours('delivery-hours', d.deliveryHours);
    }
    
    // Notifications
    document.getElementById('notify-app').checked = settings.notifications?.app !== false;
    document.getElementById('notify-printer').checked = settings.notifications?.printer || false;
    document.getElementById('notify-whatsapp').checked = settings.notifications?.whatsapp || false;
    toggle('whatsapp-numbers-section', settings.notifications?.whatsapp);

    if (settings.notifications?.whatsappNumbers) {
      document.getElementById('whatsapp-numbers-list').innerHTML = '';
      settings.notifications.whatsappNumbers.forEach(num => {
        addWhatsAppNumber();
        const input = document.querySelector('.whatsapp-number-item:last-child input');
        if (input) input.value = num;
      });
    }
    
    // Payments
    document.getElementById('payment-cash').checked = settings.payments?.cash !== false;
    document.getElementById('payment-card').checked = settings.payments?.card || false;
    document.getElementById('payment-stripe').checked = settings.payments?.stripe || false;
    
    console.log('✅ Impostazioni caricate dal file');
    
  } catch (err) {
    console.error('❌ Errore caricamento impostazioni:', err);
  }
}

// ===== SAVE SETTINGS (Unica fonte di verità) =====
async function saveSettings() {
  try {
    document.querySelectorAll('.error-field').forEach(el => 
      el.classList.remove('error-field'));
    
    const data = {
      restaurant: {
        name: getValue('#restaurant-name'),
        owner: getValue('#owner-name'),
        street: getValue('#restaurant-street'),
        number: getValue('#restaurant-number'),
        cap: getValue('#restaurant-cap'),
        phone: getValue('#phone'),
        email: getValue('#email'),
        logo: document.querySelector('#logo-preview img')?.src || null
      },
      schedule: {
        openingHours: collectHours('opening-hours'),
        exceptionalClosures: collectClosures()
      },
      reservations: {
        enabled: document.getElementById('reservations-enabled').checked,
        maxPeoplePerSlot: parseInt(getValue('#max-people-per-slot')) || 40,
        slotDuration: parseInt(getValue('#slot-duration')) || 120,
        tablesEnabled: document.getElementById('tables-enabled').checked,
        tables: collectTables(),
        advanceBookingDays: parseInt(getValue('#advance-booking-days')) || 30,
        minAdvanceMinutes: parseInt(getValue('#min-advance-minutes')) || 2
      },
      delivery: {
        radius: parseFloat(getValue('#delivery-radius')) || 0,
        costType: getValue('#delivery-cost-type'),
        costFixed: parseFloat(getValue('#delivery-cost-fixed')) || 0,
        costPerKm: parseFloat(getValue('#delivery-cost-per-km')) || 0,
        minOrder: parseFloat(getValue('#min-order')) || 0,
        freeDeliveryThreshold: parseFloat(getValue('#free-delivery-threshold')) || null,
        prepTime: parseInt(getValue('#prep-time')) || 30,
        sameAsOpeningHours: document.getElementById('same-hours-delivery').checked,
        deliveryHours: document.getElementById('same-hours-delivery').checked 
          ? {} : collectHours('delivery-hours')
      },
      notifications: {
        app: document.getElementById('notify-app').checked,
        printer: document.getElementById('notify-printer').checked,
        whatsapp: document.getElementById('notify-whatsapp').checked,
        whatsappNumbers: collectWhatsAppNumbers()
      },
      payments: {
        cash: document.getElementById('payment-cash').checked,
        card: document.getElementById('payment-card').checked,
        stripe: document.getElementById('payment-stripe').checked
      }
    };
    
    const required = [
      ['#restaurant-name', 'Nome ristorante'],
      ['#owner-name', 'Nome titolare'],
      ['#restaurant-street', 'Via'],
      ['#restaurant-number', 'Numero civico'],
      ['#restaurant-cap', 'CAP']
    ];
    
    if (data.delivery.costType === 'fixed' && !getValue('#delivery-cost-fixed')) {
      required.push(['#delivery-cost-fixed', 'Costo fisso']);
    } else if (data.delivery.costType === 'distance' && !getValue('#delivery-cost-per-km')) {
      required.push(['#delivery-cost-per-km', 'Costo per km']);
    }
    
    const missing = required.filter(([sel]) => !getValue(sel));
    
    if (missing.length > 0) {
      missing.forEach(([sel]) => document.querySelector(sel)?.classList.add('error-field'));
      notify(`Compila tutti i campi obbligatori (${missing.length})`, 'error');
      document.querySelector('.error-field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    
    const res = await fetch(`/save-settings/${restaurantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: data })
    });
    
    const result = await res.json();
    if (!result.success) throw new Error(result.message);
    
    // ✅ NUOVO: Mostra messaggio se bookings.json è stato creato
    if (result.bookingsFileCreated && data.reservations.enabled) {
      notify('Impostazioni salvate! Sistema prenotazioni attivato ✓', 'success');
    } else {
      notify('Impostazioni salvate!', 'success');
    }
    
  } catch (err) {
    notify(err.message || 'Errore salvataggio', 'error');
  }
}

// ===== STRIPE =====
async function connectStripe() {
  try {
    notify('Reindirizzamento a Stripe...', 'success');

    const res = await fetch('/api/stripe/connect-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();

    if (!res.ok || !data.success || !data.url) {
      throw new Error(data.message || 'Errore Stripe');
    }

    const popup = window.open(data.url, 'stripe-connect', 'width=800,height=800');
    
    const checkPopup = setInterval(async () => {
      if (popup.closed) {
        clearInterval(checkPopup);
        notify('Verifica connessione...', 'success');
        await verifyStripeConnection();
      }
    }, 1000);

  } catch (err) {
    notify(err.message || 'Errore Stripe', 'error');
  }
}

async function verifyStripeConnection() {
  try {
    const res = await fetch(`/api/stripe/verify-connection/${restaurantId}`);
    const data = await res.json();
    
    const checkbox = document.getElementById('payment-stripe');
    const section = document.getElementById('stripe-connect-section');
    
    if (data.success && data.connected) {
      checkbox.checked = true;
      checkbox.disabled = false;
      if (section) section.style.display = 'none';
      notify('Stripe connesso!', 'success');
    } else {
      checkbox.checked = false;
      checkbox.disabled = true;
      if (section) section.style.display = 'block';
    }
  } catch (err) {
    console.error('❌ Errore verifica Stripe:', err);
    document.getElementById('payment-stripe').checked = false;
    document.getElementById('payment-stripe').disabled = true;
  }
}

// ===== HELPERS =====
function getValue(selector) {
  return document.querySelector(selector)?.value.trim() || '';
}

function setValue(selector, value) {
  const el = document.querySelector(selector);
  if (el && value !== undefined && value !== null) {
    el.value = value;
  }
}

function toggle(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'block' : 'none';
}

let notifyTimeout;
function notify(msg, type = 'success') {
  const el = document.getElementById('notification');
  clearTimeout(notifyTimeout);
  el.className = `notification ${type}`;
  el.textContent = msg;
  void el.offsetWidth;
  el.classList.add('show');
  
  notifyTimeout = setTimeout(() => el.classList.remove('show'), 3000);
}