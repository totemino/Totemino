(function() {
	// ===== INJECT CSS =====
	const style = document.createElement('style');
	style.textContent = `
	.totemino-banner {
		position: fixed;
		bottom: 2rem; /* o 8rem quando esiste .order */
		left: auto;
		margin-left: 16px;
		right: 16px;
		width: calc(100% - 32px);
		max-width: 500px;
		background: var(--bg-secondary);
		border-radius: 1.5rem;
		box-shadow: 0 3px 12px var(--shadow-sm), 0 0 0 0 rgba(0, 0, 0, 0);
		z-index: 10;
		display: none;
		backdrop-filter: blur(7px);
		-webkit-backdrop-filter: blur(7px);
		transition: box-shadow 0.25s ease;
		user-select: none;
		-webkit-user-select: none;
	}

	@media (min-width: 1200px) {
		.totemino-banner { right: 32px; }
	}

	@media (min-width: 1416px) {
		.totemino-banner { right: calc((100dvw - 1337px)/2); }
	}

	.totemino-banner.show {
		display: block;
		animation: slideIn 0.4s ease-out;
	}

	/* Bordo esterno nero semi-trasparente mentre si scorre (stile widget Samsung) */
	.totemino-banner.dragging {
		box-shadow: 0 3px 12px var(--shadow-sm), 0 0 0 6px rgba(0, 0, 0, 0.45);
	}

	@keyframes slideIn {
		from { opacity: 0; transform: translateY(20px); }
		to   { opacity: 1; transform: translateY(0); }
	}

	.totemino-banner.hide {
		animation: slideOut 0.3s ease-in forwards;
	}

	@keyframes slideOut {
		from { opacity: 1; transform: translateY(0); }
		to   { opacity: 0; transform: translateY(20px); }
	}

	.totemino-viewport {
		overflow: hidden;
		border-radius: inherit;
		touch-action: pan-y; /* lo scroll verticale resta alla pagina, l'orizzontale è del carosello */
		cursor: pointer;
	}

	.totemino-track {
		display: flex;
		align-items: stretch;
		width: 100%;
		transition: transform 0.35s cubic-bezier(0.22, 0.8, 0.3, 1);
		will-change: transform;
	}

	.totemino-track.no-anim { transition: none; }

	.totemino-slide {
		position: relative;
		flex: 0 0 100%;
		box-sizing: border-box;
		padding: 1.5rem 3rem 1.5rem 2.5rem;
	}

	.totemino-banner.multi .totemino-slide { padding-bottom: 2rem; }

	.totemino-slide::before {
		content: "";
		position: absolute;
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.3rem;
		height: 60%;
		background: var(--pill-color);
		border-radius: 1rem;
	}

	.totemino-banner-title {
		font-family: 'QS';
		font-size: 1.1rem;
		font-weight: 700;
		margin: 0 0 0.5rem 0;
		line-height: 1.3;
	}

	.totemino-banner-subtitle {
		font-family: 'QS';
		font-size: 0.95rem;
		font-weight: 400;
		margin: 0;
		color: var(--text-primary, #000);
		line-height: 1.4;
	}

	.totemino-dots {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0.65rem;
		display: none;
		justify-content: center;
		gap: 0.35rem;
		pointer-events: none;
	}
	.totemino-banner.multi .totemino-dots { display: flex; }

	.totemino-dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--text-primary, #000);
		opacity: 0.2;
		transition: opacity 0.2s, width 0.2s;
	}
	.totemino-dot.active { opacity: 0.7; width: 1rem; border-radius: 1rem; }

	.totemino-banner-close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		background: none;
		border: none;
		display: flex;
		justify-content: center;
		align-items: center;
		cursor: pointer;
		padding: 0;
		z-index: 2;
	}
	.totemino-banner-close img {
		height: 1.3rem;
		width: 1.3rem;
		opacity: 0.35;
	}

	[data-theme="dark"] .totemino-banner-close img {
		filter: invert(1);
		opacity: 0.8;
	}
	`;
	document.head.appendChild(style);

	// ===== CONFIGURAZIONE =====
	const colors = ['#56D97C', '#42C7F5', '#6C8CFF', '#9C7DFF', '#FF77F6', '#FFB36B', '#F7E250'];
	const FIRST_SHOW_MS = 10000;               // il banner appare 10s dopo l'apertura del menu
	const ROTATE_MS = 15000;                   // rotazione automatica ogni 15s
	const HIDE_MS = [20000, 60000, 120000];    // 1a X: 20s, 2a X: 1 min, 3a X: 2 min, alla 4a niente X
	const DRAG_THRESHOLD = 8;                  // px prima di considerarlo uno swipe
	const SWIPE_DISTANCE = 50;                 // px per cambiare banner

	// ===== STATO =====
	let banners = [];
	let currentIndex = 0;
	let bannerElement = null;
	let trackElement = null;
	let closeBtn = null;
	let dotsElement = null;
	let isVisible = false;
	let phoneNumber = null;
	let dismissCount = 0;    // quante volte è stata premuta la X (si azzera al ricaricamento)
	let stopped = false;     // dopo la prima X la rotazione automatica resta ferma
	let paused = false;      // hover / touch / scheda in background
	let rotateTimer = null;
	let reshowTimer = null;

	const DEFAULT_WA_MESSAGE = "Ciao, voglio prenotare un tavolo per l'evento [evento]";

	// ID ristorante dall'URL
	const urlParams = new URLSearchParams(window.location.search);
	const restaurantId = urlParams.get('id') || (window.location.pathname.match(/^\/(\d+)\/?$/) || [])[1] || 'default';

	// ===== LINK =====
	// Calcola il link di un banner: stringa vuota = non cliccabile
	function resolveUrl(banner) {
		const link = banner.link || { type: 'whatsapp' }; // banner vecchi: WhatsApp

		if (link.type === 'website') {
			try {
				const u = new URL(link.url);
				return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
			} catch (e) {
				return '';
			}
		}

		if (link.type === 'whatsapp') {
			if (!phoneNumber) return '';
			const message = (link.message || DEFAULT_WA_MESSAGE).replaceAll('[evento]', banner.title);
			return `https://wa.me/+39${phoneNumber}?text=${encodeURIComponent(message)}`;
		}

		return ''; // type "none"
	}

	function openLink() {
		const url = resolveUrl(banners[currentIndex]);
		if (!url) return;
		window.open(url, '_blank', 'noopener');
	}

	// ===== CREAZIONE DOM =====
	function createBannerElement() {
		const banner = document.createElement('div');
		banner.className = 'totemino-banner' + (banners.length > 1 ? ' multi' : '');

		const slides = banners.map((b, i) => {
			const slide = document.createElement('div');
			slide.className = 'totemino-slide';
			slide.style.setProperty('--pill-color', b._color);

			const title = document.createElement('h3');
			title.className = 'totemino-banner-title';
			title.textContent = b.title;
			title.style.color = b._color;

			const sub = document.createElement('p');
			sub.className = 'totemino-banner-subtitle';
			sub.textContent = b.subtitle;

			slide.append(title, sub);
			return slide;
		});

		const viewport = document.createElement('div');
		viewport.className = 'totemino-viewport';
		trackElement = document.createElement('div');
		trackElement.className = 'totemino-track';
		slides.forEach(s => trackElement.appendChild(s));
		viewport.appendChild(trackElement);

		closeBtn = document.createElement('button');
		closeBtn.className = 'totemino-banner-close';
		closeBtn.setAttribute('aria-label', 'Chiudi');
		closeBtn.innerHTML = '<img src="img/x.png" alt="">';

		dotsElement = document.createElement('div');
		dotsElement.className = 'totemino-dots';
		banners.forEach(() => {
			const d = document.createElement('span');
			d.className = 'totemino-dot';
			dotsElement.appendChild(d);
		});

		banner.append(viewport, dotsElement, closeBtn);

		// Se esiste .order, il banner sale sopra la barra dell'ordine
		const orderElement = document.querySelector('.order');
		if (orderElement && getComputedStyle(orderElement).display !== 'none') {
			banner.style.bottom = '8rem';
		}

		document.body.appendChild(banner);

		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			onCloseClick();
		});
		closeBtn.addEventListener('pointerdown', e => e.stopPropagation());

		setupDrag(viewport);
		return banner;
	}

	// ===== POSIZIONE CAROSELLO =====
	function updateDots() {
		[...dotsElement.children].forEach((d, i) => d.classList.toggle('active', i === currentIndex));
	}

	function setTransform(extraPx) {
		trackElement.style.transform = `translateX(calc(${-currentIndex * 100}% + ${extraPx || 0}px))`;
	}

	function goTo(index, animate = true) {
		currentIndex = (index + banners.length) % banners.length;
		trackElement.classList.toggle('no-anim', !animate);
		setTransform(0);
		updateDots();
	}

	// ===== SWIPE =====
	function setupDrag(viewport) {
		let startX = 0, startY = 0, dx = 0, startT = 0;
		let tracking = false, dragging = false, moved = false;

		viewport.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			tracking = true;
			dragging = false;
			moved = false;
			startX = e.clientX;
			startY = e.clientY;
			startT = Date.now();
			dx = 0;
			pauseRotation();
		});

		viewport.addEventListener('pointermove', (e) => {
			if (!tracking) return;
			dx = e.clientX - startX;
			const dy = e.clientY - startY;

			if (!dragging) {
				if (Math.abs(dx) < DRAG_THRESHOLD) return;
				if (Math.abs(dy) > Math.abs(dx)) { tracking = false; resumeRotation(); return; } // scroll verticale
				dragging = true;
				moved = true;
				bannerElement.classList.add('dragging');
				trackElement.classList.add('no-anim');
				try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
			}

			// resistenza ai bordi (primo/ultimo banner)
			let offset = dx;
			if ((currentIndex === 0 && dx > 0) || (currentIndex === banners.length - 1 && dx < 0)) offset = dx * 0.3;
			setTransform(offset);
		});

		const end = (e) => {
			if (!tracking) return;
			tracking = false;

			if (dragging) {
				dragging = false;
				bannerElement.classList.remove('dragging');
				trackElement.classList.remove('no-anim');

				const fast = Date.now() - startT < 300 && Math.abs(dx) > 25;
				let next = currentIndex;
				if (dx < -SWIPE_DISTANCE || (fast && dx < 0)) next = Math.min(currentIndex + 1, banners.length - 1);
				else if (dx > SWIPE_DISTANCE || (fast && dx > 0)) next = Math.max(currentIndex - 1, 0);
				goTo(next);
			}
			resumeRotation();
		};

		viewport.addEventListener('pointerup', end);
		viewport.addEventListener('pointercancel', end);

		// Click = apre il link, ma non se era uno swipe
		viewport.addEventListener('click', () => {
			if (moved) { moved = false; return; }
			openLink();
		});

		// Pausa con il mouse sopra (desktop)
		bannerElement_hoverBind(viewport);
	}

	function bannerElement_hoverBind(el) {
		el.addEventListener('mouseenter', pauseRotation);
		el.addEventListener('mouseleave', resumeRotation);
	}

	// ===== ROTAZIONE AUTOMATICA =====
	function pauseRotation() {
		paused = true;
		clearTimeout(rotateTimer);
	}

	function resumeRotation() {
		paused = false;
		scheduleNext();
	}

	// Un solo banner, banner chiuso con la X, o pausa: niente rotazione
	function scheduleNext() {
		clearTimeout(rotateTimer);
		if (banners.length < 2 || stopped || paused || !isVisible) return;
		rotateTimer = setTimeout(() => {
			goTo(currentIndex + 1);
			scheduleNext();
		}, ROTATE_MS);
	}

	// ===== MOSTRA / NASCONDI =====
	function showBanner() {
		if (!banners.length || isVisible) return;

		// Alla quarta apparizione (dopo 3 X) la X non c'è più
		closeBtn.style.display = dismissCount >= HIDE_MS.length ? 'none' : 'flex';

		goTo(currentIndex, false); // resta sul banner dove era stata premuta la X
		bannerElement.classList.remove('hide');
		bannerElement.classList.add('show');
		isVisible = true;

		scheduleNext();
	}

	function hideBanner(done) {
		if (!isVisible) return;
		isVisible = false;
		bannerElement.classList.add('hide');
		setTimeout(() => {
			bannerElement.classList.remove('show', 'hide', 'dragging');
			if (done) done();
		}, 300);
	}

	// X: ferma la rotazione su questo banner, nasconde il div per 20s / 1min / 2min
	function onCloseClick() {
		if (!isVisible || dismissCount >= HIDE_MS.length) return;
		clearTimeout(rotateTimer);
		stopped = true;
		const wait = HIDE_MS[dismissCount];
		dismissCount++;
		hideBanner(() => {
			clearTimeout(reshowTimer);
			reshowTimer = setTimeout(showBanner, wait);
		});
	}

	// ===== CARICAMENTO DATI =====
	async function loadPhoneNumber() {
		try {
			const response = await fetch(`/IDs/${restaurantId}/settings.json`);
			if (response.ok) {
				const settings = await response.json();
				phoneNumber = settings.restaurant?.phone || null;
			}
		} catch (error) {
			console.error('Errore caricamento telefono', error);
		}
	}

	async function loadBanners() {
		try {
			const response = await fetch(`/IDs/${restaurantId}/banners.json`);
			if (!response.ok) return;
			banners = await response.json();
			if (!Array.isArray(banners)) banners = [];

			// Mostra solo i banner attivi oggi (il proprietario riceve anche quelli programmati)
			const pad = n => String(n).padStart(2, '0');
			const now = new Date();
			const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
			banners = banners.filter(b => {
				const d = b.duration;
				if (!d) return true; // banner vecchi: per sempre
				if (d.type === 'range') return (!d.from || today >= d.from) && (!d.to || today <= d.to);
				if (d.type === 'days') return !d.until || today <= d.until;
				return true;
			});

			if (banners.length > 0) {
				banners.forEach((b, i) => { b._color = colors[i % colors.length]; });
				bannerElement = createBannerElement();

				document.addEventListener('visibilitychange', () => {
					if (document.hidden) pauseRotation(); else resumeRotation();
				});

				// Compare dopo 10 secondi dall'apertura del menu
				setTimeout(showBanner, FIRST_SHOW_MS);
			}
		} catch (error) {
			console.error('Errore caricamento banner:', error);
		}
	}

	async function init() {
		await loadPhoneNumber();
		await loadBanners();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

})();
