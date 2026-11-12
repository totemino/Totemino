/**
 * TOTEMINO - Worker Cloudflare (sostituisce server.js)
 *
 * Cloudflare Pages "advanced mode": questo file è l'unico backend.
 * Binding richiesti (Pages > Settings > Bindings / Variables and Secrets):
 *   - BUCKET          -> bucket R2 (binding R2)
 *   - SESSION_SECRET  -> secret, stringa casuale lunga (firma i cookie di sessione)
 * ASSETS è fornito automaticamente da Pages (i file statici del sito).
 *
 * Dove stanno i dati:
 *   R2  IDs/<id>/menu.json, settings.json, menuTypes.json, customizations.json,
 *       banners.json, promo.json, img/<file>, menu-backups/menu_<data>.json
 *   R2  userdata/users.json
 *   R2  Richieste/<data>_<id>.json  (richieste di informazioni dal modulo in login.html)
 * Se un file dati non è ancora in R2 viene restituito il valore di default;
 * solo l'elenco utenti ha un seed opzionale nel sito (userdata/users.json).
 *
 * Non esistono piani/abbonamenti: ogni utente registrato ha le stesse funzioni.
 * Unica eccezione, solo lato backend: il flag opzionale "pro": true in users.json
 * (vedi isPro), mai esposto al client.
 */

const SESSION_COOKIE = 'tm_session';
// Sessione "permanente": 365 giorni (i browser accettano al massimo 400 per un cookie).
// Viene rinnovata a ogni visita (handleMe), quindi scade solo dopo 365 giorni di inattività.
const SESSION_MAX_AGE = 365 * 24 * 60 * 60;
const USERS_KEY = 'userdata/users.json';
const MAX_BACKUPS = 3;
const REQUESTS_PREFIX = 'Richieste/';
const REQUEST_COOLDOWN_MS = 60 * 1000; // una richiesta al minuto per IP
const MAX_REQUEST_BYTES = 10 * 1024;
const VENUE_TYPES = ['ristorante', 'pizzeria', 'bar', 'pub', 'lido', 'altro'];
const TABLE_RANGES = ['1-10', '11-25', '26-50', '50+'];
const INTERESTS = ['menu-digitale', 'ordini-tavolo', 'statistiche', 'multilingua'];
const CURRENT_SYSTEMS = ['carta', 'qr', 'gestionale', 'altro'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMG_GRACE_MS = 2 * 60 * 60 * 1000; // foto appena caricate non vengono toccate per 2 ore
const REF_FILES = ['menu.json', 'banners.json', 'promo.json', 'customizations.json', 'settings.json', 'menuTypes.json'];
const PBKDF2_ITERATIONS = 100000; // massimo consentito da Workers

// Pagine di gestione: senza sessione valida il server non invia l'HTML (302 a login).
// Devono comparire anche in _routes.json, altrimenti il worker non viene invocato.
const PROTECTED_PAGES = new Set(['/profile', '/gestione-menu', '/sconti', '/settings','/create-banners']);

const ID_RE = /^[\w-]{1,20}$/;
const DEFAULT_MENU_TYPES = {
  menuTypes: [{
    id: 'default',
    name: 'Menu Intero',
    copertoPrice: 0,
    checkoutMethods: { table: true, delivery: true, takeaway: true, show: true },
    visibility: true,
    icon: 1
  }]
};
const JSON_FILES = {
  'menu.json': { categories: [] },
  'settings.json': {},
  'menuTypes.json': DEFAULT_MENU_TYPES,
  'customizations.json': {},
  'custom-favorites.json': [],
  'banners.json': [],
  'promo.json': []
};
const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
};

// ==================== UTILITY ====================
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

