// ===== STATE =====
let customData = {};
let editingGroupId = null;
let favorites = []; // id dei gruppi preferiti (stringhe)

const isFav = id => favorites.includes(String(id));

// Stato del bottone "Preferito" nell'editor gruppo (applicato solo al salvataggio)
let groupFavDraft = false;
function setGroupFavDraft(on) {
  groupFavDraft = !!on;
  const b = document.getElementById('group-favorite-btn');
  if (!b) return;
  b.textContent = (groupFavDraft ? '★' : '☆') + ' Preferito';
  b.classList.toggle('on', groupFavDraft);
  b.setAttribute('aria-pressed', groupFavDraft);
}
function toggleGroupFavoriteDraft() { setGroupFavDraft(!groupFavDraft); }

async function loadFavorites() {
  try {
    const res = await fetch(`/IDs/${restaurantId}/custom-favorites.json`);
    const data = res.ok ? await res.json() : [];
    favorites = Array.isArray(data) ? data.map(String) : [];
  } catch { favorites = []; }
}

async function saveFavorites() {
  try {
    const res = await fetch(`/save-custom-favorites/${restaurantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.message);
    return true;
  } catch (err) {
    console.error(err);
    notify('Errore salvataggio preferiti', 'error');
    return false;
  }
}

async function setFavorite(id, on) {
  id = String(id);
  favorites = on ? [...new Set([...favorites, id])] : favorites.filter(f => f !== id);
  await saveFavorites();
  updateGroupIdButton();
  if (!document.getElementById('group-selection-popup').classList.contains('hidden')) renderGroupsList();
}

function toggleCurrentGroupFavorite() {
  const id = document.getElementById('customization-group-id').value;
  if (!id || !customData[id]) return notify('Scegli o crea prima un gruppo', 'error');
  setFavorite(id, !isFav(id));
  notify(isFav(id) ? `Gruppo ${id} salvato nei preferiti` : `Gruppo ${id} rimosso dai preferiti`);
}

// Elimina i gruppi non usati da nessun elemento e non preferiti.
// Si esegue dopo il salvataggio del menu (le modifiche non salvate non contano).
async function pruneCustomizations() {
  const used = new Set(Object.values(menuData).flat().map(i => i.customizationGroup).filter(Boolean).map(String));
  // gruppo scelto nel popup elemento ancora aperto e non ancora salvato
  if (!document.getElementById('edit-popup').classList.contains('hidden')) {
    const cur = document.getElementById('customization-group-id').value;
    if (cur) used.add(String(cur));
  }
  const unused = Object.keys(customData).filter(id => !used.has(id) && !isFav(id));
  if (!unused.length) return;
  unused.forEach(id => delete customData[id]);
  await saveCustomizations(true);
}

// ===== INIT =====
async function loadCustomizations() {
  await loadFavorites();
  try {
    const res = await fetch(`/IDs/${restaurantId}/customizations.json`);
    customData = res.ok ? await res.json() : createDefaults();
    if (!res.ok) await saveCustomizations();
  } catch (err) {
    customData = createDefaults();
    await saveCustomizations();
  }
}

function createDefaults() {
  return {
    "1": [
      {
        id: "carne",
        name: "Scegli la carne",
        required: true,
        maxSelections: 1,
        options: [
          { id: "manzo", name: "Manzo", priceModifier: 0 },
          { id: "pollo", name: "Pollo", priceModifier: -1 },
          { id: "vegetariano", name: "Burger Vegetariano", priceModifier: 0.5 }
        ]
      },
      {
        id: "contorno",
        name: "Scegli il contorno",
        required: false,
        maxSelections: 2,
        options: [
          { id: "patatine", name: "Patatine Fritte", priceModifier: 0 },
          { id: "insalata", name: "Insalata", priceModifier: 0 },
          { id: "onion-rings", name: "Onion Rings", priceModifier: 1.5 }
        ]
      }
    ],
    "2": [
      {
        id: "salsa",
        name: "Scegli la salsa",
        required: false,
        maxSelections: 3,
        options: [
          { id: "ketchup", name: "Ketchup", priceModifier: 0 },
          { id: "mayo", name: "Maionese", priceModifier: 0 },
          { id: "bbq", name: "BBQ", priceModifier: 0.5 },
          { id: "piccante", name: "Salsa Piccante", priceModifier: 0.5 }
        ]
      }
    ]
  };
}

async function saveCustomizations(silent = false) {
  try {
    const res = await fetch(`/save-customizations/${restaurantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customizations: customData })
    });
    
    const result = await res.json();
    if (!result.success) throw new Error(result.message);
    
    if (!silent) notify('Customizzazioni salvate!', 'success');
    return true;
  } catch (err) {
    console.error(err);
    notify('Errore salvataggio customizzazioni', 'error');
    return false;
  }
}

