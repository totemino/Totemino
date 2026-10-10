// ===== STATE =====
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
};

let menuData = {}, categories = [], menuTypes = [], restaurantId = null;
let currentEdit = { category: null, index: null }, uploadedImage = null, hasChanges = false;
let filterType = '', query = '', view = 'grid', collapsed = new Set();
let editingCat = null, editingItems = [], editingTypeIdx = null, iconIdx = 1, dragFrom = null;

const METHODS = ['table', 'delivery', 'takeaway', 'show'];
const allergens = {
  "1": "No Glutine", "2": "No Lattosio", "3": "Soia", "4": "Latte", "5": "Uova", "6": "Pesce", "7": "Glutine", "8": "Arachidi",
  "9": "Frutta a guscio", "10": "Semi di sesamo", "11": "Sedano", "12": "Senape", "13": "Anidride solforosa", "14": "Crostacei", "15": "Lupino", "16": "Molluschi"
};

const svg = p => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  chev: svg('<path d="m6 9 6 6 6-6"/>'), plus: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1"/>'),
  edit: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  up: svg('<path d="m18 15-6-6-6 6"/>'), down: svg('<path d="m6 9 6 6 6-6"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  expand: svg('<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>'), collapse: svg('<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>')
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  restaurantId = new URLSearchParams(location.search).get('id') || 'default';
  collapsed = new Set(store.get(`gm_collapsed_${restaurantId}`, []));
  view = store.get('gm_view', 'grid');
  $('view-grid').innerHTML = I.grid; $('view-list').innerHTML = I.list;

  $('search').oninput = e => { query = e.target.value.trim().toLowerCase(); render(); };
  $('menu-type-filter').onchange = e => { filterType = e.target.value === 'default' ? '' : e.target.value; render(); };
  $('m-table').onchange = syncCoperto;
  $('category-menu-types').onchange = e => toggleCatType(e.target.value, e.target.checked);
  $('allergens-grid').onclick = e => e.target.closest('.allergen-item')?.classList.toggle('selected');

  const area = $('product-image-area');
  area.onclick = () => $('product-image').click();
  area.ondragover = e => { e.preventDefault(); area.classList.add('dragover'); };
  area.ondragleave = () => area.classList.remove('dragover');
  area.ondrop = e => { e.preventDefault(); area.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) processImage(f); };
  $('product-image').onchange = e => e.target.files[0] && processImage(e.target.files[0]);

  const list = $('draggable-items-list');
  list.ondragstart = e => { dragFrom = +e.target.closest('.row')?.dataset.i; };
  list.ondragover = e => e.preventDefault();
  list.ondrop = e => {
    const to = +e.target.closest('.row')?.dataset.i;
    if (isNaN(to) || dragFrom == null || isNaN(dragFrom)) return;
    editingItems.splice(to, 0, editingItems.splice(dragFrom, 1)[0]); dragFrom = null; renderRows();
  };

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (hasChanges) saveMenu(); }
    if (e.key === 'Escape') [...document.querySelectorAll('.popup:not(.hidden)')].pop()?.querySelector('.close-popup, .btn-secondary')?.click();
  });
  addEventListener('scroll', hideCtx, true); addEventListener('resize', hideCtx);
  addEventListener('error', e => { const i = e.target; if (i.tagName === 'IMG' && !i.src.endsWith('placeholder.png')) i.src = 'img/placeholder.png'; }, true);
  window.onbeforeunload = e => hasChanges ? (e.returnValue = 'Modifiche non salvate') : null;

  await loadMenu();
  await loadCustomizations();
});

