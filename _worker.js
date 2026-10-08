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
 * Se un file non è ancora in R2, viene servito quello presente nel sito (seed).
 */

const SESSION_COOKIE = 'tm_session';
const SESSION_MAX_AGE = 14 * 24 * 60 * 60; // 14 giorni
const USERS_KEY = 'userdata/users.json';
const MAX_BACKUPS = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PBKDF2_ITERATIONS = 100000; // massimo consentito da Workers

const ID_RE = /^[\w-]{1,20}$/;
const JSON_FILES = {
  'menu.json': null,
  'settings.json': null,
  'menuTypes.json': { copertoPrice: 0 },
  'customizations.json': {},
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

function trialInfo(user) {
  let isTrialActive = false;
  let trialDaysLeft = 0;
  if (user.planType === 'free' && user.trialEndsAt) {
    const now = new Date();
    const end = new Date(user.trialEndsAt);
    if (now < end) {
      isTrialActive = true;
      trialDaysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    }
  }
  return { isTrialActive, trialDaysLeft };
}

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
      user: { userCode, restaurantId: userCode, planType: user.planType || 'free' }
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
  if (password.length < 8 || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return fail(400, 'Password deve avere almeno 8 caratteri e almeno un numero');
  }

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 14);
  const hashed = await hashPassword(password);

  const exists = await mutateUsers(env, request, async (users) => {
    if (users[userCode]) return { changed: false, result: true };
    users[userCode] = {
      password: hashed,
      planType: 'free',
      createdAt: now.toISOString(),
      trialEndsAt: trialEnd.toISOString()
    };
    return { changed: true, result: false };
  });

  if (exists) return fail(409, 'ID utente già esistente');

  return json({
    success: true,
    message: 'Registrazione completata con successo',
    user: { userCode, restaurantId: userCode, planType: 'free', trialEndsAt: trialEnd.toISOString() }
  });
}

async function handleMe(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ success: false, requireLogin: true });

  const users = await loadUsers(env, request);
  const fresh = users[session.userCode];
  if (!fresh) return json({ success: false, requireLogin: true });

  const { isTrialActive, trialDaysLeft } = trialInfo(fresh);

  return json(
    {
      success: true,
      user: {
        userCode: session.userCode,
        restaurantId: session.restaurantId,
        planType: fresh.planType || 'free',
        isTrialActive,
        trialDaysLeft,
        subscriptionEndsAt: fresh.subscriptionEndsAt
      }
    },
    200,
    { 'Set-Cookie': sessionCookie(await signSession(env, session.userCode)) } // sessione "rolling"
  );
}

function handleLogout() {
  return json({ success: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// ==================== LETTURA DATI ====================
async function serveData(request, env, restaurantId, file) {
  const r2 = await env.BUCKET.get(`IDs/${restaurantId}/${file}`);
  if (r2) {
    return new Response(r2.body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }
    });
  }

  // seed incluso nel sito
  const asset = await env.ASSETS.fetch(request);
  if (asset.ok) {
    const res = new Response(asset.body, asset);
    res.headers.set('Cache-Control', 'no-cache');
    return res;
  }

  const fallback = JSON_FILES[file];
  if (fallback !== null) return json(fallback, 200, { 'Cache-Control': 'no-cache' });
  return new Response('Not found', { status: 404 });
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
  return env.ASSETS.fetch(request);
}

// ==================== SALVATAGGIO DATI ====================
async function putJSON(env, key, data) {
  await env.BUCKET.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });
}

async function saveMenu(env, restaurantId, menuContent) {
  const key = `IDs/${restaurantId}/menu.json`;
  const current = await env.BUCKET.get(key);

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
    await env.BUCKET.put(`${prefix}menu_${timestamp}.json`, await current.text(), {
      httpMetadata: { contentType: 'application/json' }
    });
  }

  await putJSON(env, key, menuContent);
  return { success: true, backupCreated: !!current };
}

async function uploadImage(env, session, body) {
  const { fileName, fileData, restaurantId, oldImageUrl } = body || {};

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

  // nome file della vecchia immagine (se era già su questo sito)
  const oldMatch = oldImageUrl ? String(oldImageUrl).match(/\/?IDs\/([\w-]+)\/img\/([^/?#]+)$/) : null;
  const oldFileName = oldMatch && oldMatch[1] === restaurantId ? decodeURIComponent(oldMatch[2]) : null;

  let finalName = `${baseName}.${extension}`;
  if (oldFileName && finalName === oldFileName) finalName = `${baseName}_1.${extension}`;

  let key = `IDs/${restaurantId}/img/${finalName}`;
  let counter = 2;
  while (await env.BUCKET.head(key)) {
    finalName = `${baseName}_${counter}.${extension}`;
    key = `IDs/${restaurantId}/img/${finalName}`;
    counter++;
  }

  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: IMAGE_TYPES[extension] } });

  if (oldFileName) {
    try { await env.BUCKET.delete(`IDs/${restaurantId}/img/${oldFileName}`); } catch { /* ignora */ }
  }

  return json({ success: true, fileName: finalName, imageUrl: `/IDs/${restaurantId}/img/${finalName}` });
}

// Rotte di salvataggio: percorso -> { file, campo del body, validazione, forma salvata }
const SAVE_ROUTES = {
  'save-settings': { file: 'settings.json', field: 'settings', missing: 'Impostazioni mancanti', wrap: (v) => v },
  'save-menu-types': { file: 'menuTypes.json', field: 'menuTypes', missing: 'Menu types mancanti', wrap: (v) => ({ menuTypes: v }) },
  'save-customizations': { file: 'customizations.json', field: 'customizations', missing: 'Customizzazioni mancanti', wrap: (v) => v },
  'save-banners': { file: 'banners.json', field: 'banners', array: true, missing: 'Dati banner non validi', wrap: (v) => v },
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
      if (path === '/api/auth/logout' && method === 'POST') return handleLogout();

      // Il checkout (Stripe) non esiste più: risposta compatibile con i bottoni "Passa a..." di index.html
      if (path === '/api/create-checkout') {
        return json({ success: false, error: 'Pagamenti non disponibili in questa versione' }, 501);
      }

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
            await putJSON(env, `IDs/${restaurantId}/${cfg.file}`, cfg.wrap(value));
            return json({ success: true });
          }
        }
        return fail(404, 'Endpoint non trovato');
      }

      // ---------- Tutto il resto: file statici del sito ----------
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Errore worker:', error);
      return fail(500, 'Errore interno del server');
    }
  }
};