function getNextGroupId() {
  const ids = Object.keys(customData).map(id => parseInt(id)).filter(n => !isNaN(n));
  let newId = 1;
  while (ids.includes(newId)) newId++;
  return newId;
}

// ===== GROUPS LIST =====
function openGroupSelectionPopup() {
  renderGroupsList();
  document.getElementById('group-selection-popup').classList.remove('hidden');
  lockScroll();
}

function closeGroupSelectionPopup() {
  document.getElementById('group-selection-popup').classList.add('hidden');
  unlockIfIdle();
}

function renderGroupsList() {
  const container = document.getElementById('groups-list');
  // solo i preferiti (che esistono ancora)
  const groups = favorites.filter(id => customData[id]).sort((a, b) => parseInt(a) - parseInt(b));

  if (!groups.length) {
    container.innerHTML = '<p class="no-groups-message">Nessun gruppo preferito.<br>Crea un gruppo e salvalo con la ★ per riutilizzarlo qui.</p>';
    return;
  }

  container.innerHTML = groups.map(id => {
    const sections = customData[id];
    const opts = sections.flatMap(s => s.options || []);
    const first = opts.slice(0, 2).map(o => `<span class="group-opt">${esc(o.name)}</span>`).join('');
    const more = opts.length > 2 ? `<span class="group-opt more">+${opts.length - 2}</span>` : '';
    const extraSections = sections.length > 1 ? ` <span class="group-more-sec">+${sections.length - 1} sez.</span>` : '';
    return `
      <div class="group-card" onclick="selectGroup('${id}')">
        <div class="group-card-header">
          <h3>Gruppo ${id}</h3>
          <div class="group-card-actions">
            <button class="group-fav-btn on" title="Rimuovi dai preferiti" onclick="event.stopPropagation(); setFavorite('${id}', false)">★</button>
            <button class="group-edit-btn" title="Modifica" onclick="event.stopPropagation(); editGroup('${id}')"><img src="img/edit.png" alt="Modifica"></button>
            <button class="group-delete-btn" title="Elimina" onclick="event.stopPropagation(); deleteGroup('${id}')"><img src="img/delete.png" alt="Elimina"></button>
          </div>
        </div>
        <p class="group-sections">${esc(sections[0]?.name || '')}${extraSections}</p>
        <div class="group-opts">${first}${more}</div>
      </div>`;
  }).join('');
}

function selectGroup(groupId) {
  const checkbox = document.getElementById('item-customizable');
  const input = document.getElementById('customization-group-id');
  
  checkbox.checked = true;
  input.value = groupId;
  
  updateGroupIdButton();
  updateCustomizationVisibility();
  closeGroupSelectionPopup();
  notify(`Gruppo ${groupId} selezionato`, 'success');
}

// ===== GROUP EDITOR =====
function openCustomizationGroupPopup(groupId = null) {
  editingGroupId = groupId;
  
  document.getElementById('customization-popup-title').textContent = 
    groupId ? `Modifica Gruppo ${groupId}` : 'Crea Nuovo Gruppo Customizzazione';
  
  groupId ? loadCustomizationGroup(groupId) : resetCustomizationForm();
  setGroupFavDraft(groupId ? isFav(groupId) : false);
  
  document.getElementById('customization-popup').classList.remove('hidden');
  lockScroll();
}

function closeCustomizationGroupPopup() {
  document.getElementById('customization-popup').classList.add('hidden');
  unlockIfIdle();
  editingGroupId = null;
}

function resetCustomizationForm() {
  document.getElementById('customization-sections-container').innerHTML = '';
  addCustomizationSection();
}

