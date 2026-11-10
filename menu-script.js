document.addEventListener('contextmenu', event => event.preventDefault());

const nav = document.querySelector(".categories");
const itemsContainer = document.querySelector(".items");
const priceDisplay = document.querySelector(".price");
const counterDisplay = document.querySelector(".cart h3");
const nextBtn = document.querySelector(".next");
const cartIcon = document.querySelector(".cart");
const cartPopup = document.querySelector(".cart-popup");
const allergenNames = {
  "1": "Senza Glutine", "2": "Senza Lattosio", "3": "Soia", "4": "Latte", "5": "Uova",
  "6": "Pesce", "7": "Glutine", "8": "Arachidi", "9": "Frutta a guscio",
  "10": "Semi di sesamo", "11": "Sedano", "12": "Senape",
  "13": "Anidride solforosa", "14": "Crostacei", "15": "Lupino", "16": "Molluschi"
};

let total = 0;
let count = 0;
let categories = [];
let currentCategoryIndex = 0;
let restaurantId = null;
let lastSwipeDirection = "right";
let allergenPopupTimeout = null;
let selectedItems = new Map();
let quantityPopup = null;
let quantityPopupTimeout = null;
let currentPopupItem = null;
let customizationData = {};
let isViewOnlyMode = false;
let isAnimating = false;

// Menu SEMPRE in sola visualizzazione: niente carrello, niente selezione, niente ordine.
isViewOnlyMode = true;
document.documentElement.classList.add('view-only');

// ===== VISUALIZZAZIONE (griglia / dettagliata) =====
// La modalità iniziale è sempre quella scelta dal ristorante (settings.menu.defaultView),
// letta ad ogni caricamento/refresh. La scelta del cliente vale solo finché la pagina resta aperta.
let viewMode = 'grid';
try { localStorage.removeItem('totemino_view_mode'); } catch (e) {} // vecchia chiave: non serve più

// ===== CATEGORIA CORRENTE (ripristinata dopo il ricaricamento) =====
let categoryStorageKey = null;
let searchActive = false;

function getInitialCategoryIndex() {
  try {
    const entry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    let type = entry ? entry.type : null;
    if (!type && performance.navigation) {
      type = performance.navigation.type === 1 ? 'reload' : performance.navigation.type === 2 ? 'back_forward' : 'navigate';
    }
    if (type !== 'reload' && type !== 'back_forward') return 0;
    const idx = categories.indexOf(sessionStorage.getItem(categoryStorageKey));
    return idx >= 0 ? idx : 0;
  } catch (e) {
    return 0;
  }
}

function saveCurrentCategory(index) {
  try {
    if (categoryStorageKey && categories[index]) sessionStorage.setItem(categoryStorageKey, categories[index]);
  } catch (e) {}
}

// ===== BLOCCO SCROLL (contatore: più livelli aperti non si pestano i piedi) =====
let scrollLockCount = 0;
let lockedScrollY = 0;

function lockScroll() {
  if (scrollLockCount++ > 0) return;
  lockedScrollY = window.scrollY;
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.classList.add("noscroll");
}

function unlockScroll() {
  if (scrollLockCount === 0) return;
  if (--scrollLockCount > 0) return;
  document.body.classList.remove("noscroll");
  document.body.style.top = '';
  window.scrollTo(0, lockedScrollY);
}

// ===== LIVELLI SOVRAPPOSTI (scheda prodotto, menu laterale) =====
// Ogni livello aperto aggiunge una voce alla history, così il tasto indietro
// del telefono (o lo swipe indietro di iOS) chiude il livello invece di uscire dalla pagina.
const layerStack = [];
let pendingBack = false;
let pendingBackTimer = null;

function pushLayer(closeFn) {
  layerStack.push(closeFn);
  history.pushState({ toteminoLayer: layerStack.length }, '');
}

// Chiusura richiesta dall'utente (X, overlay, swipe): passa da history.back()
function dismissTopLayer() {
  if (!layerStack.length || pendingBack) return;
  pendingBack = true;
  history.back();
  pendingBackTimer = setTimeout(() => {
    if (!pendingBack) return;      // popstate non arrivato: chiudo comunque
    pendingBack = false;
    const fn = layerStack.pop();
    if (fn) fn();
  }, 400);
}

window.addEventListener('popstate', () => {
  clearTimeout(pendingBackTimer);
  pendingBack = false;
  const depth = (history.state && history.state.toteminoLayer) || 0;
  while (layerStack.length > depth) {
    const fn = layerStack.pop();
    try { fn(); } catch (e) { console.error(e); }
  }
});

// Dopo un ricaricamento lo stato "livello aperto" non ha più senso
if (history.state && history.state.toteminoLayer) history.replaceState(null, '');

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissTopLayer();
});

// Descrizione in testo semplice (per la vista dettagliata)
function plainDescription(text) {
  if (!text) return "";
  let raw = String(text).trim();
  if (raw.includes(";")) {
    raw = raw
      .replace(/^\s*ingredienti\s*:\s*/i, "")
      .split(";")
      .map(t => t.trim())
      .filter(Boolean)
      .join(", ");
  }
  return raw.replace(/\\n/g, " ").replace(/\s+/g, " ");
}

//helper
function prependToMap(map, key, value) {
  const newMap = new Map();
  newMap.set(key, value);
  for (const [k, v] of map) {
    newMap.set(k, v);
  }
  return newMap;
}

// ===== DESCRIZIONE → TAG (non interagibili) =====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Se la descrizione contiene almeno un ";" ogni ingrediente diventa un tag,
// altrimenti resta testo normale. Restituisce HTML già "escapato".
function renderDescription(text) {
  if (!text) return "";

  const raw = String(text).trim();

  if (!raw.includes(";")) {
    return escapeHtml(raw.replace(/\\n/g, "\n"));
  }

  const tags = raw
    .replace(/^\s*ingredienti\s*:\s*/i, "")   // toglie l'etichetta iniziale "ingredienti:"
    .replace(/\\n/g, " ")
    .split(";")
    .map(t => t.trim())
    .filter(Boolean);

  return `<span class="desc-tags">${
    tags.map(t => `<span class="desc-tag">${escapeHtml(t)}</span>`).join("")
  }</span>`;
}

// Carica customizations.json
async function loadCustomizations() {
  try {
    const res = await fetch(`IDs/${restaurantId}/customizations.json`);
    customizationData = await res.json();
  } catch (e) {
    console.warn("customizations.json non trovato o errore:", e);
  }
}

// Genera chiave univoca per item con customizzazioni
function generateItemKey(itemName, customizations = {}) {
  const sortedKeys = Object.keys(customizations).sort();
  const customStr = sortedKeys.map(k => `${k}:${customizations[k]}`).join(',');
  return customStr ? `${itemName}|{${customStr}}` : itemName;
}