const fail = (status, message) => json({ success: false, message }, status);

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ==================== SESSIONE (cookie firmato, senza stato) ====================
async function hmacKey(env, usage) {
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

async function signSession(env, userCode) {
  const payload = b64urlEncode(enc.encode(JSON.stringify({
    u: userCode,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE
  })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env, ['sign']), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

async function readSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;

  const [payload, sig] = match[1].split('.');
  if (!payload || !sig) return null;

  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env, ['verify']), b64urlDecode(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (!data.u || data.exp < Math.floor(Date.now() / 1000)) return null;
    return { userCode: data.u, restaurantId: data.u };
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ==================== PASSWORD (PBKDF2 via WebCrypto) ====================
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false; // vecchi hash bcrypt non verificabili qui
  const calc = await pbkdf2(password, b64urlDecode(salt), parseInt(iter, 10));
  const expected = b64urlDecode(hash);
  if (calc.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc[i] ^ expected[i];
  return diff === 0;
}

// ==================== UTENTI (R2) ====================
async function loadSeedUsers(env, request) {
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/userdata/users.json', request.url)));
    if (res.ok) return await res.json();
  } catch { /* nessun seed */ }
  return {};
}

async function loadUsers(env, request) {
  const obj = await env.BUCKET.get(USERS_KEY);
  if (obj) return obj.json();
  return loadSeedUsers(env, request);
}

// Modifica gli utenti con controllo di concorrenza (etag) e qualche tentativo
async function mutateUsers(env, request, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const obj = await env.BUCKET.get(USERS_KEY);
    const users = obj ? await obj.json() : await loadSeedUsers(env, request);
    const { changed, result } = await fn(users);
    if (!changed) return result;

    const options = { httpMetadata: { contentType: 'application/json' } };
    if (obj) options.onlyIf = { etagMatches: obj.etag };
    const put = await env.BUCKET.put(USERS_KEY, JSON.stringify(users, null, 2), options);
    if (put) return result;
  }
  throw new Error('Conflitto di scrittura utenti');
}

// Flag personale/interno: si imposta a mano su R2 (userdata/users.json -> "pro": true).
// Non è un piano e non viene mai inviato al client.
const isPro = (user) => user?.pro === true;

// ==================== ROTTE AUTH ====================
async function handleLogin(request, env) {
  const body = await readBody(request);
  const { userCode, password } = body || {};
  if (!userCode || !password) return fail(400, 'ID utente e password richiesti');

  const users = await loadUsers(env, request);
  const user = users[userCode];
  if (!user || !(await verifyPassword(password, user.password))) {
    return fail(401, 'Credenziali non valide');
  }

  return json(
    {
      success: true,
      message: 'Login effettuato con successo',
      user: { userCode, restaurantId: userCode }
    },
    200,
    { 'Set-Cookie': sessionCookie(await signSession(env, userCode)) }
  );
}

async function handleRegister(request, env) {
  const body = await readBody(request);
  const { userCode, password } = body || {};
  if (!userCode || !password) return fail(400, 'ID utente e password richiesti');
  if (!/^\d{4}$/.test(userCode)) return fail(400, 'ID deve essere di 4 cifre numeriche');
  if (password.length < 8 || !/\d/.test(password)) {
    return fail(400, 'Password deve avere almeno 8 caratteri e almeno un numero');
  }

  const hashed = await hashPassword(password);

  const exists = await mutateUsers(env, request, async (users) => {
    if (users[userCode]) return { changed: false, result: true };
    users[userCode] = {
      password: hashed,
      createdAt: new Date().toISOString()
    };
    return { changed: true, result: false };
  });

  if (exists) return fail(409, 'ID utente già esistente');

  return json({
    success: true,
    message: 'Registrazione completata con successo',
    user: { userCode, restaurantId: userCode }
  });
}

// ==================== RICHIESTE DI INFORMAZIONI ====================
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handleInfoRequest(request, env) {
  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BYTES) return fail(413, 'Richiesta troppo grande');

  let body;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (!body || typeof body !== 'object') return fail(400, 'Richiesta non valida');

  const data = {
    restaurantName: clean(body.restaurantName, 80),
    contactName: clean(body.contactName, 80),
    contactEmail: clean(body.contactEmail, 120),
    contactPhone: clean(body.contactPhone, 20),
    city: clean(body.city, 60),
    venueType: clean(body.venueType, 20),
    tables: clean(body.tables, 10),
    interests: (Array.isArray(body.interests) ? body.interests : [])
      .map((i) => clean(i, 30)).filter((i) => INTERESTS.includes(i)),
    currentSystem: clean(body.currentSystem, 20),
    notes: clean(body.notes, 500)
  };

  if (!data.restaurantName) return fail(400, 'Inserisci il nome del locale');
  if (!data.contactName) return fail(400, 'Inserisci il tuo nome');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.contactEmail)) return fail(400, 'Inserisci un indirizzo email valido');
  if (!VENUE_TYPES.includes(data.venueType)) return fail(400, 'Seleziona il tipo di locale');
  if (!TABLE_RANGES.includes(data.tables)) return fail(400, 'Indica quanti tavoli ha il tuo locale');
  if (data.currentSystem && !CURRENT_SYSTEMS.includes(data.currentSystem)) data.currentSystem = '';
  if (body.privacyConsent !== true) return fail(400, 'Devi acconsentire al trattamento dei dati');

  // Limite per IP: un marcatore in R2 (hash dell'IP, nessun IP in chiaro)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = `${REQUESTS_PREFIX}_rate/${(await sha256Hex(ip)).slice(0, 32)}`;
  const last = await env.BUCKET.head(rateKey);
  if (last && Date.now() - last.uploaded.getTime() < REQUEST_COOLDOWN_MS) {
    return fail(429, 'Hai già inviato una richiesta da poco. Riprova tra un minuto.');
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
  const id = b64urlEncode(crypto.getRandomValues(new Uint8Array(6)));

  await putJSON(env, `${REQUESTS_PREFIX}${stamp}_${id}.json`, {
    ...data,
    privacyConsent: true,
    receivedAt: now.toISOString()
  });
  await env.BUCKET.put(rateKey, '1');

  return json({ success: true, message: 'Richiesta inviata' });
}

