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
// Trascinamento card: solo dispositivi con puntatore preciso e hover (mouse), mai su touch/cellulari
const canDrag = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
let dragItem = null;
let suppressClickUntil = 0; // dopo un trascinamento col dito ignora il click che ne segue

const VIEW_ONLY = { table: false, delivery: false, takeaway: false, show: false };
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
  $('category-menu-types').onchange = e => toggleCatType(e.target.value, e.target.checked);
  $('allergens-grid').onclick = e => e.target.closest('.allergen-item')?.classList.toggle('selected');

  const area = $('product-image-area');
  area.onclick = () => $('product-image').click();
  area.ondragover = e => { e.preventDefault(); area.classList.add('dragover'); };
  area.ondragleave = () => area.classList.remove('dragover');
  area.ondrop = e => { e.preventDefault(); area.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) processImage(f); else { const u = (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0].trim(); if (/^https?:/.test(u)) imageFromUrl(u); } };
  $('product-image').onchange = e => e.target.files[0] && processImage(e.target.files[0]);

  const list = $('draggable-items-list');
  list.ondragstart = e => { dragFrom = +e.target.closest('.row')?.dataset.i; };
  list.ondragover = e => e.preventDefault();
  list.ondrop = e => {
    const to = +e.target.closest('.row')?.dataset.i;
    if (isNaN(to) || dragFrom == null || isNaN(dragFrom)) return;
    editingItems.splice(to, 0, editingItems.splice(dragFrom, 1)[0]); dragFrom = null; renderRows();
  };

  if (!canDrag()) attachTouchDrag({
    root: list, itemSel: '.row',
    scroller: () => document.querySelector('#edit-category-popup .pop-body'),
    start: el => { el.classList.add('dragging'); return +el.dataset.i; },
    move: (from, x, y, node) => {
      list.querySelectorAll('.drop-before, .drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'));
      const r = node?.closest?.('.row');
      if (!r || !list.contains(r) || +r.dataset.i === from) return;
      const b = r.getBoundingClientRect();
      r.classList.add(y > b.top + b.height / 2 ? 'drop-after' : 'drop-before');
    },
    drop: (from, x, y, node) => {
      const r = node?.closest?.('.row');
      if (r && list.contains(r) && +r.dataset.i !== from) {
        const b = r.getBoundingClientRect();
        let to = +r.dataset.i + (y > b.top + b.height / 2 ? 1 : 0);
        if (from < to) to--;
        editingItems.splice(to, 0, editingItems.splice(from, 1)[0]);
      }
      renderRows();
    },
    cancel: () => renderRows()
  });

  initItemDrag();
  document.addEventListener('click', onClick);
  document.addEventListener('mousedown', e => { downOnBackdrop = e.target.classList.contains('popup'); }, true);
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