// Estrae nome base e customizzazioni da una chiave
function parseItemKey(key) {
  const match = key.match(/^(.+?)\|\{(.+)\}$/);
  if (!match) return { name: key, customizations: {} };
  
  const name = match[1];
  const customStr = match[2];
  const customizations = {};
  
  if (customStr) {
    customStr.split(',').forEach(pair => {
      const [k, v] = pair.split(':');
      customizations[k] = parseInt(v) || 0;
    });
  }
  
  return { name, customizations };
}

// Calcola prezzo totale con modificatori
function calculateItemPrice(itemName, customizations = {}) {
  const item = findItemByName(itemName);
  if (!item) return 0;
  
  let price = item.price;
  
  if (item.customizable && item.customizationGroup) {
    const group = customizationData[item.customizationGroup];
    if (group) {
      group.forEach(section => {
        section.options.forEach(opt => {
          const qty = customizations[opt.id] || 0;
          if (qty > 0) {
            price += opt.priceModifier * qty;
          }
        });
      });
    }
  }
  
  return price;
}

// Ottieni label per customizzazioni
function getCustomizationLabel(customizations) {
  const labels = [];
  for (const [key, qty] of Object.entries(customizations)) {
    if (qty > 0) {
      // Trova il nome dell'opzione
      for (const groupId in customizationData) {
        const group = customizationData[groupId];
        for (const section of group) {
          const opt = section.options.find(o => o.id === key);
          if (opt) {
            labels.push(qty > 1 ? `${opt.name} x${qty}` : opt.name);
          }
        }
      }
    }
  }
  return labels.length > 0 ? ` (${labels.join(', ')})` : '';
}

// Etichetta prezzo di un item, in base a prezzo e presenza di customizzazioni
function getPriceLabel(item) {
  const hasCustomizations = !!item.customizable;

  if (item.price <= 0) {
    return hasCustomizations ? "Seleziona" : "Gratuito";
  }

  const price = `€${item.price.toFixed(2)}`;
  return hasCustomizations ? `${price} + Modifica` : price;
}

function updateItemButtonUI(itemName) {
  const buttons = itemsContainer.querySelectorAll("button");
  
  buttons.forEach(btn => {
    const titleEl = btn.querySelector("h3");
    const titleTextEl = titleEl && (titleEl.querySelector(".title-text") || titleEl);
    if (!titleEl) return;
    
    const baseName = titleEl.getAttribute('data-item-name');
    if (baseName !== itemName) return;
    
    const item = findItemByName(itemName);
    if (!item) return;
    
    const priceEl = btn.querySelector("p");
    if (!priceEl) return;
    
    // Calcola quantità totale di tutte le varianti
    const totalQty = calculateTotalQuantityForItem(itemName);
    
    // Aggiorna titolo
    titleTextEl.textContent = totalQty > 1 ? `${itemName} (x${totalQty})` : itemName;
    
    // Aggiorna classe selected
    btn.classList.toggle("selected", totalQty > 0);
    
    // Aggiorna prezzo
    updatePriceElement(priceEl, item, itemName, totalQty);
  });
}

function calculateTotalQuantityForItem(itemName) {
  let total = 0;
  for (const [key, data] of selectedItems) {
    const parsed = parseItemKey(key);
    if (parsed.name === itemName) {
      total += data.qty;
    }
  }
  return total;
}

function updatePriceElement(priceEl, item, itemName, totalQty) {
  if (item.customizable) {
    updateCustomizableItemPrice(priceEl, item, itemName, totalQty);
  } else {
    updateStandardItemPrice(priceEl, item);
  }
}

function updateCustomizableItemPrice(priceEl, item, itemName, totalQty) {
  if (totalQty > 0) {
    // Item selezionato: mostra prezzo totale di tutte le varianti
    const totalPrice = calculateTotalPriceForAllVariants(itemName);
    priceEl.textContent = `€${totalPrice.toFixed(2)}`;
    priceEl.classList.remove("customizable-price");
  } else {
    // Item non selezionato: mostra prezzo base + indicazione
    if (item.price < 0.01) {
      priceEl.textContent = "Seleziona";
    } else {
      priceEl.textContent = `€${item.price.toFixed(2)} + Modifica`;
    }
    priceEl.classList.add("customizable-price");
  }
}

function calculateTotalPriceForAllVariants(itemName) {
  let total = 0;
  for (const [key, data] of selectedItems) {
    const parsed = parseItemKey(key);
    if (parsed.name === itemName) {
      total += calculateItemPrice(parsed.name, parsed.customizations) * data.qty;
    }
  }
  return total;
}

function updateStandardItemPrice(priceEl, item) {
  if (item.price < 0.01) {
    priceEl.textContent = "Gratis";
  } else {
    priceEl.textContent = `€${item.price.toFixed(2)}`;
  }
}

// Carica immagini allergeni
for (let i = 1; i <= 16; i++) {
  const img = new Image();
  img.src = `img/allergeni/${i}.png`;
}

function sortItemsByCategory(selectedItems) {
  const sortedArray = [];
  
  // Itera le categorie nell'ordine del menu
  categories.forEach(categoryName => {
    const categoryItems = window.menuData[categoryName] || [];
    
    // Per ogni item della categoria nel menu
    categoryItems.forEach(menuItem => {
      // Trova tutte le varianti di questo item in selectedItems
      for (const [key, data] of selectedItems) {
        const parsed = parseItemKey(key);
        if (parsed.name === menuItem.name) {
          sortedArray.push([key, data]);
        }
      }
    });
  });
  
  return sortedArray;
}

// === PERSISTENZA ===
function saveSelectionToStorage() {
  return; // sola visualizzazione
  const sortedItems = sortItemsByCategory(selectedItems);
  const arr = [];
  const notesArr = [];
  
  for (const [key, data] of sortedItems) {
    const parsed = parseItemKey(key);
    
    const filteredCustomizations = {};
    for (const [optKey, optValue] of Object.entries(data.customizations || {})) {
      if (optValue > 0) {
        filteredCustomizations[optKey] = optValue;
      }
    }
    
    arr.push(
      parsed.name,
      JSON.stringify(filteredCustomizations),
      data.qty.toString()
    );
    
    notesArr.push(data.note || "");
  }
  
  localStorage.setItem("totemino_selected", JSON.stringify(arr));
  localStorage.setItem("totemino_notes", JSON.stringify(notesArr));
  localStorage.setItem("totemino_total", total.toFixed(2));
  localStorage.setItem("totemino_count", count.toString());
}

