(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const fmt = (d) => (d ? d.split('-').reverse().join('/') : '—');
  const CIRC = 2 * Math.PI * 52;
  const LABEL = { pending: 'In attesa', interested: 'Interessato', not_interested: 'Non interessato', closed: 'Chiuso' };
  const stage = [];

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
    if (!res.ok || data.success === false) throw new Error(data.message || 'Errore');
    return data;
  }

  // ---------- piano ----------
  function renderPlan(p) {
    const days = p.renewalDate ? Math.round((Date.parse(p.renewalDate) - Date.parse(TODAY)) / 864e5) : null;
    const left = days === null ? '' : days > 0 ? `tra ${days} ${days === 1 ? 'giorno' : 'giorni'}` : days === 0 ? 'oggi' : `scaduto da ${-days} ${-days === 1 ? 'giorno' : 'giorni'}`;
    const pay = p.paid ? ['paid', 'Pagato'] : days !== null && days < 0 ? ['late', 'Scaduto'] : ['due', 'Da pagare'];
    $('#plan').innerHTML = `
      <div class="r"><span>Iscritto dal</span><span>${fmt(p.createdAt)}</span></div>
      <div class="r"><span>Prossimo rinnovo</span><span>${fmt(p.renewalDate)}${left ? `<br><small class="muted">${left}</small>` : ''}</span></div>
      <div class="r"><span>Pagamento</span><span class="gx-tag ${pay[0]}">${pay[1]}</span></div>`;
  }

  // ---------- sconto ----------
  function renderDiscount(d) {
    $('#ringFg').setAttribute('stroke-dasharray', `${(CIRC * d.percent) / 100} ${CIRC}`);
    $('#pct').textContent = `${d.percent}%`;
    $('#months').textContent = d.months > 0 ? `${d.months} ${d.months === 1 ? 'mese' : 'mesi'} di sconto` : 'Nessuno sconto per ora';
    $('#discountNote').textContent = `${d.closed} ${d.closed === 1 ? 'contatto diventato cliente' : 'contatti diventati clienti'} · 25% ciascuno, fino al 100%`;
  }

  // ---------- referenze ----------
  function renderRefs(list) {
    $('#refList').innerHTML = list.map((r) => `
      <div class="gx-card st-${r.status}">
        <div class="gx-info"><b>${esc(r.name)}</b><small>${esc(r.phone)} · ${fmt((r.createdAt || '').slice(0, 10))}</small></div>
        <span class="gx-tag ${r.status}">${LABEL[r.status] || r.status}</span>
      </div>`).join('') || '<p class="muted">Non hai ancora inviato nessuna referenza.</p>';
  }

  async function load() {
    try {
      const d = await api('/api/sconti');
      renderPlan(d.plan);
      renderDiscount(d.discount);
      renderRefs(d.referrals);
    } catch (e) { toast(e.message, true); }
  }

  // ---------- popup aggiunta ----------
  function renderStage() {
    $('#stage').innerHTML = stage.map((c, i) =>
      `<span class="chip">${esc(c.name || c.phone)} <small>${esc(c.phone)}</small><button class="gx-x" data-rm="${i}" type="button" aria-label="Rimuovi">✕</button></span>`).join('');
    $('#sendBtn').disabled = !stage.length;
    $('#sendBtn').textContent = stage.length ? `Invia (${stage.length})` : 'Invia';
  }

  function addStage(name, phone) {
    phone = String(phone || '').trim();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return false;
    if (stage.some((c) => c.phone.replace(/\D/g, '').slice(-9) === digits.slice(-9))) return true;
    stage.push({ name: String(name || '').trim().slice(0, 60), phone });
    return true;
  }

  function openAdd() { $('#addModal').classList.add('open'); document.body.classList.add('noscroll'); }
  function closeAdd() { $('#addModal').classList.remove('open'); document.body.classList.remove('noscroll'); }

  $('#addBtn').addEventListener('click', openAdd);
  $('#addCancel').addEventListener('click', closeAdd);
  $('#addModal').addEventListener('click', (e) => { if (e.target.id === 'addModal') closeAdd(); });

  // Selettore contatti nativo (Android/Chrome). Dove non esiste resta l'inserimento manuale.
  if (navigator.contacts && window.ContactsManager) {
    $('#pickBtn').classList.remove('hidden');
    $('#pickBtn').addEventListener('click', async () => {
      try {
        const sel = await navigator.contacts.select(['name', 'tel'], { multiple: true });
        sel.forEach((c) => addStage(c.name && c.name[0], c.tel && c.tel[0]));
        renderStage();
      } catch { /* annullato dall'utente */ }
    });
  }

  $('#manualAdd').addEventListener('click', () => {
    if (!addStage($('#cName').value, $('#cPhone').value)) return toast('Inserisci un numero di telefono valido', true);
    $('#cName').value = '';
    $('#cPhone').value = '';
    renderStage();
  });

  $('#stage').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { stage.splice(Number(b.dataset.rm), 1); renderStage(); }
  });

  $('#sendBtn').addEventListener('click', async () => {
    const btn = $('#sendBtn');
    btn.disabled = true;
    try {
      const r = await api('/api/referrals', { contacts: stage });
      toast(r.added
        ? `${r.added} ${r.added === 1 ? 'contatto aggiunto' : 'contatti aggiunti'}${r.skipped ? ` (${r.skipped} già presenti)` : ''}`
        : 'Questi contatti erano già presenti');
      stage.length = 0;
      renderStage();
      closeAdd();
      load();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  });

  renderStage();
  load();
})();
