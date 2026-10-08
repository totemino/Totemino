// ===== STATE =====
let customData = {};
let editingGroupId = null;

// ===== INIT =====
async function loadCustomizations() {
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

async function saveCustomizations() {
  try {
    const res = await fetch(`/save-customizations/${restaurantId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customizations: customData })
    });
    
    const result = await res.json();
    if (!result.success) throw new Error(result.message);
    
    notify('Customizzazioni salvate!', 'success');
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
  document.body.classList.add('noscroll');
}

function closeGroupSelectionPopup() {
  document.getElementById('group-selection-popup').classList.add('hidden');
  document.body.classList.remove('noscroll');
}

function renderGroupsList() {
  const container = document.getElementById('groups-list');
  const groups = Object.keys(customData).sort((a, b) => parseInt(a) - parseInt(b));
  
  container.innerHTML = !groups.length 
    ? '<p class="no-groups-message">Nessun gruppo disponibile. Creane uno nuovo!</p>'
    : groups.map(id => {
        const sections = customData[id].map(s => s.name).join(', ');
        return `
          <div class="group-card">
            <div class="group-card-header">
              <h3>Gruppo ${id}</h3>
              <div class="group-card-actions">
                <button class="group-edit-btn" onclick="editGroup('${id}')">
                  <img src="img/edit.png" alt="Modifica">
                </button>
                <button class="group-delete-btn" onclick="deleteGroup('${id}')">
                  <img src="img/delete.png" alt="Elimina">
                </button>
              </div>
            </div>
            <p class="group-sections">${sections}</p>
            <button class="btn-primary select-group-btn" onclick="selectGroup('${id}')">
              Seleziona Gruppo
            </button>
          </div>
        `;
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
  
  document.getElementById('customization-popup').classList.remove('hidden');
  document.body.classList.add('noscroll');
}

function closeCustomizationGroupPopup() {
  document.getElementById('customization-popup').classList.add('hidden');
  document.body.classList.remove('noscroll');
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
  
  if (editingGroupId === null) {
    const newId = getNextGroupId();
    customData[newId] = groupData;
    notify(`Gruppo ${newId} creato!`, 'success');
  } else {
    customData[editingGroupId] = groupData;
    notify(`Gruppo ${editingGroupId} aggiornato!`, 'success');
  }
  
  if (await saveCustomizations()) {
    closeCustomizationGroupPopup();
    renderGroupsList();
  }
}

function editGroup(groupId) {
  closeGroupSelectionPopup();
  openCustomizationGroupPopup(groupId);
}

async function deleteGroup(groupId) {
  if (!confirm(`Sei sicuro di voler eliminare il Gruppo ${groupId}?\n\nGli elementi che lo usano non saranno più customizzabili.`)) return;
  
  delete customData[groupId];
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
}

function openCurrentGroupOrSelection() {
  const groupInput = document.getElementById('customization-group-id');
  const groupId = groupInput?.value;
  
  groupId ? editGroup(groupId) : openGroupSelectionPopup();
}

// ===== EXPORTS =====
window.loadCustomizations = loadCustomizations;
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