function loadSelectionFromStorage() {
  return; // sola visualizzazione: nessuna selezione salvata
  const saved = localStorage.getItem("totemino_selected");
  const savedNotes = JSON.parse(localStorage.getItem("totemino_notes") || "[]");
  
  selectedItems = new Map();
  if (saved) {
    const arr = JSON.parse(saved);
    let noteIndex = 0;
    
    for (let i = 0; i < arr.length; i += 3) {
      const name = arr[i];
      const customizations = JSON.parse(arr[i + 1] || '{}');
      const qty = parseInt(arr[i + 2]);
      
      if (name && qty && qty > 0) {
        const key = generateItemKey(name, customizations);
        selectedItems.set(key, { 
          qty, 
          customizations,
          note: savedNotes[noteIndex] || "" // ✅ CARICA LA NOTA
        });
        noteIndex++;
      }
    }
  }
  total = parseFloat(localStorage.getItem("totemino_total")) || 0;
  count = parseInt(localStorage.getItem("totemino_count")) || 0;
}

let isCartPopupAnimating = false;

function toggleCartPopup() {
  if (isCartPopupAnimating) return;
  
  const cartImg = cartIcon.querySelector("img");
  const cartCounter = cartIcon.querySelector("h3");
  
  if (cartPopup.classList.contains("hidden")) {
    isCartPopupAnimating = true;
    renderCartPopup();
    cartPopup.classList.remove("hidden", "slide-up");
    cartPopup.classList.add("slide-down");
    cartImg.src = "img/cart_open.png";
    cartCounter.style.opacity = "0";
    setTimeout(() => {
      isCartPopupAnimating = false;
    }, 250);
  } else {
    isCartPopupAnimating = true;
    cartPopup.classList.remove("slide-down");
    cartPopup.classList.add("slide-up");
    cartImg.src = "img/cart_closed.png";
    cartCounter.style.opacity = "1";
    setTimeout(() => {
      cartPopup.classList.add("hidden");
      isCartPopupAnimating = false;
    }, 250);
  }
}

function renderCartPopup() {
  cartPopup.innerHTML = "";
  
  for (const [key, data] of selectedItems) {
    const parsed = parseItemKey(key);
    const item = findItemByName(parsed.name);
    if (!item) continue;
    
    const itemDiv = document.createElement("div");
    itemDiv.className = "cart-popup-item";
    
    const img = document.createElement("img");
    img.src = item.img;
    img.onerror = () => { img.src = 'img/placeholder.png'; };
    
    itemDiv.appendChild(img);
    
    if (data.qty > 1) {
      const badge = document.createElement("span");
      badge.className = "cart-popup-badge";
      badge.textContent = data.qty;
      itemDiv.appendChild(badge);
    }
    
    cartPopup.appendChild(itemDiv);
  }
}

cartIcon.addEventListener("click", (e) => {
  e.stopPropagation();
  if (count>0)
  toggleCartPopup();
});

document.addEventListener("click", (e) => {
  if (!cartPopup.contains(e.target) && !cartIcon.contains(e.target)) {
    if (!cartPopup.classList.contains("hidden")) {
      const cartImg = cartIcon.querySelector("img");
      const cartCounter = cartIcon.querySelector("h3");
      cartPopup.classList.add("hidden");
      cartImg.src = "img/cart_closed.png";
      cartCounter.style.opacity = "1";
    }
  }
});

// === SCHERMATA CUSTOMIZZAZIONE ===
function mountScreen(screen) {
  document.body.appendChild(screen);
  lockScroll();

  const backBtn = screen.querySelector(".back-btn");
  if (backBtn) backBtn.addEventListener("click", dismissTopLayer);

  attachSwipeToClose(screen);
  pushLayer(() => unmountScreen(screen));
}

function unmountScreen(screen) {
  if (!screen.parentNode || screen.classList.contains("closing")) return;
  screen.classList.add("closing");

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (screen.parentNode) screen.parentNode.removeChild(screen);
    unlockScroll();
  };
  screen.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, 320); // rete di sicurezza se animationend non scatta
}

// Trascina da sinistra verso destra per chiudere
function attachSwipeToClose(screen) {
  let sx = 0, sy = 0, st = 0, dx = 0, mode = null; // mode: null | 'h' | 'v' | 'ignore'

  screen.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { mode = "ignore"; return; }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    st = Date.now();
    dx = 0;
    mode = null;
    screen.style.transition = "none";
  }, { passive: true });

  screen.addEventListener("touchmove", (e) => {
    if (mode === "ignore" || mode === "v") return;
    const t = e.touches[0];
    dx = t.clientX - sx;
    const dy = t.clientY - sy;

    if (mode === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      mode = (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5) ? "h" : "v";
      if (mode === "v") return;
    }
    screen.style.transform = `translate3d(${Math.max(0, dx)}px, 0, 0)`;
  }, { passive: true });

  const end = () => {
    const wasHorizontal = mode === "h";
    mode = null;
    if (!wasHorizontal) return;

    const fast = dx / Math.max(1, Date.now() - st) > 0.5;
    if (dx > 80 || (dx > 40 && fast)) {
      dismissTopLayer(); // l'animazione di uscita parte dalla posizione attuale
    } else {
      screen.style.transition = "transform 0.2s ease-out";
      screen.style.transform = "";
      setTimeout(() => { screen.style.transition = ""; }, 220);
    }
  };
  screen.addEventListener("touchend", end, { passive: true });
  screen.addEventListener("touchcancel", end, { passive: true });
}