function loadCustomizationGroup(groupId) {
  const container = document.getElementById('customization-sections-container');
  container.innerHTML = '';
  
  const sections = customData[groupId] || [];
  sections.length ? sections.forEach(s => addCustomizationSection(s)) : addCustomizationSection();
}

// ===== SECTIONS =====
function addCustomizationSection(data = null) {
  const container = document.getElementById('customization-sections-container');
  const sectionId = `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const section = document.createElement('div');
  section.className = 'customization-section';
  section.dataset.sectionId = sectionId;
  
  section.innerHTML = `
    <div class="customization-section-header">
      <input type="text" class="section-name-input" placeholder="Es. Scegli la carne" value="${data?.name || ''}" />
      <button class="remove-section-btn" onclick="removeCustomizationSection('${sectionId}')">
        <img src="img/delete.png" alt="Rimuovi">
      </button>
    </div>
    
    <div class="section-settings">
      <label class="checkbox-label">
        <input type="checkbox" class="section-required" ${data?.required ? 'checked' : ''}>
        <span class="checkmark"></span>
        <span class="checkbox-text">Obbligatorio</span>
      </label>
      
      <div class="max-selections-field">
        <label>Selezioni massime:</label>
        <input type="number" class="section-max-selections" min="1" value="${data?.maxSelections || 1}" />
      </div>
    </div>
    
    <div class="options-container">
      <h4>Opzioni:</h4>
      <div class="options-list" data-section-id="${sectionId}"></div>
      <button class="btn-secondary add-option-btn" onclick="addCustomizationOption('${sectionId}')">
        + Aggiungi Opzione
      </button>
    </div>
  `;
  
  container.appendChild(section);
  
  if (data?.options?.length) {
    data.options.forEach(opt => addCustomizationOption(sectionId, opt));
  } else {
    addCustomizationOption(sectionId);
  }
}

function removeCustomizationSection(sectionId) {
  document.querySelector(`[data-section-id="${sectionId}"]`)?.remove();
}

// ===== OPTIONS =====
function addCustomizationOption(sectionId, data = null) {
  const list = document.querySelector(`.options-list[data-section-id="${sectionId}"]`);
  const optionId = `option-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const option = document.createElement('div');
  option.className = 'customization-option';
  option.dataset.optionId = optionId;
  
  option.innerHTML = `
    <input type="text" class="option-name-input" placeholder="Nome opzione" value="${data?.name || ''}" />
    <div class="option-price-group">
      <label>Modifica prezzo (€):</label>
      <input type="number" class="option-price-modifier" step="0.1" value="${data?.priceModifier || 0}" />
    </div>
    <button class="remove-option-btn" onclick="removeCustomizationOption('${optionId}')">
      <img src="img/delete.png" alt="Rimuovi">
    </button>
  `;
  
  list.appendChild(option);
}

function removeCustomizationOption(optionId) {
  document.querySelector(`[data-option-id="${optionId}"]`)?.remove();
}

// ===== SAVE GROUP =====
async function saveCustomizationGroup() {
  const sections = document.querySelectorAll('.customization-section');
  
  if (!sections.length) {
    notify('Aggiungi almeno una sezione', 'error');
    return;
  }
  
  const groupData = [];
  
  for (const section of sections) {
    const name = section.querySelector('.section-name-input').value.trim();
    if (!name) {
      notify('Ogni sezione deve avere un nome', 'error');
      section.querySelector('.section-name-input').focus();
      return;
    }
    
    const sectionId = name.toLowerCase().replace(/\s+/g, '-');
    const optionElements = section.querySelectorAll('.customization-option');
    
    if (!optionElements.length) {
      notify(`"${name}" deve avere almeno un'opzione`, 'error');
      return;
    }
    
    const options = [];
    for (const optEl of optionElements) {
      const optName = optEl.querySelector('.option-name-input').value.trim();
      if (!optName) {
        notify('Ogni opzione deve avere un nome', 'error');
        optEl.querySelector('.option-name-input').focus();
        return;
      }
      
      options.push({
        id: `${sectionId}.${optName.toLowerCase().replace(/\s+/g, '-')}`,
        name: optName,
        priceModifier: parseFloat(optEl.querySelector('.option-price-modifier').value) || 0
      });
    }
    
    groupData.push({
      id: sectionId,
      name: name,
      required: section.querySelector('.section-required').checked,
      maxSelections: parseInt(section.querySelector('.section-max-selections').value) || 1,
      options: options
    });
  }
  
  const wantFav = groupFavDraft;
  const isNew = editingGroupId === null;
  const gid = String(isNew ? getNextGroupId() : editingGroupId);
  customData[gid] = groupData;

  if (await saveCustomizations(true)) {
    if (wantFav !== isFav(gid)) {
      favorites = wantFav ? [...new Set([...favorites, gid])] : favorites.filter(f => f !== gid);
      await saveFavorites();
    }
    if (isNew) {
      // selezione automatica nell'elemento che si sta modificando
      document.getElementById('item-customizable').checked = true;
      document.getElementById('customization-group-id').value = gid;
      updateCustomizationVisibility();
    }
    updateGroupIdButton();
    closeCustomizationGroupPopup();
    renderGroupsList();
    notify(isNew ? `Gruppo ${gid} creato e selezionato` : `Gruppo ${gid} aggiornato`, 'success');
  }
}