// ===== EVENTI (delegati) =====
function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (t) { const a = t.dataset.act; if (a !== 'ctx' && a !== 'cat-menu') hideCtx(); return actions[a]?.(t, e); }
  hideCtx();

  const locked = e.target.closest('.checkbox-label.locked');
  if (locked) {
    e.preventDefault();
    return ask('Consegna non configurata', 'Le impostazioni di consegna non sono complete. Vuoi configurarle ora?', 'Configura').then(ok => {
      if (!ok) return;
      window.open(`info.html?id=${restaurantId}`, '_blank');
      addEventListener('focus', async () => lockDelivery(await checkDeliverySettings()), { once: true });
    });
  }
  const item = e.target.closest('.item');
  if (item) return openPopup(+item.dataset.i, item.closest('.cat').dataset.cat);
  const head = e.target.closest('.cat-head');
  if (head) return toggleCollapse(head.closest('.cat'));
  if (e.target.classList.contains('popup') && ['edit-popup', 'confirm-popup'].includes(e.target.id)) e.target.querySelector('.close-popup, .btn-secondary')?.click();
}

const catOf = el => el.closest('.cat').dataset.cat;
const idxOf = el => +el.closest('.item').dataset.i;
const actions = {
  back: () => location.href = `profile.html?id=${restaurantId}`,
  close: t => t.dataset.p === 'edit-popup' ? closeItemPopup() : hide(t.dataset.p),
  view: t => { view = t.dataset.v; store.set('gm_view', view); render(); },
  'toggle-all': () => {
    collapsed = categories.every(c => collapsed.has(c)) ? new Set() : new Set(categories);
    store.set(`gm_collapsed_${restaurantId}`, [...collapsed]); render();
  },
  'add-cat': () => openCatPopup(null),
  'clear-filter': () => { filterType = ''; query = ''; $('search').value = ''; render(); },
  'save-menu': saveMenu,
  discard: async () => { if (await ask('Scartare le modifiche?', 'Le modifiche non salvate andranno perse.', 'Scarta')) { hasChanges = false; setDirty(false); await loadMenu(); } },

  'cat-add': t => openPopup(null, catOf(t)),
  'cat-vis': t => toggleCategoryVisibility(catOf(t)),
  'cat-menu': t => {
    const c = catOf(t), i = categories.indexOf(c), hidden = allHidden(c);
    openCtx(t, [
      [I.edit + 'Modifica categoria', () => openCatPopup(c)],
      [(hidden ? I.eye + 'Mostra' : I.eyeOff + 'Nascondi') + ' tutti gli elementi', () => toggleCategoryVisibility(c)],
      i > 0 && [I.up + 'Sposta su', () => moveCat(c, -1)],
      i < categories.length - 1 && [I.down + 'Sposta giù', () => moveCat(c, 1)],
      [I.trash + 'Elimina categoria', () => deleteCategory(c), 'danger']
    ].filter(Boolean));
  },
  ctx: t => { const fn = $('ctx')._e[t.dataset.i][1]; hideCtx(); fn(); },

  'item-vis': t => { const it = menuData[catOf(t)][idxOf(t)]; it.visible = it.visible === false; setDirty(true); render(); },
  'item-dup': t => {
    const c = catOf(t), i = idxOf(t), src = menuData[c][i];
    let name = `${src.name} (copia)`, n = 2;
    while (nameExists(name)) name = `${src.name} (copia ${n++})`;
    menuData[c].splice(i + 1, 0, { ...src, name, allergens: [...src.allergens], menuType: [...(src.menuType || [])] });
    setDirty(true); render(); notify('Elemento duplicato');
  },
  'item-save': saveItem,
  'item-delete': deleteItem,
  'remove-image': () => { uploadedImage = null; setPreview(''); },

  'type-new': () => openTypePopup(null),
  'type-edit': t => openTypePopup(+t.dataset.i),
  'type-save': saveType,
  'type-delete': deleteType,
  'type-icon': t => { iconIdx = t.dataset.d === 'next' ? (iconIdx % 20) + 1 : (iconIdx === 1 ? 20 : iconIdx - 1); setIcon(iconIdx); },

  'cat-save': saveCategory,
  'row-up': t => moveRow(+t.closest('.row').dataset.i, -1),
  'row-down': t => moveRow(+t.closest('.row').dataset.i, 1)
};