function openCustomizationScreen(item) {
  // Evita schermate sovrapposte (doppio tap): era la causa del "non si chiude"
  if (document.querySelector(".customization-screen")) return;

  const screen = document.createElement("div");
  screen.className = "customization-screen";
  
  // ✅ NUOVO: Per item non customizzabili in view-only mode, crea vista semplificata
  if (isViewOnlyMode && !item.customizable) {
    screen.innerHTML = `
      <div class="customization-header">
        <h2>${item.displayName}</h2>
        <button class="back-btn">
          <img src="img/x.png" alt="Chiudi">
        </button>
      </div>
      <div class="customization-content">
        ${item.img ? `<img src="${item.img}" alt="${item.displayName}" onerror="this.src='img/placeholder.png'">` : ""}
        ${item.description && item.description.trim() ?
          `<div style="background: var(--btn-secondary); color: var(--text-primary); padding: 1rem; border-radius: 1rem; margin-bottom: 1rem;">
            <div style="font-size: 0.9rem; line-height: 1.5; white-space: pre-line; opacity: 0.9;">${renderDescription(item.description)}</div>
          </div>`
        : ""}
        <div class="customization-sections"></div>
      </div>
    `;

    mountScreen(screen);
    
    const backBtn = screen.querySelector(".back-btn");
        
    return;
  }
  
  // Vista normale/customizzabile
  screen.innerHTML = `
    <div class="customization-header">
      <h2>${item.displayName}</h2>
      <button class="back-btn">
        <img src="img/x.png" alt="Chiudi">
      </button>
    </div>
    <div class="customization-content">
      ${item.img ? `<img src="${item.img}" alt="${item.displayName}" onerror="this.src='img/placeholder.png'">` : ""}
      ${item.description && item.description.trim() ?
        `<div style="background: var(--btn-secondary); color: var(--text-primary); padding: 1rem; border-radius: 1rem; margin-bottom: 1rem;">
          <div style="font-size: 0.9rem; line-height: 1.5; white-space: pre-line; opacity: 0.9;">${renderDescription(item.description)}</div>
        </div>`
      : ""}
      <div class="customization-sections"></div>
    </div>
    <div class="customization-footer" ${isViewOnlyMode ? 'style="display: none;"' : ''}>
      <div class="price-display">
        <span class="base-price">Prezzo base: €${item.price.toFixed(2)}</span>
        <span class="total-price">Totale: €${item.price.toFixed(2)}</span>
      </div>
      <button class="add-to-cart-btn">Conferma</button>
    </div>
  `;
  
  mountScreen(screen);
  
  const sectionsContainer = screen.querySelector(".customization-sections");
  const totalPriceEl = screen.querySelector(".total-price");
  const addBtn = screen.querySelector(".add-to-cart-btn");
  const backBtn = screen.querySelector(".back-btn");
  
  const customizationState = {};
  
  const group = customizationData[item.customizationGroup];
  if (group) {
    group.forEach(section => {
      const sectionDiv = document.createElement("div");
      sectionDiv.className = "customization-section";
      
      const title = document.createElement("h3");
      title.textContent = section.name + (section.required ? " *" : "");
      sectionDiv.appendChild(title);
      
      section.options.forEach(opt => {
        customizationState[opt.id] = 0;
      });
      
      section.options.forEach(opt => {
        const optDiv = document.createElement("div");
        optDiv.className = "customization-option";
        
        const optLabel = document.createElement("label");
        optLabel.style.display = 'flex';
        optLabel.style.justifyContent = 'space-between';
        optLabel.style.alignItems = 'center';
        optLabel.style.flex = '1';
        optLabel.style.gap = '1rem';
        
        const optName = document.createElement("span");
        optName.textContent = opt.name;
        optName.style.flex = '1';
        
        const optPrice = document.createElement("span");
        if (opt.priceModifier !== 0) {
          const priceText = item.price < 0.01 ? `€${opt.priceModifier.toFixed(2)}` : `+ €${opt.priceModifier.toFixed(2)}`;
          optPrice.textContent = priceText;
          optPrice.style.fontWeight = '500';
          optPrice.style.whiteSpace = 'nowrap';
          optPrice.style.marginRight = '0.5rem';
        }
        
        optLabel.appendChild(optName);
        if (opt.priceModifier !== 0) {
          optLabel.appendChild(optPrice);
        }
        
        const controls = document.createElement("div");
        controls.className = "option-controls";
        
        // ✅ NUOVO: Nascondi controlli in view-only mode
        if (isViewOnlyMode) {
          controls.style.display = 'none';
        }
        
        if (section.maxSelections === 1) {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = `opt-${opt.id}`;
          checkbox.className = "radio-checkbox";
          
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              section.options.forEach(o => {
                if (o.id !== opt.id) {
                  customizationState[o.id] = 0;
                  const otherCheckbox = document.getElementById(`opt-${o.id}`);
                  if (otherCheckbox) {
                    otherCheckbox.checked = false;
                  }
                }
              });
              customizationState[opt.id] = 1;
            } else {
              customizationState[opt.id] = 0;
            }
            updateTotalPrice();
          });
          
          controls.appendChild(checkbox);
        } else {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = `opt-${opt.id}`;
          checkbox.className = "square-checkbox";
          
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              const currentSelections = section.options
                .filter(o => o.id !== opt.id)
                .reduce((sum, o) => sum + (customizationState[o.id] || 0), 0);
              
              if (!section.maxSelections || (currentSelections < section.maxSelections)) {
                customizationState[opt.id] = 1;
              } else {
                checkbox.checked = false;
                customizationState[opt.id] = 0;
                alert(`Massimo ${section.maxSelections} selezioni per questa sezione`);
              }
            } else {
              customizationState[opt.id] = 0;
            }
            updateTotalPrice();
          });
          
          controls.appendChild(checkbox);
        }
        
        optDiv.appendChild(optLabel);
        optDiv.appendChild(controls);
        sectionDiv.appendChild(optDiv);
      });
      
      sectionsContainer.appendChild(sectionDiv);
    });
  }
  
  function updateTotalPrice() {
    // ✅ NUOVO: Salta aggiornamento prezzi in view-only mode
    if (isViewOnlyMode) return;
    
    const totalPrice = calculateItemPrice(item.name, customizationState);
    totalPriceEl.textContent = `Totale: €${totalPrice.toFixed(2)}`;
    
    let allRequiredFilled = true;
    if (group) {
      for (const section of group) {
        if (section.required) {
          const hasSelection = section.options.some(opt => 
            customizationState[opt.id] > 0
          );
          if (!hasSelection) {
            allRequiredFilled = false;
            break;
          }
        }
      }
    }
    
    addBtn.disabled = !allRequiredFilled;
    if (!allRequiredFilled) {
      addBtn.classList.add("disabled");
    } else {
      addBtn.classList.remove("disabled");
    }
  }
  
  // ✅ NUOVO: Disabilita addBtn in view-only mode
  if (!isViewOnlyMode && addBtn) {
    addBtn.addEventListener("click", () => {
      const cleanCustomizations = {};
      for (const [key, value] of Object.entries(customizationState)) {
        if (value > 0) {
          cleanCustomizations[key] = value;
        }
      }
      
      const itemKey = generateItemKey(item.name, cleanCustomizations);
      const itemPrice = calculateItemPrice(item.name, cleanCustomizations);
      
      if (selectedItems.has(itemKey)) {
        const data = selectedItems.get(itemKey);
        data.qty++;
      } else {
        selectedItems = prependToMap(selectedItems, itemKey, {
          qty: 1,
          customizations: { ...cleanCustomizations }
        });
      }
      
      total += itemPrice;
      count += 1;
      
      updateCart();
      saveSelectionToStorage();
      updateItemButtonUI(item.name);
      
      dismissTopLayer();
    });
  }
  
    
  if (!isViewOnlyMode) {
    updateTotalPrice();
  }
}