async function handleChangePassword(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ success: false, requireLogin: true, message: 'Autenticazione richiesta' }, 401);

  const body = await readBody(request);
  const { currentPassword, newPassword } = body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return fail(400, 'Password attuale e nuova password richieste');
  }
  if (newPassword.length < 8 || !/\d/.test(newPassword)) {
    return fail(400, 'La nuova password deve avere almeno 8 caratteri e un numero');
  }
  if (newPassword.length > 200) return fail(400, 'Password troppo lunga');

  const users = await loadUsers(env, request);
  const user = users[session.userCode];
  if (!user) return json({ success: false, requireLogin: true, message: 'Utente non trovato' }, 401);

  if (!(await verifyPassword(currentPassword, user.password))) {
    return fail(403, 'La password attuale non è corretta');
  }

  const hashed = await hashPassword(newPassword);
  const updated = await mutateUsers(env, request, async (all) => {
    if (!all[session.userCode]) return { changed: false, result: false };
    all[session.userCode].password = hashed;
    all[session.userCode].passwordChangedAt = new Date().toISOString();
    return { changed: true, result: true };
  });
  if (!updated) return fail(404, 'Utente non trovato');

  return json({ success: true, message: 'Password cambiata con successo' });
}

async function handleMe(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ success: false, requireLogin: true });

  const users = await loadUsers(env, request);
  const fresh = users[session.userCode];
  if (!fresh) return json({ success: false, requireLogin: true });

  return json(
    {
      success: true,
      user: { userCode: session.userCode, restaurantId: session.restaurantId }
    },
    200,
    { 'Set-Cookie': sessionCookie(await signSession(env, session.userCode)) } // sessione "rolling"
  );
}