// ===== TRASCINAMENTO COL DITO (pressione prolungata) =====
// Il drag HTML5 non funziona in modo affidabile su touch: qui si usano i touch event.
// Tieni premuto ~0,4 s su un elemento, poi trascina; scorre da solo vicino ai bordi.
function attachTouchDrag({ root, itemSel, scroller, start, move, drop, cancel }) {
  let timer = null, el = null, state = null, ghost = null, active = false, raf = 0;
  let sx = 0, sy = 0, lx = 0, ly = 0, offX = 0, offY = 0;

  const nodeAt = (x, y) => document.elementFromPoint(x, y);
  const place = (x, y) => { if (ghost) ghost.style.transform = `translate(${x - offX}px, ${y - offY}px) scale(1.03)`; };

  const loop = () => {
    if (!active) return;
    const sc = scroller && scroller();
    const rect = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const edge = sc ? 56 : 100, speed = 14;   // 100px in alto: c'è la toolbar sticky
    const dy = ly < rect.top + edge ? -speed : ly > rect.bottom - edge ? speed : 0;
    if (dy) {
      if (sc) sc.scrollTop += dy; else window.scrollBy(0, dy);
      move(state, lx, ly, nodeAt(lx, ly));
    }
    raf = requestAnimationFrame(loop);
  };

  const begin = () => {
    timer = null;
    if (!el) return;
    state = start(el);
    if (state == null || state === false) { el = null; return; }
    active = true;
    const r = el.getBoundingClientRect();
    offX = sx - r.left; offY = sy - r.top;
    ghost = el.cloneNode(true);
    ghost.classList.remove('dragging');
    ghost.classList.add('touch-ghost');
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    root.appendChild(ghost);                  // dentro root: mantiene gli stili di vista lista/griglia
    place(sx, sy);
    if (navigator.vibrate) navigator.vibrate(12);
    raf = requestAnimationFrame(loop);
  };

  root.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || active) return;
    const it = e.target.closest(itemSel);
    if (!it || e.target.closest('button, a, input, textarea, select')) return;
    el = it;
    sx = lx = e.touches[0].clientX; sy = ly = e.touches[0].clientY;
    clearTimeout(timer);
    timer = setTimeout(begin, 380);
  }, { passive: true });

  root.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!active) {
      // il dito si muove prima del long-press: è uno scroll normale, annulla
      if (timer && Math.hypot(t.clientX - sx, t.clientY - sy) > 10) { clearTimeout(timer); timer = null; el = null; }
      return;
    }
    e.preventDefault();                       // blocca lo scroll mentre trascini
    lx = t.clientX; ly = t.clientY;
    place(lx, ly);
    move(state, lx, ly, nodeAt(lx, ly));
  }, { passive: false });

  const finish = (e, canceled) => {
    clearTimeout(timer); timer = null;
    if (!active) { el = null; return; }
    if (e.cancelable) e.preventDefault();
    suppressClickUntil = Date.now() + 400;
    active = false; cancelAnimationFrame(raf);
    const x = lx, y = ly, node = nodeAt(x, y), st = state;
    if (ghost) ghost.remove();
    ghost = null; state = null; el = null;
    canceled ? cancel(st) : drop(st, x, y, node);
  };
  root.addEventListener('touchend', e => finish(e, false), { passive: false });
  root.addEventListener('touchcancel', e => finish(e, true), { passive: false });
  root.addEventListener('contextmenu', e => { if (e.target.closest(itemSel)) e.preventDefault(); });
}