// === MENU ===
async function loadMenu() {
  const params = new URLSearchParams(window.location.search);
  restaurantId = params.get("id") || (location.pathname.match(/^\/(\d+)\/?$/) || [])[1] || null;
  if (!restaurantId) {
    console.error("ID del menu non specificato nell'URL.");
    return;
  }

  // Visualizzazione predefinita scelta dal ristorante (griglia / dettagliata)
  try {
    const sRes = await fetch(`IDs/${restaurantId}/settings.json`, { cache: "no-store" });
    if (sRes.ok) {
      const s = await sRes.json();
      setViewMode(s.menu?.defaultView === "detailed" ? "list" : "grid", false);
    }
  } catch (e) {
    console.warn("Impossibile leggere la visualizzazione predefinita:", e);
  }

  const res = await fetch(`IDs/${restaurantId}/menu.json`);
  const menuJson = await res.json();
  
  // ✅ Carica settings per verificare menu types disponibili
  let availableMenuTypes = [];
  try {
    const settingsRes = await fetch(`IDs/${restaurantId}/menuTypes.json`);
    if (settingsRes.ok) {
      const settings = await settingsRes.json();
      availableMenuTypes = settings.menuTypes || [];
    }
  } catch (e) {
    console.warn("Settings non trovati, nessun filtro disponibile");
  }
  
  // ✅ FILTRO MENU TYPE con validazione
  const requestedType = params.get("type");
  let menuTypeFilter = null;

  // Se manca il type, usa 'default' ma NON reindirizzare
  if (!requestedType || requestedType === 'default' || requestedType === 'view' || requestedType === 'readonly') {
    menuTypeFilter = 'default';
  } else {
    const typeConfig = availableMenuTypes.find(t => t.id === requestedType);
    if (typeConfig) {
      menuTypeFilter = requestedType;
    } else {
      menuTypeFilter = 'default';
    }
  }

  menuJson.categories = menuJson.categories
  .map(cat => ({
    ...cat,
    items: cat.items.filter(item => item.visible)
  }))
  .filter(cat => cat.items.length > 0);

  if (menuTypeFilter) {
    menuJson.categories = menuJson.categories
      .map(cat => ({
        ...cat,
        items: cat.items.filter(item => 
          item.menuType && item.menuType.includes(menuTypeFilter)
        )
      }))
      .filter(cat => cat.items.length > 0);
  }

  if (menuJson.categories.length === 0) {
    console.error("Nessuna categoria disponibile dopo i filtri");
    itemsContainer.innerHTML = "<p style='text-align:center;padding:2rem;'>Nessun prodotto disponibile</p>";
    return;
  }
  
  await loadCustomizations();

  categories = menuJson.categories.map(cat => cat.name);

  categoryStorageKey = `totemino_cat_${restaurantId}_${menuTypeFilter}`;
  const startIndex = getInitialCategoryIndex();
  currentCategoryIndex = startIndex; // niente animazione di slide al ripristino

  nav.innerHTML = "";
  const pill = document.createElement("div");
  pill.style.transform = "translateX(0.7rem)";
  pill.className = "pill";
  nav.appendChild(pill);

  categories.forEach((cat, index) => {
    const btn = document.createElement("button");
    btn.textContent = cat;
    if (index === startIndex) btn.classList.add("active");
    btn.addEventListener("click", () => setActiveCategory(index));
    nav.appendChild(btn);
  });

  // (listener 'scroll' sulla nav rimosso: la pill e' dentro la nav e scorre con lei)
  window.addEventListener("resize", () => {
    const active = document.querySelector(".categories button.active");
    if (active) movePillTo(active);
  });

  window.menuData = {};

  menuJson.categories.forEach(category => {
    const categoryName = category.name;
    window.menuData[categoryName] = [];

    category.items.forEach(item => {
      if (!item.visible) return;

      window.menuData[categoryName].push({
        name: item.name,
        displayName: item.name,
        price: item.price,
        img: item.imagePath,
        description: item.description || "",
        ingredients: (item.description || "").split(",").map(i => i.trim()).filter(Boolean),
        allergens: item.allergens.map(a => a.toString()),
        isNew: item.featured,
        customizable: item.customizable || false,
        customizationGroup: item.customizationGroup || null
      });
    });
    
    // ✅ Ordina gli items: prima quelli featured, poi gli altri
    window.menuData[categoryName].sort((a, b) => {
      if (a.isNew && !b.isNew) return -1;
      if (!a.isNew && b.isNew) return 1;
      return 0;
    });
  });

  loadSelectionFromStorage();
  const checkAndActivate = () => {
    const firstButton = nav.querySelector("button");
    if (firstButton && firstButton.offsetWidth > 0) {
      setActiveCategory(startIndex, true);
    } else {
      setTimeout(checkAndActivate, 1000);
    }
  };

  
  setTimeout(checkAndActivate, 0);
}

function movePillTo(button) {
  const pill = document.querySelector(".pill");
  if (!pill) return;
  pill.style.width = `${button.offsetWidth}px`;
  pill.style.transform = `translateX(${button.offsetLeft}px)`;
}

function setActiveCategory(index, skipAnimationBlock = false) {
  if (index < 0 || index >= categories.length) return;
  
  // ✅ Blocca SEMPRE se è in animazione
  if (isAnimating && !skipAnimationBlock) return;

  if (index !== currentCategoryIndex) {
    lastSwipeDirection = index > currentCategoryIndex ? "left" : "right";
  } else {
    lastSwipeDirection = null;
  }

  currentCategoryIndex = index;
  saveCurrentCategory(index);
  
  // ✅ Imposta animazione in corso
  if (!skipAnimationBlock) {
    isAnimating = true;
  }

  document.querySelectorAll(".categories button").forEach((b, i) => {
    b.classList.toggle("active", i === index);
  });

  const activeBtn = document.querySelector(".categories button.active");
  if (activeBtn) movePillTo(activeBtn);
  renderItems(categories[index]);

  updateCart();

  activeBtn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (!skipAnimationBlock) {
    setTimeout(() => {
      isAnimating = false;
    }, 201);
  }

  if (!nextBtn) return;

  if (currentCategoryIndex === categories.length - 1) {
    nextBtn.innerText = "Completa";

    if (count === 0) {
      nextBtn.classList.remove("paga", "animate-glow");
      nextBtn.classList.add("locked");
      nextBtn.disabled = true;
    } else {
      nextBtn.classList.remove("locked");
      nextBtn.classList.add("paga", "animate-glow");
      nextBtn.disabled = false;
    }
  } else {
    nextBtn.innerText = "Avanti";
    nextBtn.classList.remove("paga", "animate-glow", "locked");
    nextBtn.disabled = false;
  }
}

