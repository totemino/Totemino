(function() {
	// ===== INJECT CSS =====
	const style = document.createElement('style');
	style.textContent = `
	.totemino-banner::before {
		content: "";
		position: absolute;
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.3rem;
		height: 70%;
		background: var(--pill-color);
		border-radius: 1rem;
	  }
	  
	  .totemino-banner {
		position: fixed;
		bottom: 2rem; /* o 8rem quando esiste .order */
		left: auto;
		margin-left: 5vw;
		right: 5vw;
		width: 90vw;
		max-width: 500px;
		background: var(--bg-secondary);
		border-radius: 1.5rem;
		padding: 1.5rem 3rem 1.5rem 2.5rem;
		box-shadow: 0 3px 12px var(--shadow-sm);
		z-index: 10;
		animation: slideIn 0.4s ease-out;
		display: none;
		cursor: pointer;
		backdrop-filter: blur(7px);
  		-webkit-backdrop-filter: blur(7px);
	  }
		
	  

	  @media (min-width: 1416px) {
	  	.totemino-banner {
          right: calc((100dvw - 1337px)/2);
		}	
	  }

	  .totemino-banner.show {
		display: block;
	  }
  
	  @keyframes slideIn {
		from {
		  opacity: 0;
		  transform: translateY(20px);
		}
		to {
		  opacity: 1;
		  transform: translateY(0);
		}
	  }
  
	  .totemino-banner.hide {
		animation: slideOut 0.3s ease-in forwards;
	  }
  
	  @keyframes slideOut {
		from {
		  opacity: 1;
		  transform: translateY(0);
		}
		to {
		  opacity: 0;
		  transform: translateY(20px);
		}
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
		transition: transform 0.5s;
		padding: 0;
		z-index: 1;
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

	  /* Stile per banner non cliccabile */
	  .totemino-banner.non-clickable {
		cursor: default;
		pointer-events: none;
		opacity: 0.9;
	  }
	`;
	document.head.appendChild(style);
  
	// ===== BANNER LOGIC =====
	const colors = ['#56D97C', '#42C7F5', '#6C8CFF', '#9C7DFF', '#FF77F6', '#FFB36B', '#F7E250'];
	let banners = [];
	let currentIndex = 0;
	let bannerElement = null;
	let isVisible = false;
	let phoneNumber = null;
	let restaurantSettings = null;
  
	// Get restaurant ID from URL
	const urlParams = new URLSearchParams(window.location.search);
	const restaurantId = urlParams.get('id') || 'default';
  
	// Create banner element
	function createBannerElement() {
	  const banner = document.createElement('div');
	  banner.className = 'totemino-banner';
	  banner.innerHTML = `
		<button class="totemino-banner-close" aria-label="Chiudi"><img src="img/x.png"></button>
		<h3 class="totemino-banner-title"></h3>
		<p class="totemino-banner-subtitle"></p>
	  `;
	  
	  // Check if .order element exists and adjust bottom position
	  const orderElement = document.querySelector('.order');
	  if (orderElement && getComputedStyle(orderElement).display !== 'none') {
		banner.style.bottom = '8rem';
      }

	  document.body.appendChild(banner);
	  
	  const closeBtn = banner.querySelector('.totemino-banner-close');
	  closeBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		closeBanner();
	  });
	  
	  // Verifica se il banner deve essere cliccabile
	  const canReserve = checkReservationAvailable();
	  const hasPhone = !!phoneNumber;
	  
	  if (canReserve || hasPhone) {
		banner.addEventListener('click', openLink);
	  } else {
		// Banner non cliccabile
		banner.classList.add('non-clickable');
	  }
	  
	  return banner;
	}
  
	// Open appropriate link based on conditions
	function openLink() {
	  const currentBanner = banners[currentIndex];
	  
	  // Logica 1: Se può prenotare → vai a prenota.html
	  if (checkReservationAvailable()) {
		const prenotaUrl = `prenota.html?id=${restaurantId}`;
		window.open(prenotaUrl, '_blank');
		return;
	  }
	  
	  // Logica 2: Se c'è numero di telefono → WhatsApp
	  if (phoneNumber) {
		const message = `Salve, volevo prenotare per la serata di ${currentBanner.title}`;
		const whatsappUrl = `https://wa.me/+39${phoneNumber}?text=${encodeURIComponent(message)}`;
		window.open(whatsappUrl, '_blank');
		return;
	  }
	  
	  // Logica 3: Se nessuna delle due → non fare nulla
	  console.log('Banner non cliccabile');
	}

	// Check if reservation is available
	function checkReservationAvailable() {
	  if (!restaurantSettings?.reservations?.enabled) {
		return false;
	  }
	  
	  const reservations = restaurantSettings.reservations;
	  
	  // Se tablesEnabled è true, controlla che ci siano tavoli
	  if (reservations.tablesEnabled) {
		return reservations.tables && reservations.tables.length > 0;
	  }
	  
	  // Se tablesEnabled è false, controlla maxPeoplePerSlot
	  return reservations.maxPeoplePerSlot > 0;
	}
  
	// Show banner
	function showBanner() {
	  if (banners.length === 0 || isVisible) return;
  
	  const banner = banners[currentIndex];
	  const color = colors[currentIndex % colors.length];
  
	  bannerElement.style.borderLeftColor = color;
	  bannerElement.querySelector('.totemino-banner-title').textContent = banner.title;
	  bannerElement.querySelector('.totemino-banner-title').style.color = color;
	  bannerElement.style.setProperty('--pill-color', color);
	  bannerElement.querySelector('.totemino-banner-subtitle').textContent = banner.subtitle;
  
	  bannerElement.classList.remove('hide');
	  bannerElement.classList.add('show');
	  isVisible = true;
	}
  
	// Close banner
	function closeBanner() {
	  if (!isVisible) return;
  
	  bannerElement.classList.add('hide');
	  isVisible = false;
  
	  setTimeout(() => {
		bannerElement.classList.remove('show', 'hide');
		
		currentIndex++;
		
		// Show next banner after 5 seconds only if there are more banners
		if (currentIndex < banners.length) {
		  setTimeout(showBanner, 10000);
		}
	  }, 300);
	}
  
	// Load phone number from settings
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

	// Load restaurant settings
	async function loadRestaurantSettings() {
	  try {
		const response = await fetch(`/IDs/${restaurantId}/settings.json`);
		if (response.ok) {
		  restaurantSettings = await response.json();
		  
		  // Carica anche il numero se non già caricato
		  if (!phoneNumber && restaurantSettings.restaurant?.phone) {
			phoneNumber = restaurantSettings.restaurant.phone;
		  }
		}
	  } catch (error) {
		console.error('Errore caricamento impostazioni:', error);
	  }
	}
  
	// Load banners
	async function loadBanners() {
	  try {
		const response = await fetch(`/IDs/${restaurantId}/banners.json`);
		if (response.ok) {
		  banners = await response.json();
		  
		  if (banners.length > 0) {
			bannerElement = createBannerElement();
			
			// Show first banner after 5 seconds
			setTimeout(showBanner, 6500);
		  }
		}
	  } catch (error) {
		console.error('Errore caricamento banner:', error);
	  }
	}
  
	// Initialize when DOM is ready
	async function init() {
	  await loadPhoneNumber();
	  await loadRestaurantSettings();
	  await loadBanners();
	}
  
	if (document.readyState === 'loading') {
	  document.addEventListener('DOMContentLoaded', init);
	} else {
	  init();
	}

})();