function handleLogout() {
  return json({ success: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// ==================== LETTURA DATI ====================
// ---------- Durata dei banner ----------
// banner.duration: { type:'forever' } | { type:'days', days, until:'YYYY-MM-DD' } | { type:'range', from, to }
// Un banner senza "duration" (vecchi banner) resta per sempre.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROME_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayRome = () => ROME_DATE.format(new Date()); // "YYYY-MM-DD"

function bannerEnd(b) {
  const d = b && b.duration;
  if (!d) return null;
  const e = d.type === 'days' ? d.until : d.type === 'range' ? d.to : null;
  return DATE_RE.test(e || '') ? e : null;
}
const bannerStart = (b) => (b && b.duration && b.duration.type === 'range' && DATE_RE.test(b.duration.from || '') ? b.duration.from : null);

// Tiene solo i campi di durata validi; il resto diventa "per sempre"
function sanitizeBanner(b) {
  if (!b || typeof b !== 'object') return b;
  const d = b.duration;
  let clean = { type: 'forever' };
  if (d && d.type === 'days' && Number.isInteger(d.days) && d.days >= 1 && d.days <= 365 && DATE_RE.test(d.until || '')) {
    clean = { type: 'days', days: d.days, until: d.until };
  } else if (d && d.type === 'range' && DATE_RE.test(d.from || '') && DATE_RE.test(d.to || '') && d.to >= d.from) {
    clean = { type: 'range', from: d.from, to: d.to };
  }
  return { ...b, duration: clean };
}

// Legge banners.json, ELIMINA i banner scaduti (riscrivendo il file) e nasconde
// ai clienti quelli programmati che non sono ancora iniziati (il proprietario li vede tutti).
async function serveBanners(request, env, restaurantId) {
  const key = `IDs/${restaurantId}/banners.json`;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const r2 = await env.BUCKET.get(key);
  if (!r2) return request.method === 'HEAD' ? new Response(null, { headers }) : json([]);

  let list;
  try { list = JSON.parse(await r2.text()); } catch { list = []; }
  if (!Array.isArray(list)) list = [];

  const today = todayRome();
  const alive = list.filter((b) => { const e = bannerEnd(b); return !e || today <= e; });
  if (alive.length !== list.length && request.method === 'GET') {
    try { await putJSON(env, key, alive); } catch (e) { console.error('purge banner:', e); }
  }

  const session = await readSession(request, env);
  const isOwner = !!session && session.restaurantId === restaurantId;
  const visible = isOwner ? alive : alive.filter((b) => { const s = bannerStart(b); return !s || today >= s; });

  return request.method === 'HEAD' ? new Response(null, { headers }) : json(visible);
}

async function serveData(request, env, restaurantId, file) {
  if (file === 'banners.json') return await serveBanners(request, env, restaurantId);
  const r2 = await env.BUCKET.get(`IDs/${restaurantId}/${file}`);
  if (r2) {
    return new Response(request.method === 'HEAD' ? null : r2.body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  // Non ancora salvato: valore di default (MAI passare da ASSETS: senza 404.html
  // Pages risponde 200 con index.html e il client prova a parsarlo come JSON)
  return json(JSON_FILES[file], 200);
}

async function serveImage(request, env, restaurantId, file) {
  const r2 = await env.BUCKET.get(`IDs/${restaurantId}/img/${file}`);
  if (r2) {
    return new Response(r2.body, {
      headers: {
        'Content-Type': r2.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
  return new Response('Not found', { status: 404 });
}

// ==================== SALVATAGGIO DATI ====================
async function putJSON(env, key, data) {
  await env.BUCKET.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });
}

// Nomi dei file immagine citati in un testo JSON ("/IDs/x/img/nome.webp", "img/nome.webp")
function imageNames(text) {
  const names = new Set();
  for (const m of String(text || '').matchAll(/(?:^|["\/])img\/([^"\\/?#]+)"/g)) {
    try { names.add(decodeURIComponent(m[1])); } catch { names.add(m[1]); }
  }
  return names;
}

// Cancella da R2 le immagini non più referenziate:
//  - subito: quelle che stavano nel file appena sostituito (previousText) e ora non ci sono più
//    (foto sostituita, rimossa, elemento o categoria eliminati)
//  - con margine (IMG_GRACE_MS): quelle orfane mai referenziate (upload abbandonati)
async function cleanupImages(env, restaurantId, previousText = '') {
  try {
    const prefix = `IDs/${restaurantId}/img/`;
    let haystack = '';
    for (const f of REF_FILES) {
      const o = await env.BUCKET.get(`IDs/${restaurantId}/${f}`);
      if (o) haystack += await o.text();
    }
    const isUsed = (name) => haystack.includes(`/${name}"`) || haystack.includes(`"${name}"`);

    const toDelete = new Set();

    for (const name of imageNames(previousText)) {
      if (!isUsed(name)) toDelete.add(prefix + name);
    }

    let cursor;
    do {
      const page = await env.BUCKET.list({ prefix, cursor });
      for (const o of page.objects) {
        const name = o.key.slice(prefix.length);
        const oldEnough = Date.now() - o.uploaded.getTime() > IMG_GRACE_MS;
        if (oldEnough && !isUsed(name)) toDelete.add(o.key);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const keys = [...toDelete];
    for (let i = 0; i < keys.length; i += 1000) {
      await env.BUCKET.delete(keys.slice(i, i + 1000));
    }
  } catch (e) {
    console.error('cleanupImages:', e); // la pulizia non deve mai far fallire il salvataggio
  }
}

async function saveMenu(env, restaurantId, menuContent) {
  const key = `IDs/${restaurantId}/menu.json`;
  const current = await env.BUCKET.get(key);
  const previousText = current ? await current.text() : '';

  if (current) {
    const prefix = `IDs/${restaurantId}/menu-backups/`;
    const listed = await env.BUCKET.list({ prefix });
    const backups = listed.objects
      .filter((o) => /menu_.*\.json$/.test(o.key))
      .sort((a, b) => (a.key < b.key ? 1 : -1)); // più recenti per primi

    if (backups.length >= MAX_BACKUPS) {
      await env.BUCKET.delete(backups.slice(MAX_BACKUPS - 1).map((o) => o.key));
    }

    const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    await env.BUCKET.put(`${prefix}menu_${timestamp}.json`, previousText, {
      httpMetadata: { contentType: 'application/json' }
    });
  }

  await putJSON(env, key, menuContent);
  await cleanupImages(env, restaurantId, previousText);
  return { success: true, backupCreated: !!current };
}

async function uploadImage(env, session, body) {
  const { fileName, fileData, restaurantId } = body || {};

  if (!fileName || !fileData || !restaurantId) return fail(400, 'Dati mancanti');
  if (session.restaurantId !== restaurantId || !ID_RE.test(restaurantId)) {
    return fail(403, 'Accesso non autorizzato');
  }

  const parts = String(fileName).split('.');
  const extension = (parts.length > 1 ? parts.pop() : '').toLowerCase();
  if (!IMAGE_TYPES[extension]) return fail(400, 'Formato immagine non supportato');
  const baseName = parts.join('.').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'img';

  const b64 = String(fileData).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (b64.length * 0.75 > MAX_IMAGE_BYTES) return fail(413, 'Immagine troppo grande');

  let bytes;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return fail(400, 'Immagine non valida');
  }

  // La vecchia immagine non si cancella qui: lo fa cleanupImages dopo il salvataggio,
  // quando nessun file dati la referenzia più.
  let finalName = `${baseName}.${extension}`;

  let key = `IDs/${restaurantId}/img/${finalName}`;
  let counter = 2;
  while (await env.BUCKET.head(key)) {
    finalName = `${baseName}_${counter}.${extension}`;
    key = `IDs/${restaurantId}/img/${finalName}`;
    counter++;
  }

  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: IMAGE_TYPES[extension] } });

  return json({ success: true, fileName: finalName, imageUrl: `/IDs/${restaurantId}/img/${finalName}` });
}

// Rotte di salvataggio: percorso -> { file, campo del body, validazione, forma salvata }
const SAVE_ROUTES = {
  'save-settings': { file: 'settings.json', field: 'settings', missing: 'Impostazioni mancanti', wrap: (v) => v },
  'save-menu-types': { file: 'menuTypes.json', field: 'menuTypes', missing: 'Menu types mancanti', wrap: (v) => ({ menuTypes: v }) },
  'save-customizations': { file: 'customizations.json', field: 'customizations', missing: 'Customizzazioni mancanti', wrap: (v) => v },
  'save-custom-favorites': { file: 'custom-favorites.json', field: 'favorites', array: true, missing: 'Preferiti non validi', wrap: (v) => v },
  'save-banners': { file: 'banners.json', field: 'banners', array: true, missing: 'Dati banner non validi', wrap: (v) => v.map(sanitizeBanner) },
  'save-promo': { file: 'promo.json', field: 'promos', array: true, missing: 'Dati promo non validi', wrap: (v) => v }
};

// ==================== ENTRYPOINT ====================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (!env.BUCKET || !env.SESSION_SECRET) {
        return fail(500, 'Configurazione mancante: servono il binding BUCKET (R2) e il secret SESSION_SECRET');
      }

      // ---------- Auth ----------
      if (path === '/api/auth/login' && method === 'POST') return await handleLogin(request, env);
      if (path === '/api/auth/register' && method === 'POST') return await handleRegister(request, env);
      if (path === '/api/auth/me' && method === 'GET') return await handleMe(request, env);
      if (path === '/api/auth/change-password' && method === 'POST') return await handleChangePassword(request, env);
      if (path === '/api/auth/logout' && method === 'POST') return handleLogout();

      // ---------- Richieste di informazioni (pubblico, salva in R2 -> Richieste/) ----------
      if (path === '/api/info-request' && method === 'POST') return await handleInfoRequest(request, env);

      // ---------- Elenco utenti per index-user.html (solo gli ID, mai le password) ----------
      if (path === '/userdata/users.json' && method === 'GET') {
        const users = await loadUsers(env, request);
        return json(Object.fromEntries(Object.keys(users).map((id) => [id, {}])));
      }
      if (path.startsWith('/userdata/')) return new Response('Not found', { status: 404 });

      // ---------- Lettura dati ristorante ----------
      const readMatch = path.match(/^\/IDs\/([\w-]+)\/([^/]+)$/);
      if (readMatch && (method === 'GET' || method === 'HEAD') && ID_RE.test(readMatch[1]) && readMatch[2] in JSON_FILES) {
        return await serveData(request, env, readMatch[1], readMatch[2]);
      }
      const imgMatch = path.match(/^\/IDs\/([\w-]+)\/img\/([^/]+)$/);
      if (imgMatch && (method === 'GET' || method === 'HEAD') && ID_RE.test(imgMatch[1])) {
        return await serveImage(request, env, imgMatch[1], decodeURIComponent(imgMatch[2]));
      }
      if (path.startsWith('/IDs/')) return new Response('Not found', { status: 404 });

      // ---------- Scritture (richiedono login) ----------
      if (method === 'POST' && (path === '/upload-image' || path.startsWith('/save-'))) {
        const session = await readSession(request, env);
        if (!session) {
          return json({ success: false, requireLogin: true, message: 'Autenticazione richiesta' }, 401);
        }

        const body = await readBody(request);
        if (!body) return fail(400, 'Richiesta non valida');

        if (path === '/upload-image') return await uploadImage(env, session, body);

        const saveMatch = path.match(/^\/(save-[a-z-]+)\/([\w-]+)$/);
        if (saveMatch) {
          const [, route, restaurantId] = saveMatch;
          if (!ID_RE.test(restaurantId) || session.restaurantId !== restaurantId) {
            return fail(403, 'Accesso non autorizzato');
          }

          if (route === 'save-menu') {
            if (!body.menuContent) return fail(400, 'Contenuto del menu mancante');
            return json(await saveMenu(env, restaurantId, body.menuContent));
          }

          const cfg = SAVE_ROUTES[route];
          if (cfg) {
            const value = body[cfg.field];
            if (cfg.array ? !Array.isArray(value) : !value) return fail(400, cfg.missing);
            const fileKey = `IDs/${restaurantId}/${cfg.file}`;
            const prev = await env.BUCKET.get(fileKey);
            const previousText = prev ? await prev.text() : '';
            await putJSON(env, fileKey, cfg.wrap(value));
            await cleanupImages(env, restaurantId, previousText);
            return json({ success: true });
          }
        }
        return fail(404, 'Endpoint non trovato');
      }

      // ---------- Pagine di gestione: senza sessione il server non invia nulla ----------
      const pagePath = path.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/(.)\/$/, '$1');
      if (PROTECTED_PAGES.has(pagePath) && (method === 'GET' || method === 'HEAD')) {
        const session = await readSession(request, env);
        if (!session) return Response.redirect(new URL('/login.html', url).toString(), 302);

        // URL pulito: /profile (senza .html e senza ?id=). L'id viene dalla sessione.
        if (path !== pagePath || url.searchParams.has('id')) {
          const clean = new URL(url);
          clean.pathname = pagePath;
          clean.searchParams.delete('id');
          return Response.redirect(clean.toString(), 302);
        }

        const internal = new URL(url);
        internal.searchParams.set('id', session.userCode);
        const res = await env.ASSETS.fetch(new Request(internal, request));

        // Gli script della pagina leggono ?id= all'avvio: lo mostro solo fino al caricamento, poi l'URL torna pulito.
        const rid = JSON.stringify(String(session.userCode)).replace(/</g, '\\u003c');
        const inject = `<script>(function(){var p=location.pathname;history.replaceState(null,'',p+'?id='+encodeURIComponent(${rid}));addEventListener('load',function(){history.replaceState(null,'',p)});})();</script>`;
        const out = new HTMLRewriter()
          .on('head', { element(el) { el.prepend(inject, { html: true }); } })
          .transform(res);
        const outRes = new Response(out.body, out);
        outRes.headers.set('Cache-Control', 'no-store'); // dopo il logout "indietro" non la mostra
        return outRes;
      }

      // ---------- URL pulito per i menu: /2371 <-> menu.html?id=2371 ----------
      if (method === 'GET' || method === 'HEAD') {
        // /menu.html?id=2371 (o /menu?id=2371) -> redirect a /2371 (altri parametri, es. type, restano)
        if ((path === '/menu' || path === '/menu.html') && /^\d+$/.test(url.searchParams.get('id') || '')) {
          const id = url.searchParams.get('id');
          url.searchParams.delete('id');
          const rest = url.searchParams.toString();
          return Response.redirect(new URL(`/${id}${rest ? '?' + rest : ''}`, url).toString(), 302);
        }
        // /menu-select.html?id=2371 -> /select/2371
        if ((path === '/menu-select' || path === '/menu-select.html') && /^\d+$/.test(url.searchParams.get('id') || '')) {
          const id = url.searchParams.get('id');
          url.searchParams.delete('id');
          const rest = url.searchParams.toString();
          return Response.redirect(new URL(`/select/${id}${rest ? '?' + rest : ''}`, url).toString(), 302);
        }
        // /select/2371 -> serve menu-select.html senza cambiare l'URL
        const sel = path.match(/^\/select\/(\d+)\/?$/);
        if (sel) {
          const internal = new URL(url);
          internal.pathname = '/menu-select';
          internal.searchParams.set('id', sel[1]);
          return env.ASSETS.fetch(new Request(internal, request));
        }
        // /2371/ -> /2371 (così i percorsi relativi di menu.html restano validi)
        const trailing = path.match(/^\/(\d+)\/$/);
        if (trailing) {
          return Response.redirect(new URL(`/${trailing[1]}${url.search}`, url).toString(), 302);
        }
        // /2371 -> serve menu.html senza cambiare l'URL nel browser
        const clean = path.match(/^\/(\d+)$/);
        if (clean) {
          const internal = new URL(url);
          internal.pathname = '/menu';
          internal.searchParams.set('id', clean[1]);
          return env.ASSETS.fetch(new Request(internal, request));
        }
      }

      // ---------- Tutto il resto: file statici del sito ----------
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Errore worker:', error);
      return fail(500, 'Errore interno del server');
    }
  }
};