function renderItems(category) {
  if (!itemsContainer) return;

  itemsContainer.classList.remove("fade-in-left", "fade-in-right", "fade-out-left", "fade-out-right", "fade-in-simple", "fade-out-simple");
  void itemsContainer.offsetWidth;
  
  if (lastSwipeDirection === null) {
    itemsContainer.classList.add("fade-out-simple");
  } else {
    itemsContainer.classList.add(lastSwipeDirection === "left" ? "fade-out-left" : "fade-out-right");
  }

  setTimeout(() => {
    itemsContainer.innerHTML = "";
    const items = Array.isArray(category) ? category : (window.menuData[category] || []);
    const frag = document.createDocumentFragment();

    items.forEach(item => {
      const btn = document.createElement("button");

      if (item.isNew) {
        const badge = document.createElement("div");
        badge.className = "novita";
        badge.textContent = "Novità";
        btn.appendChild(badge);
      }

      const infoBtn = document.createElement("div");
      infoBtn.className = "info-btn";
      const infoImg = document.createElement("img");
      infoImg.src = "img/info.png";
      infoImg.alt = "Info";
      infoBtn.appendChild(infoImg);
      btn.appendChild(infoBtn);

      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = item.displayName;
      img.src = item.img;
      img.onerror = () => { img.src = 'img/placeholder.png'; };
      
      const title = document.createElement("h3");
      title.setAttribute('data-item-name', item.name);
      const titleText = document.createElement("span");
      titleText.className = "title-text";
      titleText.textContent = item.displayName;
      titleText.dataset.full = item.displayName;
      title.appendChild(titleText);

      const price = document.createElement("p");
      price.textContent = getPriceLabel(item);
      if (item.customizable) price.classList.add("customizable-price");

      btn.appendChild(img);
      btn.appendChild(title);

      if (viewMode === "list") {
        const descText = plainDescription(item.description);
        if (descText) {
          const desc = document.createElement("div");
          desc.className = "item-desc";
          desc.textContent = descText;
          btn.appendChild(desc);
        }
      }

      btn.appendChild(price);

      btn.addEventListener("click", (event) => {
        if (event.target.closest(".info-btn")) return;
      
        // ✅ NUOVO: In view-only mode apri sempre customization screen
        if (isViewOnlyMode) {
          openCustomizationScreen(item);
          return;
        }
      
        // Comportamento normale (resto invariato)
        if (item.customizable) {
          let isItemSelected = false;
          for (const [key] of selectedItems) {
            if (parseItemKey(key).name === item.name) {
              isItemSelected = true;
              break;
            }
          }
      
          if (isItemSelected) {
            const keysToRemove = [];
            for (const [key, data] of selectedItems) {
              const parsed = parseItemKey(key);
              if (parsed.name === item.name) {
                keysToRemove.push(key);
                const itemPrice = calculateItemPrice(parsed.name, parsed.customizations);
                total -= itemPrice * data.qty;
                count -= data.qty;
              }
            }
            keysToRemove.forEach(key => selectedItems.delete(key));
            updateCart();
            saveSelectionToStorage();
            updateItemButtonUI(item.name);
          } else {
            openCustomizationScreen(item);
          }
        } else {
          const itemKey = item.name;
          if (selectedItems.has(itemKey)) {
            let data = selectedItems.get(itemKey);
            if (data.qty <= 1) {
              selectedItems.delete(itemKey);
              total -= item.price;
              count -= 1;
            } else {
              data.qty--;
              total -= item.price;
              count -= 1;
            }
          } else {
            selectedItems = prependToMap(selectedItems, itemKey, {
              qty: 1,
              customizations: {}
            });
            total += item.price;
            count += 1;
          }
          updateCart();
          saveSelectionToStorage();
          updateItemButtonUI(item.name);
        }
      });
      
      // ✅ NUOVO: Modifica anche il click su info-btn
      infoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isViewOnlyMode) {
          openCustomizationScreen(item);
        } else {
          openPopup(item);
        }
      });

      frag.appendChild(btn);
    });

    if (items.length === 0 && searchActive) {
      const empty = document.createElement("div");
      empty.className = "no-results";
      empty.textContent = "Nessun risultato";
      frag.appendChild(empty);
    }
    itemsContainer.appendChild(frag);
    fitGridTitles();
    if (!isViewOnlyMode) items.forEach(i => updateItemButtonUI(i.name));

    itemsContainer.classList.remove("fade-out-left", "fade-out-right", "fade-out-simple");
    if (lastSwipeDirection === null) {
      itemsContainer.classList.add("fade-in-simple");
    } else {
      itemsContainer.classList.add(lastSwipeDirection === "left" ? "fade-in-right" : "fade-in-left");
    }
    
  }, 200);
}

function updateCart() {
  if (Math.abs(total) < 0.01) total = 0;

  total = 0;
  count = 0;
  for (const [key, data] of selectedItems) {
    const parsed = parseItemKey(key);
    const itemPrice = calculateItemPrice(parsed.name, parsed.customizations);
    total += itemPrice * data.qty;
    count += data.qty;
  }

  priceDisplay.textContent = `€${total.toFixed(2)}`;
  counterDisplay.textContent = count;

  if (currentCategoryIndex === categories.length - 1) {
    if (count === 0) {
      nextBtn.classList.remove("paga", "animate-glow");
      nextBtn.classList.add("locked");
      nextBtn.disabled = true;
    } else {
      nextBtn.classList.remove("locked");
      nextBtn.classList.add("paga", "animate-glow");
      nextBtn.disabled = false;
    }
  }
}

function findItemByName(name) {
  for (const cat of categories) {
    const arr = window.menuData[cat];
    if (!arr) continue;
    for (const item of arr) {
      if (item.name === name) return item;
    }
  }
  return null;
}