// ===== UI HELPERS =====
const show = id => { $(id).classList.remove('hidden'); document.body.classList.add('popup-open'); };
const hide = id => { $(id).classList.add('hidden'); if (!document.querySelector('.popup:not(.hidden)')) document.body.classList.remove('popup-open'); };
const setDirty = v => { hasChanges = v; $('savebar').classList.toggle('show', v); };
const nameExists = n => Object.values(menuData).flat().some(i => i.name.toLowerCase() === n.toLowerCase());
const allHidden = c => (menuData[c] || []).length > 0 && menuData[c].every(i => i.visible === false);

let notifyTimeout;
function notify(msg, type = 'success') {
  const el = $('save-notification');
  clearTimeout(notifyTimeout);
  el.className = `notification ${type}`; el.textContent = msg;
  void el.offsetWidth; el.classList.add('show');
  notifyTimeout = setTimeout(() => el.classList.remove('show'), 3000);
}

function ask(title, text, ok = 'Elimina') {
  return new Promise(res => {
    $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-ok').textContent = ok;
    const done = v => { hide('confirm-popup'); res(v); };
    $('confirm-ok').onclick = () => done(true); $('confirm-cancel').onclick = () => done(false);
    show('confirm-popup');
  });
}

function openCtx(btn, entries) {
  const c = $('ctx');
  c._e = entries;
  c.innerHTML = entries.map(([label, , cls], i) => `<button class="${cls || ''}" data-act="ctx" data-i="${i}">${label}</button>`).join('');
  c.classList.remove('hidden');
  const r = btn.getBoundingClientRect();
  c.style.left = `${Math.max(8, Math.min(r.right - c.offsetWidth, innerWidth - c.offsetWidth - 8))}px`;
  c.style.top = `${r.bottom + c.offsetHeight + 8 > innerHeight ? r.top - c.offsetHeight - 4 : r.bottom + 4}px`;
}
const hideCtx = () => $('ctx')?.classList.add('hidden');

// ===== LOAD =====
async function loadMenu() {
  try {
    const [menuRes, typesRes] = await Promise.all([fetch(`IDs/${restaurantId}/menu.json`), fetch(`IDs/${restaurantId}/menuTypes.json`).catch(() => ({ ok: false }))]);
    const menu = menuRes.ok ? await menuRes.json() : { categories: [] };
    const settings = typesRes.ok ? await typesRes.json() : {};

    menuData = {}; categories = [];
    (menu.categories || []).forEach(cat => {
      categories.push(cat.name);
      menuData[cat.name] = (cat.items || []).map(i => ({
        name: i.name, price: i.price, image: i.imagePath, description: i.description || '', allergens: i.allergens || [],
        isNew: i.featured || false, visible: i.visible !== false, menuType: i.menuType || [],
        customizable: i.customizable || false, customizationGroup: i.customizationGroup || null
      }));
    });

    menuTypes = (settings.menuTypes || []).map(t => ({
      id: t.id, name: t.name, coperto: t.copertoPrice || 0, visible: t.visibility !== false, icon: t.icon || 1,
      methods: t.checkoutMethods || { table: true, delivery: true, takeaway: true, show: true }
    }));
    if (!menuTypes.some(t => t.id === 'default'))
      menuTypes.unshift({ id: 'default', name: 'Menu Intero', coperto: 0, visible: true, icon: 1, methods: { table: true, delivery: true, takeaway: true, show: true } });
  } catch (err) { console.error('Load error:', err); }
  render();
}

// ===== RENDER =====
function render() {
  renderTypes(); renderFilter(); renderCats();
  const items = Object.values(menuData).flat();
  $('stats').textContent = `${categories.length} categorie · ${items.length} elementi · ${items.filter(i => i.visible === false).length} nascosti`;
  $('view-grid').setAttribute('aria-pressed', view === 'grid'); $('view-list').setAttribute('aria-pressed', view === 'list');
  $('toggle-all').innerHTML = categories.length && categories.every(c => collapsed.has(c)) ? I.expand + '<span>Espandi</span>' : I.collapse + '<span>Comprimi</span>';
}