// ===== DRAG & DROP ELEMENTI (mouse: HTML5, touch: pressione prolungata) =====
function initItemDrag() {
  const box = $('menu-sections');
  const clearHints = () => box.querySelectorAll('.drop-before, .drop-after, .drop-target')
    .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-target'));
  const clearMarks = () => { clearHints(); box.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging')); };

  // Destinazione sotto il punto (x, y): { cat, index (null = in fondo), after }
  const targetAt = (node, x, y) => {
    const sec = node?.closest?.('.cat');
    if (!sec || !box.contains(sec)) return null;
    const cat = sec.dataset.cat, el = node.closest('.item');
    if (!el) return { sec, cat, index: null, after: false };
    const r = el.getBoundingClientRect();
    const after = view === 'list' ? y > r.top + r.height / 2 : x > r.left + r.width / 2;
    return { sec, el, cat, index: +el.dataset.i, after };
  };

  const hint = (t, from) => {
    clearHints();
    if (!t) return;
    if (t.el) { if (!(t.cat === from.cat && t.index === from.i)) t.el.classList.add(t.after ? 'drop-after' : 'drop-before'); }
    else t.sec.classList.add('drop-target');
  };

  const drop = (t, from) => {
    if (!t) return;
    if (t.el && t.cat === from.cat && t.index === from.i) return;
    const [moved] = menuData[from.cat].splice(from.i, 1);
    const dest = menuData[t.cat];
    let pos = dest.length;
    if (t.index !== null) {
      pos = t.index;
      if (t.cat === from.cat && from.i < t.index) pos--;
      if (t.after) pos++;
    }
    dest.splice(pos, 0, moved);
    setDirty(true); render();
  };

  // --- mouse ---
  box.addEventListener('dragstart', e => {
    const el = e.target.closest?.('.item');
    if (!el || !canDrag()) return e.preventDefault();
    dragItem = { cat: el.closest('.cat').dataset.cat, i: +el.dataset.i };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'menu-item');
    hideCtx();
    setTimeout(() => el.classList.add('dragging'));
  });

  box.addEventListener('dragover', e => {
    if (!dragItem || !canDrag()) return;
    const t = targetAt(e.target, e.clientX, e.clientY);
    if (!t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    hint(t, dragItem);
  });

  box.addEventListener('drop', e => {
    if (!dragItem || !canDrag()) return;
    const t = targetAt(e.target, e.clientX, e.clientY), from = dragItem;
    dragItem = null; clearMarks();
    if (!t) return;
    e.preventDefault();
    drop(t, from);
  });

  box.addEventListener('dragend', () => { dragItem = null; clearMarks(); });

  // --- dito ---
  if (!canDrag()) attachTouchDrag({
    root: box, itemSel: '.item',
    scroller: () => null,                                   // scorre la pagina
    start: el => { hideCtx(); el.classList.add('dragging'); return { cat: el.closest('.cat').dataset.cat, i: +el.dataset.i }; },
    move: (from, x, y, node) => hint(targetAt(node, x, y), from),
    drop: (from, x, y, node) => { const t = targetAt(node, x, y); clearMarks(); drop(t, from); },
    cancel: () => clearMarks()
  });
}

// ===== EVENTI (delegati) =====
function onClick(e) {
  if (Date.now() < suppressClickUntil) return;
  const t = e.target.closest('[data-act]');
  if (t) { const a = t.dataset.act; if (a !== 'ctx' && a !== 'cat-menu') hideCtx(); return actions[a]?.(t, e); }
  hideCtx();

  const item = e.target.closest('.item');
  if (item) return openPopup(+item.dataset.i, item.closest('.cat').dataset.cat);
  const head = e.target.closest('.cat-head');
  if (head) return toggleCollapse(head.closest('.cat'));
  if (downOnBackdrop && e.target.classList.contains('popup') && ['edit-popup', 'confirm-popup'].includes(e.target.id)) e.target.querySelector('.close-popup, .btn-secondary')?.click();
}

const catOf = el => el.closest('.cat').dataset.cat;
const idxOf = el => +el.closest('.item').dataset.i;
const actions = {
  back: () => location.href = '/profile',
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
  'search-image': searchImage,

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
// Blocco scroll unico per tutti i popup (anche quelli di customization-manager.js).
// Il body viene fissato in JS con top negativo: la pagina resta visivamente ferma e
// alla chiusura dell'ultimo popup si torna esattamente alla posizione di prima.
let lockY = 0, scrollLocked = false;
function lockScroll() {
  if (scrollLocked) return;
  scrollLocked = true; lockY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${lockY}px`, left: '0', right: '0', width: '100%' });
}
function unlockScroll() {
  if (!scrollLocked) return;
  scrollLocked = false;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
  window.scrollTo(0, lockY);
}
// Sblocca solo se non resta aperto nessun popup
function unlockIfIdle() { if (!document.querySelector('.popup:not(.hidden)')) unlockScroll(); }
const restoreScroll = () => {
  if (scrollLocked) return;
  window.scrollTo(0, lockY);
  requestAnimationFrame(() => window.scrollTo(0, lockY)); // di nuovo dopo il re-render/layout
};
const show = id => { lockScroll(); $(id).classList.remove('hidden'); document.body.classList.add('popup-open'); };
const hide = id => {
  $(id).classList.add('hidden');
  if (!document.querySelector('.popup:not(.hidden)')) {
    document.body.classList.remove('popup-open');
    unlockScroll();
  }
};
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
      // Dopo ogni caricamento gli elementi nascosti vanno in fondo alla categoria (ordine stabile per il resto)
      menuData[cat.name].sort((a, b) => (a.visible === false) - (b.visible === false));
    });

    menuTypes = (settings.menuTypes || []).map(t => ({
      id: t.id, name: t.name, coperto: t.copertoPrice || 0, visible: t.visibility !== false, icon: t.icon || 1,
      methods: t.checkoutMethods || VIEW_ONLY
    }));
    if (!menuTypes.some(t => t.id === 'default'))
      menuTypes.unshift({ id: 'default', name: 'Menu Intero', coperto: 0, visible: true, icon: 1, methods: VIEW_ONLY });
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
    return `<button class="chip ${t.visible ? '' : 'off'}" data-act="type-edit" data-i="${i}" title="ID: ${esc(t.id)}${t.visible ? '' : ' · non visibile'}">
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
          <button class="icon-btn add" data-act="cat-add" title="Aggiungi elemento" aria-label="Aggiungi elemento">${I.plus}</button>
          <button class="icon-btn" data-act="cat-menu" title="Altre azioni">${I.more}</button>
        </div>
      </header>
      <div class="cat-body">${vis.length ? `<div class="grid">${vis.map(v => card(v.item, v.i)).join('')}</div>` : '<p class="muted">Nessun elemento: usa il tasto + per aggiungerne uno.</p>'}</div>
    </section>`;
  }).join('');
  box.innerHTML = html || `<div class="empty"><h2>Nessun risultato</h2><button class="btn-secondary" data-act="clear-filter">Azzera filtri</button></div>`;
}

function card(it, i) {
  const price = it.price > 0 ? `€${it.price.toFixed(2)}` : it.customizable ? 'Su scelta' : '€0.00';
  const tags = [
    it.isNew ? '<span class="tag t-new">Novità</span>' : '',
    it.customizationGroup ? `<span class="tag t-grp" title="Gruppo ${esc(it.customizationGroup)}">Gr. ${esc(it.customizationGroup)}</span>` : '',
    it.visible === false ? '<span class="tag t-hid">Nascosto</span>' : '',
    ...(it.allergens || []).map(a => `<img class="al" src="img/allergeni/${esc(a)}.png" alt="" title="${esc(allergens[a] || '')}">`)
  ].join('');
  return `<article class="item ${it.visible === false ? 'hid' : ''}" data-i="${i}" ${canDrag() ? 'draggable="true"' : ''}>
    <img class="thumb" src="${esc(it.image || 'img/placeholder.png')}" alt="" loading="lazy">
    <div class="meta">
      <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
      ${it.description ? `<div class="desc">${esc(it.description).replace(/\n+/g, ' · ')}</div>` : ''}
    </div>
    <div class="price">${price}</div>
    ${tags ? `<div class="tags">${tags}</div>` : ''}
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
  $('search-image').classList.toggle('hidden', !!src);
}

// Cerca: apre Google Immagini ("[nome] png") in una finestra stretta sul bordo destro dello schermo.
// Scelta la foto: tasto destro → "Copia immagine", poi Ctrl+V qui.
let searchWin = null;
function searchImage() {
  const name = $('item-name').value.trim();
  if (!name) return notify('Inserisci prima il nome del prodotto', 'error');
  const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + ' png')}`;
  const w = Math.min(520, screen.availWidth), h = screen.availHeight;
  const left = (screen.availLeft ?? 0) + screen.availWidth - w, top = screen.availTop ?? 0;
  searchWin = window.open(url, 'img-search', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!searchWin) return notify('Popup bloccato: consenti i popup per questo sito', 'error');
  searchWin.focus();
  notify('Scegli la foto, tasto destro → “Copia immagine”, poi torna qui e premi Ctrl+V');
}

const closeSearchWin = () => { if (searchWin && !searchWin.closed) searchWin.close(); };
function imageFileName(type) {
  const n = $('item-name').value.trim() || 'immagine';
  return `${n}.${(type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`;
}

// Ctrl+V / Cmd+V con il popup elemento aperto (fuori dai campi di testo)
document.addEventListener('paste', e => {
  if ($('edit-popup').classList.contains('hidden') || e.target.closest('input, textarea')) return;
  const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
  if (!f) return;
  e.preventDefault();
  processImage(new File([f], imageFileName(f.type), { type: f.type }));
});

// Trascinando un'immagine da Google sull'area di upload arriva spesso solo l'URL: si prova a scaricarla
async function imageFromUrl(url) {
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.type.startsWith('image/')) throw 0;
    await processImage(new File([blob], imageFileName(blob.type), { type: blob.type }));
  } catch { notify('Immagine non scaricabile da qui: usa “Copia immagine” e Ctrl+V', 'error'); }
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
  $('item-customizable').checked = !!it?.customizable;
  $('customization-group-id').value = it?.customizationGroup || '';
  updateCustomizationVisibility(); updateGroupIdButton();
  setPreview(it?.image || '');

  $('allergens-grid').innerHTML = Object.entries(allergens).map(([id, name]) => `
    <div class="allergen-item ${it?.allergens?.includes(id) ? 'selected' : ''}" data-allergen-id="${id}" title="${name}">
      <img src="img/allergeni/${id}.png" alt=""><span>${name}</span></div>`).join('');

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
  const custom = $('item-customizable').checked;
  const data = {
    name, price,
    image: $('product-preview').classList.contains('hidden') ? '' : uploadedImage || old?.image || '',
    description: $('item-description').value.trim(),
    allergens: [...document.querySelectorAll('.allergen-item.selected')].map(e => e.dataset.allergenId),
    isNew: $('item-new').checked, visible: old ? old.visible : true,
    menuType: [...new Set([...(old ? old.menuType || [] : menuTypes.map(t => t.id)), 'default'])], customizable: custom,
    customizationGroup: custom ? $('customization-group-id').value || null : null
  };
  old ? menuData[currentEdit.category][currentEdit.index] = data : menuData[currentEdit.category].push(data);

  setDirty(true); closeItemPopup(); render(); restoreScroll(); notify('Elemento salvato, ricorda di salvare il menu');
}

async function deleteItem() {
  if (!(await ask('Eliminare questo elemento?', 'L’operazione non può essere annullata.'))) return;
  const { category: cat, index } = currentEdit;
  menuData[cat].splice(index, 1);
  if (!menuData[cat].length && await ask('Categoria vuota', `"${cat}" è vuota. Vuoi rimuoverla?`, 'Rimuovi')) {
    delete menuData[cat]; categories = categories.filter(c => c !== cat);
  }
  setDirty(true); closeItemPopup(); render(); restoreScroll(); notify('Elemento eliminato');
}

// ===== IMMAGINE =====
// Pipeline (come lo script magick):
//   1) controllo bordi bianchi (tolleranza larga): basta anche 1 solo lato bianco, altrimenti si salta il punto 2
//   2) floodfill trasparente dal bordo (fuzz 5%) + trim dei bordi trasparenti
//   3) quadrato trasparente centrato (padding) -> 4) ridimensionamento a max 256x256 (mai ingrandita)
const IMG_SIZE = 256;     // lato massimo finale
const WORK_SIZE = 1024;   // dimensione di lavoro per fill e trim (veloce e poca RAM)
const CHECK_TOL = 32;     // tolleranza del controllo bordi (0-255, ~12%): "bianco" anche se sporco/grigino
const BORDER_MIN = 0.95;  // quota minima di un lato bianco/trasparente per considerarlo "bianco"
const FILL_TOL = 13;      // fuzz del floodfill (0-255, ~5% come -fuzz 5%)

// Ridimensiona a gradini (qualità alta, poca RAM). Non chiude mai `src`.
function scaleTo(src, w, h) {
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 > w && ch / 2 > h) {
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(cw / 2); tmp.height = Math.ceil(ch / 2);
    const t = tmp.getContext('2d'); t.imageSmoothingQuality = 'high';
    t.drawImage(cur, 0, 0, tmp.width, tmp.height);
    if (cur !== src) cur.width = cur.height = 0;
    cur = tmp; cw = tmp.width; ch = tmp.height;
  }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const o = out.getContext('2d'); o.imageSmoothingQuality = 'high';
  o.drawImage(cur, 0, 0, w, h);
  if (cur !== src) cur.width = cur.height = 0;
  return out;
}

// pixel "sfondo": trasparente oppure quasi bianco (entro `tol` per canale)
const isBg = (d, p, tol) => d[p + 3] < 16 ||
  (d[p] >= 255 - tol && d[p + 1] >= 255 - tol && d[p + 2] >= 255 - tol);

// Se almeno un lato è bianco: floodfill trasparente da quel/i lato/i + trim. Altrimenti restituisce il canvas com'è.
function removeWhiteBg(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h), d = img.data;

  // 1) controllo dei 4 lati (tolleranza larga): basta che ne passi anche uno solo
  const sideWhite = (n, at) => {
    let bg = 0;
    for (let i = 0; i < n; i++) if (isBg(d, at(i) * 4, CHECK_TOL)) bg++;
    return bg / n >= BORDER_MIN;
  };
  const sides = {
    top:    sideWhite(w, i => i),
    bottom: sideWhite(w, i => (h - 1) * w + i),
    left:   sideWhite(h, i => i * w),
    right:  sideWhite(h, i => i * w + (w - 1))
  };
  if (!sides.top && !sides.bottom && !sides.left && !sides.right) return canvas;

  // 2) floodfill: parte dai pixel "bianchi" dei soli lati bianchi e si espande con fuzz stretto
  //    (solo lo sfondo collegato a quei lati diventa trasparente)
  const seen = new Uint8Array(w * h), stack = [];
  const seed = (x, y) => { const i = y * w + x; if (!seen[i] && isBg(d, i * 4, CHECK_TOL)) { seen[i] = 1; stack.push(i); } };
  const grow = (x, y) => { const i = y * w + x; if (!seen[i] && isBg(d, i * 4, FILL_TOL)) { seen[i] = 1; stack.push(i); } };
  if (sides.top)    for (let x = 0; x < w; x++) seed(x, 0);
  if (sides.bottom) for (let x = 0; x < w; x++) seed(x, h - 1);
  if (sides.left)   for (let y = 0; y < h; y++) seed(0, y);
  if (sides.right)  for (let y = 0; y < h; y++) seed(w - 1, y);
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    d[i * 4 + 3] = 0;
    if (x > 0) grow(x - 1, y); if (x < w - 1) grow(x + 1, y);
    if (y > 0) grow(x, y - 1); if (y < h - 1) grow(x, y + 1);
  }

  // 3) trim: bounding box dei pixel visibili
  let x0 = w, y0 = h, x1 = -1, y1 = -1, visible = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 8) {
      visible++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (visible < w * h * 0.01) return canvas; // immagine praticamente tutta bianca: lascio l'originale

  ctx.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  canvas.width = canvas.height = 0;
  return out;
}

// Quadrato trasparente con immagine centrata, mai tagliata, lato max 256 (le piccole non vengono ingrandite).
async function toSquareBlob(file) {
  const src = await createImageBitmap(file);
  const k = Math.min(1, WORK_SIZE / Math.max(src.width, src.height));
  let work = scaleTo(src, Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
  src.close?.();

  work = removeWhiteBg(work);                       // 1-2) controllo bordi, floodfill, trim

  const side = Math.max(work.width, work.height);   // 3) lato del quadrato con padding
  const finalSide = Math.min(IMG_SIZE, side);       // 4) mai oltre 256, mai ingrandita
  const s = finalSide / side;
  const w = Math.max(1, Math.round(work.width * s)), h = Math.max(1, Math.round(work.height * s));
  const fitted = scaleTo(work, w, h);
  work.width = work.height = 0;

  const out = document.createElement('canvas'); out.width = out.height = finalSide;
  const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fitted, Math.round((finalSide - w) / 2), Math.round((finalSide - h) / 2), w, h);
  fitted.width = fitted.height = 0;

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
    const res = await fetch('/upload-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: `${file.name.replace(/\.[^.]+$/, '')}.${ext}`, fileData: base64, restaurantId })
    });
    const r = await res.json();
    if (!r.success) throw new Error(r.message);
    uploadedImage = r.imageUrl || `img/${r.fileName}`;
    setPreview(base64);
    closeSearchWin();
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
    <div class="row" ${canDrag() ? 'draggable="true"' : ''} data-i="${i}">
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
  setDirty(true); hide('edit-category-popup'); render(); restoreScroll();
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
function setIcon(n) { iconIdx = n; $('type-icon').src = `img/menu_icons/${n}.png`; }

async function openTypePopup(idx) {
  editingTypeIdx = idx;
  const t = idx === null ? { name: '', coperto: 0, visible: true, icon: 1 } : menuTypes[idx];
  $('type-title').textContent = idx === null ? 'Nuovo tipo menu' : 'Modifica tipo menu';
  setIcon(t.icon || 1);
  $('type-name').value = t.name;
  $('type-coperto').value = (t.coperto || 0).toFixed(2);
  $('type-visible').checked = t.visible !== false;
  $('type-delete').classList.toggle('hidden', idx === null || t.id === 'default');
  show('type-popup');
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
    methods: isNew ? { ...VIEW_ONLY } : menuTypes[editingTypeIdx].methods
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
    if (typeof pruneCustomizations === 'function') await pruneCustomizations();
  } catch (err) { console.error(err); notify('Errore salvataggio', 'error'); }
}

async function saveSettings() {
  try {
    await post(`/save-menu-types/${restaurantId}`, {
      menuTypes: menuTypes.map(t => ({
        id: t.id, name: t.name, copertoPrice: t.coperto || 0, visibility: t.visible !== false, icon: t.icon || 1,
        checkoutMethods: t.methods || VIEW_ONLY
      }))
    });
    return true;
  } catch (err) { console.error(err); notify('Errore salvataggio tipi menu', 'error'); return false; }
}
