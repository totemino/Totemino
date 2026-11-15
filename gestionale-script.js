(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const fmt = (d) => (d ? d.split('-').reverse().join('/') : '—');
  const REF_LABEL = { pending: 'Da contattare', interested: 'Interessato', not_interested: 'Non interessato', closed: 'Chiuso' };
  const FILTERS = {
    users: [['all', 'Tutti'], ['due', 'Da pagare'], ['late', 'Scaduti'], ['paid', 'Pagati']],
    refs: [['all', 'Tutte'], ['pending', 'Da contattare'], ['interested', 'Interessate'], ['not_interested', 'Non interessate'], ['closed', 'Chiuse']]
  };

  const state = { tab: 'users', users: [], refs: [], editId: null, logo: '', configured: true };

  // ---------- util ----------
  let toastTimer;
  function toast(msg, isError) {
    const n = $('#note');
    n.textContent = msg;
    n.classList.toggle('error', !!isError);
    n.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => n.classList.remove('show'), 2600);
  }

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.requireLogin) { showAuth(); throw new Error('Sessione scaduta, accedi di nuovo'); }
    if (!res.ok || data.success === false) throw new Error(data.message || 'Errore');
    return data;
  }

  // ---------- utenti ----------
  function userState(u) {
    if (u.paid) return ['paid', 'Pagato'];
    if (u.renewalDate && u.renewalDate < TODAY) return ['late', 'Scaduto'];
    return ['due', 'Da pagare'];
  }

  function userRow(u) {
    const [cls, label] = userState(u);
    const initial = esc((u.name || u.id).trim().charAt(0).toUpperCase());
    const avatar = u.logo ? `<img src="${esc(u.logo)}" alt="" loading="lazy">` : initial;
    const disc = u.discount ? `<span class="gx-tag closed">Sconto ${u.discount}%</span>` : '';
    return `<div class="gx-card gx-user" data-id="${esc(u.id)}">
      <div class="gx-avatar">${avatar}</div>
      <div class="gx-info"><b>${esc(u.name || 'Senza nome')}</b><small>ID ${esc(u.id)} · iscritto ${fmt(u.createdAt)} · rinnovo ${fmt(u.renewalDate)}</small></div>
      ${disc}<span class="gx-tag ${cls}">${label}</span>
      <button class="icon-btn" data-paid type="button" title="${u.paid ? 'Segna non pagato' : 'Segna pagato'}" aria-label="Segna pagato">${u.paid ? '↺' : '✓'}</button>
    </div>`;
  }

  async function togglePaid(u) {
    const next = !u.paid;
    u.paid = next;
    render();
    try { await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { paid: next }); }
    catch (e) { u.paid = !next; render(); toast(e.message, true); }
  }

  // ---------- referenze ----------
  function refRow(r) {
    const closeBtn = (r.status === 'interested' || r.status === 'closed')
      ? `<button class="btn-secondary btn-sm" data-close type="button">${r.status === 'closed' ? 'Riapri' : 'Chiuso'}</button>` : '';
    return `<div class="gx-swipe" data-id="${esc(r.id)}">
      <div class="gx-swipe-in gx-card st-${r.status}">
        <div class="gx-info"><b>${esc(r.name)}</b><small><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a> · da ${esc(r.ownerName || r.owner)} · ${fmt((r.createdAt || '').slice(0, 10))}</small></div>
        ${closeBtn}<span class="gx-tag ${r.status}">${REF_LABEL[r.status] || r.status}</span>
      </div>
    </div>`;
  }

  async function setStatus(r, next) {
    if (r.status === next) next = 'pending'; // stesso gesto due volte = annulla
    const prev = r.status;
    r.status = next;
    render();
    try { await api(`/api/admin/referrals/${encodeURIComponent(r.id)}`, { status: next }); }
    catch (e) { r.status = prev; render(); toast(e.message, true); }
  }

  function bindSwipe(el) {
    const r = state.refs.find((x) => x.id === el.dataset.id);
    const inner = el.querySelector('.gx-swipe-in');
    let x0 = null, dx = 0;
    inner.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a, button')) return;
      x0 = e.clientX; dx = 0;
      inner.setPointerCapture(e.pointerId);
      inner.classList.add('dragging');
    });
    inner.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      dx = Math.max(-140, Math.min(140, e.clientX - x0));
      inner.style.transform = `translateX(${dx}px)`;
      el.dataset.dir = dx > 8 ? 'right' : dx < -8 ? 'left' : '';
    });
    const end = () => {
      if (x0 === null) return;
      const d = dx;
      x0 = null;
      inner.classList.remove('dragging');
      inner.style.transform = '';
      el.dataset.dir = '';
      if (Math.abs(d) > 80) setStatus(r, d > 0 ? 'interested' : 'not_interested');
    };
    inner.addEventListener('pointerup', end);
    inner.addEventListener('pointercancel', end);
  }

  // ---------- render ----------
  function render() {
    const q = $('#search').value.trim().toLowerCase();
    const f = $('#filter').value || 'all';
    const box = $('#list');
    if (state.tab === 'users') {
      const rows = state.users.filter((u) => (!q || `${u.id} ${u.name}`.toLowerCase().includes(q)) && (f === 'all' || userState(u)[0] === f));
      $('#stats').textContent = `${rows.length} utenti`;
      box.innerHTML = rows.map(userRow).join('') || '<p class="muted">Nessun utente.</p>';
    } else {
      const rows = state.refs.filter((r) => (!q || `${r.name} ${r.phone} ${r.owner} ${r.ownerName || ''}`.toLowerCase().includes(q)) && (f === 'all' || r.status === f));
      $('#stats').textContent = `${rows.length} referenze · scorri a destra = interessato, a sinistra = non interessato`;
      box.innerHTML = rows.map(refRow).join('') || '<p class="muted">Nessuna referenza.</p>';
      box.querySelectorAll('.gx-swipe').forEach(bindSwipe);
    }
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.gx-tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    $('#filter').innerHTML = FILTERS[tab].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('#search').value = '';
    render();
  }

  // ---------- modifica utente ----------
  function setPreview(src) {
    const img = $('#imgPrev');
    img.classList.toggle('hidden', !src);
    $('#imgPh').classList.toggle('hidden', !!src);
    if (src) img.src = src; else img.removeAttribute('src');
  }

  function openEdit(u) {
    state.editId = u.id;
    state.logo = u.logo || '';
    $('#editTitle').textContent = `Utente ${u.id}`;
    $('#fName').value = u.name || '';
    $('#fRenew').value = u.renewalDate || '';
    $('#fPaid').checked = !!u.paid;
    setPreview(state.logo);
    $('#editModal').classList.add('open');
    document.body.classList.add('noscroll');
  }

  function closeEdit() {
    $('#editModal').classList.remove('open');
    document.body.classList.remove('noscroll');
    state.editId = null;
  }

  async function saveEdit() {
    const u = state.users.find((x) => x.id === state.editId);
    if (!u) return;
    const body = { name: $('#fName').value.trim(), paid: $('#fPaid').checked };
    if ($('#fRenew').value) body.renewalDate = $('#fRenew').value;
    if (state.logo !== (u.logo || '')) body.logo = state.logo; // solo se cambiata
    const btn = $('#editSave');
    btn.disabled = true;
    try {
      await api(`/api/admin/users/${encodeURIComponent(u.id)}`, body);
      u.name = body.name;
      u.paid = body.paid;
      if (body.renewalDate) u.renewalDate = body.renewalDate;
      if ('logo' in body) u.logo = body.logo;
      closeEdit();
      render();
      toast('Salvato');
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  }

  async function uploadPhoto(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Usa un file JPG, PNG o WebP', true);
    const area = $('#imgArea');
    area.classList.add('busy');
    try {
      const fileData = await new Promise((ok, ko) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.onerror = ko;
        fr.readAsDataURL(file);
      });
      const r = await api('/api/admin/upload', { fileName: file.name, fileData, restaurantId: state.editId });
      state.logo = r.imageUrl;
      setPreview(r.imageUrl);
    } catch (e) { toast(e.message, true); }
    finally { area.classList.remove('busy'); }
  }

  // ---------- eventi ----------
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.gx-tab'); if (b) setTab(b.dataset.tab); });
  $('#search').addEventListener('input', render);
  $('#filter').addEventListener('change', render);

  $('#list').addEventListener('click', (e) => {
    const card = e.target.closest('.gx-user');
    if (card) {
      const u = state.users.find((x) => x.id === card.dataset.id);
      if (!u) return;
      if (e.target.closest('[data-paid]')) togglePaid(u); else openEdit(u);
      return;
    }
    const sw = e.target.closest('.gx-swipe');
    if (sw && e.target.closest('[data-close]')) {
      const r = state.refs.find((x) => x.id === sw.dataset.id);
      if (r) setStatus(r, r.status === 'closed' ? 'interested' : 'closed');
    }
  });

  $('#editCancel').addEventListener('click', closeEdit);
  $('#editModal').addEventListener('click', (e) => { if (e.target.id === 'editModal') closeEdit(); });
  $('#editSave').addEventListener('click', saveEdit);
  $('#imgArea').addEventListener('click', () => $('#imgInput').click());
  $('#imgArea').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#imgInput').click(); } });
  $('#imgInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadPhoto(f); });
  $('#imgRemove').addEventListener('click', () => { state.logo = ''; setPreview(''); });

  // ---------- accesso (password del gestionale, nessun profilo) ----------
  function showAuth(configured) {
    if (configured !== undefined) state.configured = configured;
    closeEdit();
    $('#pwModal').classList.remove('open');
    $('#appView').classList.add('hidden');
    $('#authView').classList.remove('hidden');
    $('#authTitle').textContent = state.configured ? 'Accesso' : 'Imposta la password';
    $('#authHint').textContent = state.configured ? '' : 'Prima volta qui: la password che scegli ora verrà salvata. Potrai cambiarla dal gestionale.';
    $('#aPass2Wrap').classList.toggle('hidden', state.configured);
    $('#authBtn').textContent = state.configured ? 'Entra' : 'Salva e entra';
    $('#aPass').autocomplete = state.configured ? 'current-password' : 'new-password';
  }

  async function enter() {
    $('#authView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    try {
      const [u, r] = await Promise.all([api('/api/admin/users'), api('/api/admin/referrals')]);
      state.users = u.users;
      state.refs = r.referrals;
      render();
    } catch (e) { toast(e.message, true); }
  }

  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#aPass').value;
    if (!state.configured && pw !== $('#aPass2').value) return toast('Le password non coincidono', true);
    try {
      await api(state.configured ? '/api/admin/login' : '/api/admin/setup', { password: pw });
      $('#aPass').value = '';
      $('#aPass2').value = '';
      state.configured = true;
      await enter();
    } catch (err) { toast(err.message, true); }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', {}); } catch { /* già uscito */ }
    showAuth(true);
  });

  $('#pwBtn').addEventListener('click', () => { $('#pwModal').classList.add('open'); });
  $('#pwCancel').addEventListener('click', () => $('#pwModal').classList.remove('open'));
  $('#pwModal').addEventListener('click', (e) => { if (e.target.id === 'pwModal') $('#pwModal').classList.remove('open'); });
  $('#pwSave').addEventListener('click', async () => {
    if ($('#pNew').value !== $('#pNew2').value) return toast('Le nuove password non coincidono', true);
    try {
      await api('/api/admin/password', { currentPassword: $('#pCur').value, newPassword: $('#pNew').value });
      ['#pCur', '#pNew', '#pNew2'].forEach((id) => { $(id).value = ''; });
      $('#pwModal').classList.remove('open');
      toast('Password cambiata');
    } catch (e) { toast(e.message, true); }
  });

  // ---------- avvio ----------
  (async () => {
    setTab('users');
    try {
      const st = await api('/api/admin/status');
      if (st.authed) await enter(); else showAuth(st.configured);
    } catch (e) { toast(e.message, true); }
  })();
})();