function openPopup(item) {
  const popup = document.querySelector(".popup");
  const popupImg = popup.querySelector(".popup-img");
  const popupTitle = popup.querySelector(".popup-title");
  const popupIngredients = popup.querySelector(".popup-ingredients");
  const popupAllergens = popup.querySelector(".popup-allergens");
  const popupControls = popup.querySelector(".popup-controls");
  const allergenTitle = document.getElementById("titolo-allergeni");

  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  
  allergenTitle.style.display = item.allergens.length === 0 ? "none" : "block";
  
  popupImg.src = item.img;
  popupImg.onerror = () => { popupImg.src = 'img/placeholder.png'; };
  popupTitle.textContent = item.displayName;
  popupIngredients.innerHTML = renderDescription(item.description);
  popupAllergens.innerHTML = "";
  popupControls.innerHTML = "";
  
  // Calcola quantità totale dell'item
  let totalQty = 0;
  for (const [key, data] of selectedItems) {
    const parsed = parseItemKey(key);
    if (parsed.name === item.name) totalQty += data.qty;
  }
  
  if (item.customizable && totalQty === 0) {
    // Item customizzabile NON selezionato: solo "Personalizza"
    const customizeBtn = document.createElement("button");
    customizeBtn.textContent = "Personalizza";
    customizeBtn.className = "popup-customize-btn";
    customizeBtn.addEventListener("click", () => {
      closePopup();
      openCustomizationScreen(item);
    });
    popupControls.appendChild(customizeBtn);
  } else {
    // Item customizzabile SELEZIONATO o NON customizzabile: mostra + e -
    const minusBtn = document.createElement("button");
    minusBtn.textContent = "−";
    minusBtn.className = "popup-minus";

    const qtyDisplay = document.createElement("span");
    qtyDisplay.className = "popup-qty";

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.className = "popup-plus";

    const itemKey = item.name;
    let qty = item.customizable ? totalQty : (selectedItems.has(itemKey) ? selectedItems.get(itemKey).qty : 0);
    qtyDisplay.textContent = qty;

    minusBtn.addEventListener("click", () => {
      if (qty > 0) {
        if (item.customizable) {
          // Rimuovi una unità dalla prima variante
          for (const [key, data] of selectedItems) {
            const parsed = parseItemKey(key);
            if (parsed.name === item.name) {
              const itemPrice = calculateItemPrice(parsed.name, parsed.customizations);
              if (data.qty > 1) {
                data.qty--;
              } else {
                selectedItems.delete(key);
              }
              total -= itemPrice;
              count -= 1;
              qty--;
              break;
            }
          }
          if (qty === 0) closePopup();
        } else {
          qty--;
          if (qty === 0) {
            selectedItems.delete(itemKey);
          } else {
            selectedItems.set(itemKey, { qty, customizations: {} });
          }
          total -= item.price;
          count -= 1;
        }
        qtyDisplay.textContent = qty;
        updateCart();
        saveSelectionToStorage();
        updateItemButtonUI(item.name);
      }
    });
    
    plusBtn.addEventListener("click", () => {
      if (item.customizable) {
        closePopup();
        openCustomizationScreen(item);
      } else {
        qty++;
        // ✅ MODIFICATO: Se è un nuovo item, inserisci in cima
        if (selectedItems.has(itemKey)) {
          selectedItems.set(itemKey, { qty, customizations: {} });
        } else {
          selectedItems = prependToMap(selectedItems, itemKey, {
            qty,
            customizations: {}
          });
        }
        total += item.price;
        count += 1;
        qtyDisplay.textContent = qty;
        updateCart();
        saveSelectionToStorage();
        updateItemButtonUI(item.name);
      }
    });

    popupControls.appendChild(minusBtn);
    popupControls.appendChild(qtyDisplay);
    popupControls.appendChild(plusBtn);
  }

  // Allergeni
  item.allergens.forEach(id => {
    const img = document.createElement("img");
    img.src = `img/allergeni/${id}.png`;
    img.alt = `Allergene ${id}`;
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      const popupMsg = document.getElementById("allergen-popup");
      popupMsg.textContent = allergenNames[id] || "Allergene sconosciuto";
      
      // Calcola posizione al centro dell'icona
      const rect = img.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // Mostra temporaneamente per calcolare dimensioni
      popupMsg.style.visibility = 'hidden';
      popupMsg.style.opacity = '1';
      popupMsg.classList.remove("hidden");
      
      // Posiziona al centro dell'icona (il transform già fa -50%)
      popupMsg.style.left = `${centerX}px`;
      popupMsg.style.top = `${centerY - 40}px`; // 40px sopra il centro
      
      // Ripristina visibilità e mostra
      popupMsg.style.visibility = '';
      clearTimeout(allergenPopupTimeout);
      popupMsg.classList.add("show");
      
      allergenPopupTimeout = setTimeout(() => {
        popupMsg.classList.remove("show");
      }, 1200);
    });
    popupAllergens.appendChild(img);
  });

  popup.classList.remove("hidden");
  document.body.classList.add("noscroll");
}

function closePopup() {
  const popup = document.querySelector(".popup");
  if (!popup.classList.contains("hidden")) {
    popup.classList.add("hidden");
    
    const scrollY = document.body.style.top;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.classList.remove("noscroll");
    window.scrollTo(0, parseInt(scrollY || '0') * -1);
  }
  clearTimeout(allergenPopupTimeout);
  const popupMsg = document.getElementById("allergen-popup");
  popupMsg.classList.remove("show");
}

document.querySelector(".close-popup").addEventListener("click", closePopup);
document.querySelector(".popup").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closePopup();
});

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    if (currentCategoryIndex < categories.length - 1) {
      lastSwipeDirection = "left";
      setActiveCategory(currentCategoryIndex + 1);
    }
  });
}

let startX = 0, startY = 0, isSwipe = false;

if (itemsContainer) {
  // Listener passivi: il browser non deve aspettare il JS prima di scrollare (meno lag)
  itemsContainer.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwipe = true;
  }, { passive: true });

  itemsContainer.addEventListener("touchmove", (e) => {
    if (!isSwipe) return;
    const deltaX = Math.abs(e.touches[0].clientX - startX);
    const deltaY = Math.abs(e.touches[0].clientY - startY);
    if (deltaY > deltaX) isSwipe = false; // movimento verticale → non è uno swipe
  }, { passive: true });

  itemsContainer.addEventListener("touchend", (e) => {
    if (!isSwipe || searchActive) return;
    const endX = e.changedTouches[0].clientX;
    const threshold = 50;
    if (endX - startX > threshold) {
      lastSwipeDirection = "right";
      setActiveCategory(currentCategoryIndex - 1);
    } else if (startX - endX > threshold) {
      lastSwipeDirection = "left";
      setActiveCategory(currentCategoryIndex + 1);
    }
  }, { passive: true });
}

// ===== MENU LATERALE (hamburger) =====
function setViewMode(mode, rerender = true) {
  viewMode = mode;

  itemsContainer.classList.toggle("list-view", mode === "list");
  document.querySelectorAll(".side-segmented button").forEach(b => {
    const on = b.dataset.view === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });

  if (rerender && categories.length) {
    lastSwipeDirection = null;
    renderItems(categories[currentCategoryIndex]);
  }
}