function renderTypes() {
  $('types-count').textContent = menuTypes.length;
  $('menu-types-cards').innerHTML = menuTypes.map((t, i) => {
    const n = Object.values(menuData).flat().filter(it => it.menuType?.includes(t.id)).length;
    return `<button class="chip ${t.id === 'default' ? 'main' : ''} ${t.visible ? '' : 'off'}" data-act="type-edit" data-i="${i}" title="ID: ${esc(t.id)}${t.visible ? '' : ' · non visibile'}">
      <img src="img/menu_icons/${t.icon || 1}.png" alt=""><span>${esc(t.name)}</span><small>${n}</small></button>`;
  }).join('') + `<button class="chip add" data-act="type-new">${I.plus}Nuovo</button>`;
}

function renderFilter() {
  const sorted = [...menuTypes.filter(t => t.id === 'default'), ...menuTypes.filter(t => t.id !== 'default')];
  $('menu-type-filter').innerHTML = sorted.map(t => `<option value="${esc(t.id)}" ${(filterType || 'default') === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}

function visibleItems(cat) {
  return (menuData[cat] || []).map((item, i) => ({ item, i })).filter(({ item }) =>
    (!filterType || item.menuType?.includes(filterType)) &&
    (!query || `${item.name} ${item.description}`.toLowerCase().includes(query)));
}

function renderCats() {
  const box = $('menu-sections'), filtering = filterType || query;
  box.className = `menu-sections ${view === 'list' ? 'list-view' : ''}`;
  if (!categories.length) {
    box.innerHTML = `<div class="empty"><h2>Menu vuoto</h2><p>Inizia aggiungendo una categoria</p><button class="btn-primary" data-act="add-cat">+ Aggiungi categoria</button></div>`;
    return;
  }
  const html = categories.map(cat => {
    const total = (menuData[cat] || []).length, vis = visibleItems(cat);
    if (filtering && !vis.length) return '';
    const hid = allHidden(cat);
    return `<section class="cat ${query || !collapsed.has(cat) ? '' : 'collapsed'}" data-cat="${esc(cat)}">
      <header class="cat-head">
        <span class="chev">${I.chev}</span><h2 class="cat-title">${esc(cat)}</h2>
        <span class="count">${filtering ? vis.length + '/' : ''}${total}</span>${hid ? '<span class="tag t-hid">Nascosta</span>' : ''}
        <div class="cat-actions">
          <button class="btn-primary btn-sm" data-act="cat-add" title="Aggiungi elemento">${I.plus}<span>Elemento</span></button>
          <button class="icon-btn" data-act="cat-vis" title="${hid ? 'Mostra' : 'Nascondi'} categoria">${hid ? I.eyeOff : I.eye}</button>
          <button class="icon-btn" data-act="cat-menu" title="Altre azioni">${I.more}</button>
        </div>
      </header>
      <div class="cat-body">${vis.length ? `<div class="grid">${vis.map(v => card(v.item, v.i)).join('')}</div>` : '<p class="muted">Nessun elemento: usa “Elemento” per aggiungerne uno.</p>'}</div>
    </section>`;
  }).join('');
  box.innerHTML = html || `<div class="empty"><h2>Nessun risultato</h2><button class="btn-secondary" data-act="clear-filter">Azzera filtri</button></div>`;
}

function card(it, i) {
  const price = it.price > 0 ? `€${it.price.toFixed(2)}` : it.customizable ? 'Su scelta' : '€0.00';
  return `<article class="item ${it.visible === false ? 'hid' : ''}" data-i="${i}">
    <img class="thumb" src="${esc(it.image || 'img/placeholder.png')}" alt="" loading="lazy">
    <div class="meta">
      <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
      ${it.description ? `<div class="desc">${esc(it.description).replace(/\n+/g, ' · ')}</div>` : ''}
      <div class="tags">
        ${it.isNew ? '<span class="tag t-new">Novità</span>' : ''}
        ${it.customizationGroup ? `<span class="tag t-grp" title="Gruppo ${esc(it.customizationGroup)}">Gr. ${esc(it.customizationGroup)}</span>` : ''}
        ${it.visible === false ? '<span class="tag t-hid">Nascosto</span>' : ''}
        ${(it.allergens || []).map(a => `<img class="al" src="img/allergeni/${esc(a)}.png" alt="" title="${esc(allergens[a] || '')}">`).join('')}
      </div>
    </div>
    <div class="price">${price}</div>
    <div class="quick">
      <button class="icon-btn sm" data-act="item-vis" title="${it.visible === false ? 'Mostra' : 'Nascondi'}">${it.visible === false ? I.eyeOff : I.eye}</button>
      <button class="icon-btn sm" data-act="item-dup" title="Duplica">${I.copy}</button>
    </div>
  </article>`;
}

function toggleCollapse(sec) {
  const c = sec.dataset.cat;
  collapsed.has(c) ? collapsed.delete(c) : collapsed.add(c);
  sec.classList.toggle('collapsed', collapsed.has(c));
  store.set(`gm_collapsed_${restaurantId}`, [...collapsed]);
  render();
}

// ===== ELEMENTO =====
function setPreview(src) {
  const p = $('product-preview');
  src ? p.src = src : p.removeAttribute('src');
  p.classList.toggle('hidden', !src);
  $('product-placeholder').classList.toggle('hidden', !!src);
  $('remove-image').classList.toggle('hidden', !src);
}

function openPopup(idx, cat) {
  const it = idx === null ? null : menuData[cat][idx];
  currentEdit = { category: cat, index: idx }; uploadedImage = null;

  $('popup-title').textContent = it ? `Modifica “${it.name}”` : `Nuovo elemento in “${cat}”`;
  $('delete-item').classList.toggle('hidden', !it);
  $('item-name').value = it?.name || '';
  $('item-price').value = it?.price ?? '';
  $('item-description').value = it?.description || '';
  $('item-new').checked = !!it?.isNew;
  $('hide-item').checked = it?.visible === false;
  $('item-customizable').checked = !!it?.customizable;
  $('customization-group-id').value = it?.customizationGroup || '';
  updateCustomizationVisibility(); updateGroupIdButton();
  setPreview(it?.image || '');

  $('allergens-grid').innerHTML = Object.entries(allergens).map(([id, name]) => `
    <div class="allergen-item ${it?.allergens?.includes(id) ? 'selected' : ''}" data-allergen-id="${id}">
      <img src="img/allergeni/${id}.png" alt=""><span title="${name}">${name}</span></div>`).join('');

  $('menu-types-checkboxes').innerHTML = menuTypes.map(t => {
    const isDef = t.id === 'default', on = isDef || it?.menuType?.includes(t.id) || (!it && filterType === t.id);
    return `<label class="checkbox-label"><input type="checkbox" value="${esc(t.id)}" ${on ? 'checked' : ''} ${isDef ? 'disabled' : ''}>
      <span class="checkmark"></span><span class="checkbox-text">${esc(t.name)}</span></label>`;
  }).join('');

  $('edit-popup').querySelector('.management-popup').scrollTop = 0;
  show('edit-popup');
}

function closeItemPopup() { hide('edit-popup'); currentEdit = { category: null, index: null }; }

function saveItem() {
  const name = $('item-name').value.trim(), price = parseFloat($('item-price').value);
  if (!name) return notify('Nome obbligatorio', 'error');
  if (isNaN(price) || price < 0) return notify('Prezzo non valido', 'error');

  const dupe = Object.entries(menuData).some(([cat, items]) => items.some((it, i) =>
    !(cat === currentEdit.category && i === currentEdit.index) && it.name.toLowerCase() === name.toLowerCase()));
  if (dupe) return notify(`"${name}" già esistente`, 'error');

  const old = currentEdit.index === null ? null : menuData[currentEdit.category][currentEdit.index];
  const types = [...document.querySelectorAll('#menu-types-checkboxes input:checked:not(:disabled)')].map(c => c.value);
  const custom = $('item-customizable').checked;
  const data = {
    name, price,
    image: $('product-preview').classList.contains('hidden') ? '' : uploadedImage || old?.image || '',
    description: $('item-description').value.trim(),
    allergens: [...document.querySelectorAll('.allergen-item.selected')].map(e => e.dataset.allergenId),
    isNew: $('item-new').checked, visible: !$('hide-item').checked,
    menuType: ['default', ...types], customizable: custom,
    customizationGroup: custom ? $('customization-group-id').value || null : null
  };
  old ? menuData[currentEdit.category][currentEdit.index] = data : menuData[currentEdit.category].push(data);

  setDirty(true); closeItemPopup(); render(); notify('Elemento salvato, ricorda di salvare il menu');
}

async function deleteItem() {
  if (!(await ask('Eliminare questo elemento?', 'L’operazione non può essere annullata.'))) return;
  const { category: cat, index } = currentEdit;
  menuData[cat].splice(index, 1);
  if (!menuData[cat].length && await ask('Categoria vuota', `"${cat}" è vuota. Vuoi rimuoverla?`, 'Rimuovi')) {
    delete menuData[cat]; categories = categories.filter(c => c !== cat);
  }
  setDirty(true); closeItemPopup(); render(); notify('Elemento eliminato');
}

// ===== IMMAGINE =====
const IMG_SIZE = 256;
// Quadrato trasparente 256x256, immagine centrata e mai tagliata; riduzione a gradini per qualità e poca RAM.
async function toSquareBlob(file) {
  const src = await createImageBitmap(file);
  const s = Math.min(IMG_SIZE / src.width, IMG_SIZE / src.height);
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 > w && ch / 2 > h) {
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(cw / 2); tmp.height = Math.ceil(ch / 2);
    const t = tmp.getContext('2d'); t.imageSmoothingQuality = 'high'; t.drawImage(cur, 0, 0, tmp.width, tmp.height);
    cur.close?.(); cur = tmp; cw = tmp.width; ch = tmp.height;
  }
  const out = document.createElement('canvas'); out.width = out.height = IMG_SIZE;
  const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, Math.round((IMG_SIZE - w) / 2), Math.round((IMG_SIZE - h) / 2), w, h);
  cur.close?.();
  const blob = await new Promise(r => out.toBlob(r, 'image/webp', 0.92));
  out.width = out.height = 0;
  return blob;
}

async function processImage(file) {
  const area = $('product-image-area');
  area.classList.add('busy');
  try {
    const blob = await toSquareBlob(file);
    const ext = blob.type === 'image/webp' ? 'webp' : 'png';
    const base64 = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(blob); });
    const old = currentEdit.index === null ? null : menuData[currentEdit.category][currentEdit.index];
    const res = await fetch('/upload-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: `${file.name.replace(/\.[^.]+$/, '')}.${ext}`, fileData: base64, restaurantId, oldImageUrl: old?.image })
    });
    const r = await res.json();
    if (!r.success) throw new Error(r.message);
    uploadedImage = r.imageUrl || `img/${r.fileName}`;
    setPreview(base64);
  } catch (err) { console.error(err); notify('Errore caricamento immagine', 'error'); }
  area.classList.remove('busy'); $('product-image').value = '';
}

// ===== CATEGORIE =====
function openCatPopup(cat) {
  editingCat = cat;
  editingItems = cat ? menuData[cat].map(i => ({ ...i, menuType: [...(i.menuType || [])] })) : [];
  $('cat-title').textContent = cat ? 'Modifica categoria' : 'Nuova categoria';
  $('cat-name').value = cat || '';
  $('cat-extra').classList.toggle('hidden', !cat);
  renderCatTypes(); renderRows(); show('edit-category-popup');
  if (!cat) $('cat-name').focus();
}

function renderCatTypes() {
  $('category-menu-types').innerHTML = menuTypes.filter(t => t.visible).map(t => {
    const n = editingItems.filter(i => i.menuType?.includes(t.id)).length, isDef = t.id === 'default';
    return `<label class="checkbox-label"><input type="checkbox" value="${esc(t.id)}" ${n ? 'checked' : ''} ${isDef ? 'disabled' : ''}>
      <span class="checkmark ${!isDef && n && n < editingItems.length ? 'incomplete' : ''}"></span><span class="checkbox-text">${esc(t.name)}</span></label>`;
  }).join('');
}

function toggleCatType(id, on) {
  editingItems.forEach(i => { i.menuType = on ? [...new Set([...(i.menuType || []), id])] : (i.menuType || []).filter(t => t !== id); });
  renderCatTypes();
}

function renderRows() {
  $('draggable-items-list').innerHTML = editingItems.map((it, i) => `
    <div class="row" draggable="true" data-i="${i}">
      <div class="arrows">
        <button class="reorder-btn" data-act="row-up" ${i === 0 ? 'disabled' : ''}><img src="img/arrow-up.png" alt="Su"></button>
        <button class="reorder-btn" data-act="row-down" ${i === editingItems.length - 1 ? 'disabled' : ''}><img src="img/arrow-down.png" alt="Giù"></button>
      </div>
      <img src="${esc(it.image || 'img/placeholder.png')}" alt="">
      <div class="info"><b>${esc(it.name)}</b><small>€${(it.price || 0).toFixed(2)}</small></div>
    </div>`).join('') || '<p class="muted">Nessun elemento</p>';
}

function moveRow(i, d) {
  const j = i + d;
  if (j < 0 || j >= editingItems.length) return;
  [editingItems[i], editingItems[j]] = [editingItems[j], editingItems[i]];
  renderRows();
}

function saveCategory() {
  const name = $('cat-name').value.trim();
  if (!name) return notify('Nome obbligatorio', 'error');
  if (name !== editingCat && categories.includes(name)) return notify('Categoria già esistente', 'error');

  if (editingCat === null) {
    categories.push(name); menuData[name] = [];
  } else {
    if (name !== editingCat) {
      menuData[name] = menuData[editingCat]; delete menuData[editingCat];
      categories[categories.indexOf(editingCat)] = name;
      if (collapsed.delete(editingCat)) collapsed.add(name);
    }
    menuData[name] = editingItems;
  }
  setDirty(true); hide('edit-category-popup'); render();
  notify(editingCat === null ? 'Categoria aggiunta' : 'Categoria aggiornata');
}

async function deleteCategory(name) {
  if (!(await ask(`Eliminare “${name}”?`, `Verranno eliminati anche i ${menuData[name].length} elementi contenuti.`))) return;
  delete menuData[name]; categories = categories.filter(c => c !== name);
  setDirty(true); render(); notify('Categoria eliminata');
}

function moveCat(name, d) {
  const i = categories.indexOf(name), j = i + d;
  if (j < 0 || j >= categories.length) return;
  [categories[i], categories[j]] = [categories[j], categories[i]];
  setDirty(true); render();
}

function toggleCategoryVisibility(cat) {
  const items = menuData[cat] || [], hideAll = items.some(i => i.visible !== false);
  items.forEach(i => i.visible = !hideAll);
  setDirty(true); render();
  notify(hideAll ? `Categoria "${cat}" nascosta per TUTTI i menu` : `Categoria "${cat}" mostrata per TUTTI i menu`);
}

// ===== TIPI DI MENU =====
async function checkDeliverySettings() {
  try {
    const r = await fetch(`IDs/${restaurantId}/settings.json`);
    if (!r.ok) return false;
    const { restaurant: a = {}, delivery: d = {} } = await r.json();
    return [a.name, a.street, a.number, a.cap, a.phone, a.email, d.radius, d.costType, d.prepTime].every(v => v != null && v !== '');
  } catch { return false; }
}

function lockDelivery(canEnable) {
  const cb = $('m-delivery');
  cb.disabled = !canEnable; if (!canEnable) cb.checked = false;
  cb.closest('.checkbox-label').classList.toggle('locked', !canEnable);
  cb.closest('.checkbox-label').title = canEnable ? '' : 'Configura le impostazioni di consegna per abilitare';
}

function syncCoperto() {
  const on = $('m-table').checked;
  $('type-coperto-form').style.display = on ? '' : 'none';
  if (!on) $('type-coperto').value = '0.00';
}

function setIcon(n) { iconIdx = n; $('type-icon').src = `img/menu_icons/${n}.png`; }

async function openTypePopup(idx) {
  editingTypeIdx = idx;
  const t = idx === null ? { name: '', coperto: 0, visible: true, icon: 1, methods: {} } : menuTypes[idx];
  $('type-title').textContent = idx === null ? 'Nuovo tipo menu' : 'Modifica tipo menu';
  setIcon(t.icon || 1);
  $('type-name').value = t.name;
  $('type-coperto').value = (t.coperto || 0).toFixed(2);
  METHODS.forEach(m => $('m-' + m).checked = idx !== null && t.methods?.[m] !== false);
  $('type-visible').checked = t.visible !== false;
  $('type-delete').classList.toggle('hidden', idx === null || t.id === 'default');
  syncCoperto(); show('type-popup');
  lockDelivery(await checkDeliverySettings());
}

async function saveType() {
  const name = $('type-name').value.trim();
  if (!name) return notify('Nome obbligatorio', 'error');
  const isNew = editingTypeIdx === null;
  const id = isNew ? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : menuTypes[editingTypeIdx].id;
  if (!id) return notify('Nome non valido', 'error');
  if (isNew && menuTypes.some(t => t.id === id)) return notify('Un menu con questo nome esiste già', 'error');

  const type = {
    id, name, icon: iconIdx, visible: $('type-visible').checked,
    coperto: parseFloat((parseFloat($('type-coperto').value) || 0).toFixed(2)),
    methods: Object.fromEntries(METHODS.map(m => [m, $('m-' + m).checked]))
  };
  if (isNew) {
    menuTypes.push(type);
    Object.values(menuData).flat().forEach(it => { it.menuType = [...new Set([...(it.menuType || []), id])]; });
    setDirty(true);
  } else menuTypes[editingTypeIdx] = type;

  await saveSettings(); hide('type-popup'); render();
  notify(isNew ? 'Tipo menu aggiunto' : 'Tipo menu aggiornato');
}

async function deleteType() {
  const t = menuTypes[editingTypeIdx];
  if (t.id === 'default') return notify('Il menu default può essere solo nascosto', 'error');
  const items = Object.values(menuData).flat(), inUse = items.some(i => i.menuType?.includes(t.id));
  if (!(await ask(`Eliminare “${t.name}”?`, inUse ? 'Questo menu è in uso: verrà rimosso da tutti gli elementi.' : 'L’operazione non può essere annullata.'))) return;
  items.forEach(i => { i.menuType = (i.menuType || []).filter(x => x !== t.id); });
  if (inUse) setDirty(true);
  menuTypes.splice(editingTypeIdx, 1);
  if (filterType === t.id) filterType = '';
  await saveSettings(); hide('type-popup'); render(); notify('Tipo menu eliminato');
}

// ===== SALVATAGGIO =====
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r = await res.json();
  if (!r.success) throw new Error(r.message);
}

async function saveMenu() {
  try {
    await post(`/save-menu/${restaurantId}`, {
      menuContent: {
        categories: categories.map(cat => ({
          name: cat,
          items: (menuData[cat] || []).map(i => ({
            name: i.name, price: i.price, imagePath: i.image, description: i.description, allergens: i.allergens,
            featured: i.isNew, visible: i.visible, menuType: i.menuType?.length ? i.menuType : undefined,
            customizable: i.customizable || false, customizationGroup: i.customizationGroup || null
          }))
        }))
      }
    });
    setDirty(false); notify('Menu salvato!');
  } catch (err) { console.error(err); notify('Errore salvataggio', 'error'); }
}

async function saveSettings() {
  try {
    await post(`/save-menu-types/${restaurantId}`, {
      menuTypes: menuTypes.map(t => ({
        id: t.id, name: t.name, copertoPrice: t.coperto || 0, visibility: t.visible !== false, icon: t.icon || 1,
        checkoutMethods: t.methods || { table: true, delivery: true, takeaway: true, show: true }
      }))
    });
    return true;
  } catch (err) { console.error(err); notify('Errore salvataggio tipi menu', 'error'); return false; }
}
