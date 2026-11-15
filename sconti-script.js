(() => {
  'use strict';

  // Per attivare "Google Contatti" (People API) inserisci qui l'OAuth Client ID
  // creato su Google Cloud Console (tipo "Web", con l'origine del sito autorizzata).
  // Se resta vuoto, il pulsante non compare.
  const GOOGLE_CLIENT_ID = '';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const fmt = (d) => (d ? d.split('-').reverse().join('/') : '—');
  const CIRC = 2 * Math.PI * 52;
  const LABEL = { pending: 'In attesa', interested: 'Interessato', not_interested: 'Non interessato', closed: 'Cliente' };
  const EDITABLE = ['pending'];
  const ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const ICON_DEL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

  const stage = [];
  let refs = [];
  let editId = null;
  let delId = null;
  let googleContacts = [];
  const googlePicked = new Set();

  // ---------- utilità ----------
  let toastTimer;
  function toast(msg, isError) {
    const n = $('#note');
    n.textContent = msg;
    n.classList.toggle('error', !!isError);
    n.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => n.classList.remove('show'), 2800);
  }

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = '/login.html'; throw new Error('Sessione scaduta'); }
    if (!res.ok || data.success === false) throw new Error(data.message || 'Errore, riprova');
    return data;
  }

  const openModal = (id) => { $(id).classList.add('open'); document.body.classList.add('noscroll'); };
  const closeModal = (id) => {
    $(id).classList.remove('open');
    if (!document.querySelector('.sc-overlay.open')) document.body.classList.remove('noscroll');
  };

  const digitsOf = (p) => String(p || '').replace(/\D/g, '');
  const cleanPhone = (p) => { const t = String(p || '').trim(); return (t.startsWith('+') ? '+' : '') + digitsOf(t); };
  const validPhone = (p) => { const n = digitsOf(p).length; return n >= 6 && n <= 15; };
  const sameNumber = (a, b) => digitsOf(a).slice(-9) === digitsOf(b).slice(-9);

  // ---------- sconto ----------
  function renderDiscount(d) {
    $('#ringFg').setAttribute('stroke-dasharray', `${(CIRC * d.percent) / 100} ${CIRC}`);
    $('#pct').textContent = `${d.percent}%`;
    $('#months').textContent = d.months > 0 ? `${d.months} ${d.months === 1 ? 'mese gratis' : 'mesi gratis'}` : 'Nessuno sconto';
    const steps = document.querySelectorAll('#steps i');
    steps.forEach((el, i) => el.classList.toggle('on', i < d.closed));
    $('#discountNote').textContent = d.closed >= 4
      ? 'Sconto massimo raggiunto.'
      : `${d.closed} di 4 referenze diventate clienti. Ognuna vale il 25% di sconto.`;
  }

  // ---------- referenze ----------
  function renderRefs() {
    const total = refs.length;
    const clients = refs.filter((r) => r.status === 'closed').length;
    $('#refSummary').textContent = total ? `${total} ${total === 1 ? 'referenza' : 'referenze'} · ${clients} ${clients === 1 ? 'cliente' : 'clienti'}` : '';

    if (!total) {
      $('#refList').innerHTML = `
        <div class="sc-empty">
          <p>Nessuna referenza.<br>Aggiungi un contatto: se diventa cliente ottieni il 25% di sconto.</p>
          <button class="sc-btn sc-primary sc-sm" type="button" data-open-add>Aggiungi referenza</button>
        </div>`;
      return;
    }

    $('#refList').innerHTML = refs.map((r) => {
      const tools = EDITABLE.includes(r.status) ? `
        <div class="sc-tools">
          <button class="sc-icon" type="button" data-edit="${esc(r.id)}" aria-label="Modifica ${esc(r.name)}">${ICON_EDIT}</button>
          <button class="sc-icon del" type="button" data-del="${esc(r.id)}" aria-label="Elimina ${esc(r.name)}">${ICON_DEL}</button>
        </div>` : '';
      return `
        <div class="sc-card sc-st-${esc(r.status)}">
          <div class="sc-info"><b>${esc(r.name || r.phone)}</b><small>${esc(r.phone)} · ${fmt((r.createdAt || '').slice(0, 10))}</small></div>
          <span class="sc-tag ${esc(r.status)}">${LABEL[r.status] || esc(r.status)}</span>
          ${tools}
        </div>`;
    }).join('');
  }

  // ---------- piano ----------
  function renderPlan(p) {
    const days = p.renewalDate ? Math.round((Date.parse(p.renewalDate) - Date.parse(TODAY)) / 864e5) : null;
    const left = days === null ? '' : days > 0 ? `tra ${days} ${days === 1 ? 'giorno' : 'giorni'}` : days === 0 ? 'oggi' : `scaduto da ${-days} ${-days === 1 ? 'giorno' : 'giorni'}`;
    const pay = p.paid ? ['paid', 'Pagato'] : days !== null && days < 0 ? ['late', 'Scaduto'] : ['due', 'Da pagare'];
    $('#plan').innerHTML = `
      <div class="r"><span>Iscritto dal</span><span>${fmt(p.createdAt)}</span></div>
      <div class="r"><span>Rinnovo</span><span>${fmt(p.renewalDate)}${left ? `<small>${left}</small>` : ''}</span></div>
      <div class="r"><span>Pagamento</span><span class="sc-tag ${pay[0]}">${pay[1]}</span></div>`;
  }

  function renderError() {
    const box = `<div class="sc-empty"><p>Impossibile caricare i dati.</p><button class="sc-btn sc-ghost sc-sm" type="button" data-retry>Riprova</button></div>`;
    $('#plan').innerHTML = box;
    if (!refs.length) $('#refList').innerHTML = box;
  }

  async function load() {
    try {
      const d = await api('/api/sconti');
      refs = d.referrals || [];
      renderDiscount(d.discount);
      renderRefs();
      renderPlan(d.plan);
    } catch (e) {
      renderError();
      toast(e.message, true);
    }
  }

  // ---------- popup aggiunta ----------
  function renderStage() {
    $('#stage').innerHTML = stage.map((c, i) =>
      `<span class="sc-chip">${esc(c.name || c.phone)} <small>${c.name ? esc(c.phone) : ''}</small><button class="sc-x" data-rm="${i}" type="button" aria-label="Rimuovi">✕</button></span>`).join('');
    $('#sendBtn').disabled = !stage.length;
    $('#sendBtn').textContent = stage.length ? `Invia (${stage.length})` : 'Invia';
  }

  // true = numero valido (aggiunto o già in lista); false = numero non valido
  function addStage(name, phone) {
    if (!validPhone(phone)) return false;
    const exists = stage.some((c) => sameNumber(c.phone, phone)) || refs.some((r) => sameNumber(r.phone, phone));
    if (!exists) stage.push({ name: String(name || '').trim().slice(0, 60), phone: cleanPhone(phone) });
    return true;
  }

  function addMany(list) {
    let skipped = 0;
    list.forEach((c) => { if (!addStage(c.name, c.phone)) skipped++; });
    renderStage();
    if (skipped) toast(`${skipped} ${skipped === 1 ? 'contatto' : 'contatti'} senza numero valido`, true);
  }

  function openAdd() { openModal('#addModal'); }
  function closeAdd() { closeModal('#addModal'); }

  $('#addBtn').addEventListener('click', openAdd);
  $('#addCancel').addEventListener('click', closeAdd);

  // Rubrica del telefono: Contact Picker API (Android, Chrome, HTTPS)
  if ('contacts' in navigator && 'ContactsManager' in window) {
    $('#pickBtn').classList.remove('hidden');
    $('#pickBtn').addEventListener('click', async () => {
      try {
        const sel = await navigator.contacts.select(['name', 'tel'], { multiple: true });
        addMany(sel.map((c) => ({ name: c.name && c.name[0], phone: c.tel && c.tel[0] })));
      } catch { /* annullato */ }
    });
  } else if (!GOOGLE_CLIENT_ID) {
    $('#noPickerHint').classList.remove('hidden');
  }

  // Google Contatti: People API con OAuth (funziona anche su iPhone e desktop)
  if (GOOGLE_CLIENT_ID) {
    $('#googleBtn').classList.remove('hidden');
    $('#googleBtn').addEventListener('click', openGoogle);
  }

  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Google non raggiungibile'));
      document.head.appendChild(s);
    });
  }

  async function openGoogle() {
    const btn = $('#googleBtn');
    btn.disabled = true;
    try {
      await loadGis();
      const token = await new Promise((resolve, reject) => {
        google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/contacts.readonly',
          callback: (r) => (r.error ? reject(new Error('Accesso Google annullato')) : resolve(r.access_token)),
          error_callback: () => reject(new Error('Accesso Google annullato')),
        }).requestAccessToken();
      });
      const res = await fetch('https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers&pageSize=1000&sortOrder=FIRST_NAME_ASCENDING', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Impossibile leggere i contatti Google');
      const data = await res.json();
      googleContacts = (data.connections || [])
        .map((p) => ({ name: (p.names && p.names[0] && p.names[0].displayName) || '', phone: p.phoneNumbers && p.phoneNumbers[0] && p.phoneNumbers[0].value }))
        .filter((c) => c.phone && validPhone(c.phone));
      googlePicked.clear();
      $('#gSearch').value = '';
      renderGoogle();
      openModal('#gModal');
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function renderGoogle() {
    const q = $('#gSearch').value.trim().toLowerCase();
    const rows = googleContacts
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !q || c.name.toLowerCase().includes(q) || digitsOf(c.phone).includes(digitsOf(q) || '\u0000'));
    $('#gList').innerHTML = rows.length
      ? rows.map(({ c, i }) => `
          <label><input type="checkbox" data-g="${i}" ${googlePicked.has(i) ? 'checked' : ''}>
            <span><b>${esc(c.name || c.phone)}</b>${c.name ? `<small>${esc(c.phone)}</small>` : ''}</span>
          </label>`).join('')
      : '<div class="sc-empty"><p>Nessun contatto trovato.</p></div>';
    $('#gConfirm').disabled = !googlePicked.size;
    $('#gConfirm').textContent = googlePicked.size ? `Aggiungi (${googlePicked.size})` : 'Aggiungi';
  }

  $('#gSearch').addEventListener('input', renderGoogle);
  $('#gList').addEventListener('change', (e) => {
    const i = e.target.dataset.g;
    if (i === undefined) return;
    e.target.checked ? googlePicked.add(Number(i)) : googlePicked.delete(Number(i));
    $('#gConfirm').disabled = !googlePicked.size;
    $('#gConfirm').textContent = googlePicked.size ? `Aggiungi (${googlePicked.size})` : 'Aggiungi';
  });
  $('#gCancel').addEventListener('click', () => closeModal('#gModal'));
  $('#gConfirm').addEventListener('click', () => {
    addMany([...googlePicked].map((i) => googleContacts[i]));
    closeModal('#gModal');
  });

  // Inserimento manuale
  function manualAdd() {
    if (!addStage($('#cName').value, $('#cPhone').value)) return toast('Numero di telefono non valido', true);
    $('#cName').value = '';
    $('#cPhone').value = '';
    renderStage();
    $('#cName').focus();
  }
  $('#manualAdd').addEventListener('click', manualAdd);
  ['#cName', '#cPhone'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); manualAdd(); } }));

  $('#stage').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { stage.splice(Number(b.dataset.rm), 1); renderStage(); }
  });

  $('#sendBtn').addEventListener('click', async () => {
    const btn = $('#sendBtn');
    // Se l'utente ha scritto un contatto senza premere "Aggiungi alla lista", lo includiamo
    if ($('#cPhone').value.trim() && addStage($('#cName').value, $('#cPhone').value)) {
      $('#cName').value = ''; $('#cPhone').value = ''; renderStage();
    }
    if (!stage.length) return;
    btn.disabled = true;
    try {
      const r = await api('/api/referrals', { contacts: stage });
      toast(r.added
        ? `${r.added} ${r.added === 1 ? 'contatto aggiunto' : 'contatti aggiunti'}${r.skipped ? ` · ${r.skipped} già presenti` : ''}`
        : 'Contatti già presenti');
      stage.length = 0;
      renderStage();
      closeAdd();
      load();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  });

  // ---------- gestione referenze (modifica / elimina) ----------
  $('#refList').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-add]')) return openAdd();
    if (e.target.closest('[data-retry]')) return load();

    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const r = refs.find((x) => String(x.id) === ed.dataset.edit);
      if (!r) return;
      editId = r.id;
      $('#eName').value = r.name || '';
      $('#ePhone').value = r.phone || '';
      openModal('#editModal');
      return;
    }

    const dl = e.target.closest('[data-del]');
    if (dl) {
      const r = refs.find((x) => String(x.id) === dl.dataset.del);
      if (!r) return;
      delId = r.id;
      $('#delText').textContent = `${r.name || r.phone} verrà rimosso dalle tue referenze.`;
      openModal('#delModal');
    }
  });

  $('#plan').addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) load(); });

  $('#editCancel').addEventListener('click', () => closeModal('#editModal'));
  $('#editSave').addEventListener('click', async () => {
    const phone = $('#ePhone').value;
    if (!validPhone(phone)) return toast('Numero di telefono non valido', true);
    if (refs.some((r) => r.id !== editId && sameNumber(r.phone, phone))) return toast('Numero già presente', true);
    const btn = $('#editSave');
    btn.disabled = true;
    try {
      await api('/api/referrals/update', { id: editId, name: $('#eName').value.trim().slice(0, 60), phone: cleanPhone(phone) });
      toast('Referenza aggiornata');
      closeModal('#editModal');
      load();
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  });

  $('#delCancel').addEventListener('click', () => closeModal('#delModal'));
  $('#delConfirm').addEventListener('click', async () => {
    const btn = $('#delConfirm');
    btn.disabled = true;
    try {
      await api('/api/referrals/delete', { id: delId });
      toast('Referenza eliminata');
      closeModal('#delModal');
      load();
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  });

  // ---------- chiusura popup ----------
  document.querySelectorAll('.sc-overlay').forEach((o) =>
    o.addEventListener('click', (e) => { if (e.target === o) closeModal('#' + o.id); }));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.sc-overlay.open')].pop();
    if (open) closeModal('#' + open.id);
  });

  // Indietro: pagina precedente del sito, altrimenti il profilo
  $('#back-btn').addEventListener('click', () => {
    if (history.length > 1 && document.referrer.startsWith(location.origin)) history.back();
    else location.href = '/profile';
  });

  renderStage();
  load();
})();
