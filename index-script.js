// ===== INTERSECTION OBSERVER FOR SCROLL ANIMATIONS =====
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      // Non fare unobserve del logo per permettere animazioni infinite
      if (!entry.target.id || entry.target.id !== 'logoSwap') {
        observer.unobserve(entry.target);
      }
    }
  });
}, observerOptions);

// ===== OBSERVE ELEMENTS ON PAGE LOAD =====
document.addEventListener('DOMContentLoaded', () => {
  // Observe section headers
  const sectionHeaders = document.querySelectorAll('.section-header');
  sectionHeaders.forEach(header => observer.observe(header));

  // Observe stats
  const statItems = document.querySelectorAll('.stat-item');
  statItems.forEach((stat, index) => {
    stat.style.animationDelay = `${index * 0.1}s`;
    observer.observe(stat);
  });

  // Observe feature cards
  const featureCards = document.querySelectorAll('.feature-card');
  featureCards.forEach((card, index) => {
    card.style.animationDelay = `${index * 0.1}s`;
    observer.observe(card);
  });

  // Observe steps
  const steps = document.querySelectorAll('.step');
  steps.forEach((step, index) => {
    step.style.animationDelay = `${index * 0.2}s`;
    observer.observe(step);
  });

  // Observe pricing cards
 const pricingCards = document.querySelectorAll('.pricing-card');

  pricingCards.forEach((card, index) => {
    let delay;

    const isFeatured = card.classList.contains('featured');

    // Ordine: prima (0s), terza (0.25s), centrale/featured (0.4s)
    if (!isFeatured && index === 0) {
      delay = 0;
    } else if (!isFeatured && index !== 0) {
      delay = 0.25;
    } else if (isFeatured) {
      delay = 0.5;
    }

    card.style.animationDelay = `${delay}s`;
    observer.observe(card);
  });


  // Observe testimonials
  const testimonials = document.querySelectorAll('.testimonial-card');
  testimonials.forEach((testimonial, index) => {
    testimonial.style.animationDelay = `${index * 0.15}s`;
    observer.observe(testimonial);
  });

  // Initialize FAQ accordions
  initFAQ();

  // Navbar scroll effect
  initNavbarScroll();
});

// ===== SHOW MORE FEATURES BUTTON (MOBILE) =====
document.addEventListener('DOMContentLoaded', () => {
  const showMoreBtn = document.getElementById('showMoreFeatures');
  const featuresGrid = document.querySelector('.features-grid');
  
  if (showMoreBtn && featuresGrid) {
    showMoreBtn.addEventListener('click', () => {
      featuresGrid.classList.add('expanded');
      
      // Anima le card nascoste quando vengono mostrate
      const hiddenCards = featuresGrid.querySelectorAll('.feature-card:nth-child(n+3)');
      hiddenCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
        card.classList.add('visible');
      });
    });
  }
});

// ===== NAVBAR SCROLL EFFECT =====
function initNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
  });
}

// ===== FAQ ACCORDION =====
function initFAQ() {
  const faqItems = document.querySelectorAll('.faq-item');
  
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');
    const icon = item.querySelector('.faq-icon');
    
    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('active');
      
      // Chiudi tutte le altre FAQ
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
          otherItem.querySelector('.faq-answer').style.maxHeight = '0';
          otherItem.querySelector('.faq-icon').style.transform = 'rotate(0deg)';
        }
      });
      
      // Toggle della FAQ corrente
      if (isOpen) {
        item.classList.remove('active');
        answer.style.maxHeight = '0';
        icon.style.transform = 'rotate(0deg)';
      } else {
        item.classList.add('active');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        icon.style.transform = 'rotate(180deg)';
      }
    });
  });
}

// ===== SMOOTH SCROLL FOR ANCHOR LINKS =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href !== '#' && href.length > 1) {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        const offsetTop = target.offsetTop - 80;
        window.scrollTo({
          top: offsetTop,
          behavior: 'smooth'
        });
      }
    }
  });
});

// ===== PARALLAX EFFECT FOR HERO IMAGE (OPTIONAL) =====
const heroImage = document.querySelector('.hero-image');
if (heroImage) {
  window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const rate = scrolled * 0.1;
    
    if (scrolled < window.innerHeight) {
      heroImage.style.transform = `translateY(${rate}px)`;
    }
  });
}

// ===== ANIMATED COUNTER FOR STATS =====
function animateCounter(element, target, suffix = '', duration = 2000) {
  let current = 0;
  const increment = target / (duration / 16);
  const isDecimal = target.toString().includes('.');
  
  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      current = target;
      clearInterval(timer);
    }
    
    if (isDecimal) {
      element.textContent = current.toFixed(1) + suffix;
    } else if (target >= 1000) {
      element.textContent = Math.floor(current).toLocaleString() + suffix;
    } else {
      element.textContent = Math.floor(current) + suffix;
    }
  }, 16);
}

// Trigger counter animation when stats become visible
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const statItems = entry.target.querySelectorAll('.stat-item h3');
      statItems.forEach(stat => {
        const text = stat.textContent.trim();
        let target;
        let suffix = '';
        
        if (text.includes('%')) {
          target = parseInt(text);
          suffix = '%';
          stat.textContent = '0%';
          setTimeout(() => animateCounter(stat, target, suffix), 300);
        } else if (text.includes('+')) {
          target = parseInt(text.replace('+', ''));
          suffix = '+';
          stat.textContent = '0';
          setTimeout(() => animateCounter(stat, target, suffix), 300);
        } else if (text.includes('+')) {
          target = parseInt(text.replace('+', ''));
          suffix = '+';
          stat.textContent = '0';
          setTimeout(() => animateCounter(stat, target, suffix), 300);
        } else if (text.includes('/')) {
          const rating = parseFloat(text.split('/')[0]);
          suffix = '/5';
          stat.textContent = '0.0/5';
          setTimeout(() => animateCounter(stat, rating, suffix), 300);
        }
      });
      
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

const statsBar = document.querySelector('.stats-bar');
if (statsBar) {
  statsObserver.observe(statsBar);
}

// ===== ADD RIPPLE EFFECT TO BUTTONS =====
function createRipple(event) {
  const button = event.currentTarget;
  const ripple = document.createElement('span');
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;

  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = x + 'px';
  ripple.style.top = y + 'px';
  ripple.classList.add('ripple');

  button.appendChild(ripple);

  setTimeout(() => {
    ripple.remove();
  }, 600);
}

// Apply ripple to buttons
document.querySelectorAll('.btn-hero, .btn-pricing, .btn-cta-large').forEach(button => {
  button.addEventListener('click', createRipple);
});

// ===== LAZY LOADING IMAGES =====
if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          imageObserver.unobserve(img);
        }
      }
    });
  });

  document.querySelectorAll('img[data-src]').forEach(img => {
    imageObserver.observe(img);
  });
}

// ===== PERFORMANCE: DEBOUNCE SCROLL EVENTS =====
function debounce(func, wait = 10) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ===== EASTER EGG: KONAMI CODE =====
let konamiCode = [];
const konamiSequence = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];

document.addEventListener('keydown', (e) => {
  konamiCode.push(e.keyCode);
  konamiCode = konamiCode.slice(-10);
  
  if (konamiCode.join(',') === konamiSequence.join(',')) {
    document.body.style.animation = 'rainbow 2s linear infinite';
    setTimeout(() => {
      document.body.style.animation = '';
    }, 5000);
  }
});