function editGroup(groupId) {
  closeGroupSelectionPopup();
  openCustomizationGroupPopup(groupId);
}

async function deleteGroup(groupId) {
  if (!confirm(`Sei sicuro di voler eliminare il Gruppo ${groupId}?\n\nGli elementi che lo usano non saranno più customizzabili.`)) return;
  
  delete customData[groupId];
  if (isFav(groupId)) { favorites = favorites.filter(f => f !== String(groupId)); await saveFavorites(); }
  if (await saveCustomizations()) {
    notify(`Gruppo ${groupId} eliminato`, 'success');
    renderGroupsList();
  }
}

function createNewGroup() {
  closeGroupSelectionPopup();
  openCustomizationGroupPopup(null);
}

// ===== UTILS (chiamate da gestione-menu-script.js) =====
function updateCustomizationVisibility() {
  const checkbox = document.getElementById('item-customizable');
  const controls = document.getElementById('customization-controls');
  
  if (checkbox?.checked) {
    controls.style.display = 'flex';
    updateGroupIdButton();
  } else if (controls) {
    controls.style.display = 'none';
  }
}

function updateGroupIdButton() {
  const groupInput = document.getElementById('customization-group-id');
  const btnDisplay = document.getElementById('btn-group-id-display');
  
  if (groupInput && btnDisplay) {
    btnDisplay.textContent = groupInput.value || '-';
  }
  const star = document.getElementById('btn-fav-group');
  if (star) {
    const on = !!groupInput?.value && isFav(groupInput.value);
    star.textContent = on ? '★' : '☆';
    star.classList.toggle('on', on);
    star.title = on ? 'Rimuovi dai preferiti' : 'Salva nei preferiti';
  }
}

function openCurrentGroupOrSelection() {
  const groupInput = document.getElementById('customization-group-id');
  const groupId = groupInput?.value;
  
  groupId ? editGroup(groupId) : openGroupSelectionPopup();
}

// ===== EXPORTS =====
window.loadCustomizations = loadCustomizations;
window.pruneCustomizations = pruneCustomizations;
window.setFavorite = setFavorite;
window.toggleGroupFavoriteDraft = toggleGroupFavoriteDraft;
window.toggleCurrentGroupFavorite = toggleCurrentGroupFavorite;
window.openGroupSelectionPopup = openGroupSelectionPopup;
window.closeGroupSelectionPopup = closeGroupSelectionPopup;
window.openCustomizationGroupPopup = openCustomizationGroupPopup;
window.closeCustomizationGroupPopup = closeCustomizationGroupPopup;
window.saveCustomizationGroup = saveCustomizationGroup;
window.createNewGroup = createNewGroup;
window.addCustomizationSection = addCustomizationSection;
window.removeCustomizationSection = removeCustomizationSection;
window.addCustomizationOption = addCustomizationOption;
window.removeCustomizationOption = removeCustomizationOption;
window.selectGroup = selectGroup;
window.editGroup = editGroup;
window.deleteGroup = deleteGroup;
window.updateCustomizationVisibility = updateCustomizationVisibility;
window.updateGroupIdButton = updateGroupIdButton;
window.openCurrentGroupOrSelection = openCurrentGroupOrSelection;