// Nessuna API web permette di aprire la UI di traduzione del browser (Chrome/Safari):
// mostriamo un suggerimento breve su come aprirla.
function showToast(message, ms = 5000) {
  const old = document.querySelector(".totemino-toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "totemino-toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

function openLanguageSelector() {
  dismissTopLayer(); // chiude il menu laterale
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isChrome = /Chrome|CriOS/.test(ua) && !/Edg|OPR/.test(ua);

  let msg = "Apri il menu del browser e scegli “Traduci”.";
  if (isChrome) msg = "Tocca ⋮ del browser e scegli “Traduci…” per tradurre il menu.";
  else if (isIOS) msg = "Tocca “aA” nella barra degli indirizzi e scegli “Traduci in…”.";

  setTimeout(() => showToast(msg), 300);
}

// TODO: da implementare (aprire la fotocamera e leggere il QR di un altro ristorante)
function openRestaurantScanner() {
  console.log("Scanner ristorante: non ancora implementato");
}

function initSideMenu() {
  const toggle = document.getElementById("menu-toggle");
  const panel = document.getElementById("side-menu");
  const overlay = document.getElementById("side-menu-overlay");
  if (!toggle || !panel || !overlay) return;

  let isOpen = false;

  function show() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.add("open");
    overlay.classList.add("show");
    panel.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    lockScroll();
    pushLayer(hide);
  }

  function hide() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove("open");
    overlay.classList.remove("show");
    panel.style.transform = "";
    overlay.style.opacity = "";
    panel.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    unlockScroll();
  }

  toggle.addEventListener("click", show);
  overlay.addEventListener("click", dismissTopLayer);
  panel.querySelector(".side-menu-close").addEventListener("click", dismissTopLayer);

  // Trascina verso destra (sul pannello o sullo sfondo scuro) per chiuderlo: il pannello segue il dito
  let sx = 0, sy = 0, st = 0, dx = 0, mode = null; // mode: null | 'h' | 'v' | 'ignore'

  const onStart = (e) => {
    if (!isOpen || e.touches.length !== 1) { mode = "ignore"; return; }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    st = Date.now();
    dx = 0;
    mode = null;
    panel.style.transition = "none";
  };

  const onMove = (e) => {
    if (mode === "ignore" || mode === "v") return;
    const t = e.touches[0];
    dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (mode === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      mode = (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5) ? "h" : "v";
      if (mode === "v") return;
    }
    const x = Math.max(0, dx);
    panel.style.transform = `translate3d(${x}px, 0, 0)`;
    overlay.style.opacity = String(Math.max(0, 1 - x / panel.offsetWidth));
  };

  const onEnd = () => {
    const wasHorizontal = mode === "h";
    mode = null;
    panel.style.transition = "";
    if (!wasHorizontal) return;
    overlay.style.opacity = "";
    const fast = dx / Math.max(1, Date.now() - st) > 0.5;
    if (dx > 80 || (dx > 40 && fast)) {
      dismissTopLayer();            // hide() ripulisce lo stile inline e il pannello esce da dov'è
    } else {
      panel.style.transform = "";   // torna aperto con transizione
    }
  };

  [panel, overlay].forEach(el => {
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
  });

  panel.querySelectorAll(".side-segmented button").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.view !== viewMode) setViewMode(btn.dataset.view);
      setTimeout(dismissTopLayer, 180);
    });
  });

  document.getElementById("language-btn").addEventListener("click", openLanguageSelector);
  
  // Etichetta del tema (il toggle vero lo gestisce theme.js tramite #theme)
  const updateThemeLabel = () => {
    const el = document.getElementById("theme-value");
    if (el) el.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "Scuro" : "Chiaro";
  };
  updateThemeLabel();
  new MutationObserver(updateThemeLabel).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

initSideMenu();


// ===== TITOLI GRIGLIA: 2 righe, ultima parola tagliata a metà con "…" =====
// Il browser con line-clamp manda a capo l'ultima parola e la nasconde intera:
// qui calcoliamo noi il taglio (con canvas, senza forzare layout per ogni titolo).
const titleMeasureCtx = document.createElement("canvas").getContext("2d");

function fitTwoLines(text, maxW, measure) {
  const words = text.split(/\s+/).filter(Boolean);
  let line1 = "";
  let i = 0;
  while (i < words.length) {
    const cand = line1 ? line1 + " " + words[i] : words[i];
    if (measure(cand) <= maxW) { line1 = cand; i++; } else break;
  }
  if (i >= words.length) return text;       // sta in una riga
  if (!line1) return text;                  // prima parola enorme: ci pensa il CSS
  const rest = words.slice(i).join(" ");
  if (measure(rest) <= maxW) return text;   // sta in due righe

  let lo = 0, hi = rest.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(rest.slice(0, mid).trimEnd() + "…") <= maxW) lo = mid; else hi = mid - 1;
  }
  return line1 + " " + rest.slice(0, lo).trimEnd() + "…";
}

function fitGridTitles() {
  const spans = itemsContainer.querySelectorAll(".title-text");
  if (!spans.length) return;

  if (viewMode !== "grid") {                // vista dettagliata: ellipsis CSS su una riga
    spans.forEach(sp => { if (sp.dataset.full) sp.textContent = sp.dataset.full; });
    return;
  }

  const maxW = spans[0].parentElement.clientWidth;        // tutte le card della griglia hanno la stessa larghezza
  if (!maxW) return;
  const cs = getComputedStyle(spans[0]);
  titleMeasureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const measure = (t) => titleMeasureCtx.measureText(t).width;

  spans.forEach(sp => {
    const full = sp.dataset.full;
    if (full) sp.textContent = fitTwoLines(full, maxW - 1, measure);
  });
}

let fitTitlesTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(fitTitlesTimer);
  fitTitlesTimer = setTimeout(fitGridTitles, 150);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitGridTitles); // font QS caricato → rimisura

// ===== RICERCA =====
function initSearch() {
  const row = document.querySelector(".categories-row");
  const btn = document.getElementById("search-btn");
  const input = document.getElementById("search-input");
  if (!row || !btn || !input) return;

  // Misura la barra categorie e la usa come altezza della riga (bottone tondo, campo alto uguale)
  const measure = () => {
    const h = nav.offsetHeight;
    if (h > 0) row.style.setProperty("--cat-h", h + "px"); // 0 = nav nascosta durante la ricerca
  };
  measure();
  if (window.ResizeObserver) new ResizeObserver(measure).observe(nav);
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let timer = null;

  function runSearch() {
    const q = norm(input.value).trim();
    lastSwipeDirection = null;
    if (!q) {
      renderItems(categories[currentCategoryIndex]);
      return;
    }
    const results = [];
    categories.forEach(cat => {
      (window.menuData[cat] || []).forEach(item => {
        if (norm(item.displayName).includes(q) || norm(plainDescription(item.description)).includes(q)) {
          results.push(item);
        }
      });
    });
    renderItems(results);
  }

  function openSearch() {
    if (searchActive) return;
    searchActive = true;
    row.classList.add("searching");
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Chiudi la ricerca");
    btn.firstElementChild.className = "fa-solid fa-xmark";
    input.value = "";
    input.focus();
    pushLayer(closeSearch);
  }

  function closeSearch() {
    if (!searchActive) return;
    searchActive = false;
    clearTimeout(timer);
    row.classList.remove("searching");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Cerca");
    btn.firstElementChild.className = "fa-solid fa-magnifying-glass";
    input.blur();
    input.value = "";
    lastSwipeDirection = null;
    renderItems(categories[currentCategoryIndex]);
  }

  btn.addEventListener("click", () => {
    if (searchActive) dismissTopLayer(); else openSearch();
  });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 220);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur(); // chiude la tastiera, i risultati restano
  });
}

initSearch();
setViewMode(viewMode, false); // applica la modalità salvata prima del primo render

loadMenu();
