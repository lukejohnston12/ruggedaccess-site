document.querySelectorAll('[data-scroll]').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    const targetId = btn.getAttribute('data-scroll');
    const target = document.getElementById(targetId) || document.querySelector(targetId);
    if (target) {
      const y = target.getBoundingClientRect().top + window.pageYOffset - 70;
      window.scrollTo({ top: y, behavior: "smooth" });
    }

    if (targetId === 'donate') {
      const donateCard = document.querySelector('.donate-card');

      if (donateCard) {
        setTimeout(() => {
          donateCard.classList.add('is-highlighted');
          setTimeout(() => {
            donateCard.classList.remove('is-highlighted');
          }, 1800);
        }, 400);
      }
    }
  });
});

const yearSpan = document.getElementById('year');
yearSpan.textContent = new Date().getFullYear();

// ========= EIN / legal info modal =========
document.querySelectorAll('[data-modal]').forEach(trigger => {
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    const id = trigger.getAttribute('data-modal');
    const overlay = document.querySelector(`.modal-overlay[data-modal-id="${id}"]`);
    if (overlay) {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden'; // prevent background scroll
    }
  });
});

const storyTrigger = document.getElementById('story-btn');
const storyModal = document.getElementById('story-modal');
let lastFocusedModalTrigger = null;

const closeOverlay = (overlay) => {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lastFocusedModalTrigger) {
    lastFocusedModalTrigger.focus();
    lastFocusedModalTrigger = null;
  }
};

const openOverlay = (overlay, trigger) => {
  if (!overlay) return;
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  lastFocusedModalTrigger = trigger || null;
  const focusable = overlay.querySelector('.modal-close');
  if (focusable) focusable.focus();
};

if (storyTrigger && storyModal) {
  storyTrigger.addEventListener('click', () => openOverlay(storyModal, storyTrigger));
}

// Close modal via X button or clicking the dark overlay
document.addEventListener('click', (e) => {
  if (e.target.matches('.modal-close')) {
    const overlay = e.target.closest('.modal-overlay');
    if (overlay && overlay.id === 'story-modal') {
      closeOverlay(overlay);
    } else if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }
  if (e.target.classList.contains('modal-overlay')) {
    if (e.target.id === 'story-modal') {
      closeOverlay(e.target);
    } else {
      e.target.classList.remove('is-open');
      e.target.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
  }
});

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.is-open').forEach(overlay => {
      if (overlay.id === 'story-modal') {
        closeOverlay(overlay);
      } else {
        overlay.classList.remove('is-open');
        overlay.setAttribute('aria-hidden', 'true');
      }
    });
    document.body.style.overflow = '';
  }
});

const STRIPE_SCRIPT_SRC = "https://js.stripe.com/v3/buy-button.js";
const STRIPE_BUY_BUTTON_ID = "buy_btn_1SW8Bq44cvWiByNhshHE6WTW";
const STRIPE_PUBLISHABLE_KEY = "pk_live_51SVeYY44cvWiByNhS2CWMlGSE5NIzgNTe2UIny8wol5WavIXkfQWfPor3LL9qKbF0LigRMYjufGHRyDn4M6b6Slp00hennJHuM";

function ensureStripeScriptLoaded() {
  return new Promise((resolve, reject) => {
    if (window.__stripeBuyButtonReady) return resolve();

    const existing = document.querySelector(`script[src="${STRIPE_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => { window.__stripeBuyButtonReady = true; resolve(); });
      existing.addEventListener("error", reject);
      return;
    }

    const s = document.createElement("script");
    s.src = STRIPE_SCRIPT_SRC;
    s.async = true;
    s.onload = () => { window.__stripeBuyButtonReady = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function mountStripeBuyButton() {
  const mount = document.getElementById("stripe-mount");
  if (!mount) return;

  if (mount.dataset.mounted === "true") return;
  mount.dataset.mounted = "true";

  mount.innerHTML = "";

  const el = document.createElement("stripe-buy-button");
  el.setAttribute("buy-button-id", STRIPE_BUY_BUTTON_ID);
  el.setAttribute("publishable-key", STRIPE_PUBLISHABLE_KEY);
  mount.appendChild(el);
}

async function loadStripeOnIntent() {
  try {
    await ensureStripeScriptLoaded();
    mountStripeBuyButton();
  } catch (e) {
    const mount = document.getElementById("stripe-mount");
    if (mount) {
      mount.dataset.mounted = "false";
      mount.innerHTML = '<p style="color: var(--muted-dim); font-size: 14px; margin: 0;">Secure checkout is still loading. Please try again in a moment.</p>';
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const giveButtons = document.querySelectorAll('.btn[data-scroll="donate"], .nav-donate-btn');
  giveButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      loadStripeOnIntent();
    }, { passive: true });
  });

  const donateTarget =
    document.querySelector(".donate-card") ||
    document.getElementById("donate") ||
    document.getElementById("stripe-mount");

  if (donateTarget) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadStripeOnIntent();
          io.disconnect();
        }
      });
    }, { threshold: 0.35 });

    io.observe(donateTarget);
  }
});

(function initWeatherPill(){
  const pill = document.getElementById('weather-pill');
  if (!pill) return;

  const textEl = pill.querySelector('.wx-text');

  const CACHE_KEY = 'rap_weather_v2';
  const TTL_MS = 30 * 60 * 1000;

  const codeToEmoji = (code) => {
    if (code === 0) return '☀️';
    if (code === 1 || code === 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '🌦️';
    if (code >= 85 && code <= 86) return '🌨️';
    if (code >= 95 && code <= 99) return '⛈️';
    return '⛰️';
  };

  const setText = (text) => {
    if (textEl) textEl.textContent = text;
  };

  // Try cache
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.ts && (Date.now() - cached.ts) < TTL_MS && cached.text) {
        setText(cached.text);
        return;
      }
    }
  } catch (e) {}

  const url = 'https://api.open-meteo.com/v1/forecast?latitude=39.6403&longitude=-106.3742&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FDenver';

  fetch(url)
    .then(r => r.json())
    .then(data => {
      const cur = data && data.current;
      if (!cur) throw new Error('No current');

      const temp = Math.round(cur.temperature_2m);
      const emoji = codeToEmoji(cur.weather_code);

      const text = `Vail • ${temp}°F • ${emoji}`;

      setText(text);

      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), text }));
      } catch (e) {}
    })
    .catch(() => {
      setText('Vail • —°F • ⛰️');
    });
})();

(function initScrollReveal(){
  const els = Array.from(document.querySelectorAll('.reveal'));
  if (!els.length) return;

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced){
    els.forEach(el => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting){
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  els.forEach(el => io.observe(el));
})();

document.addEventListener('DOMContentLoaded', () => {
  const mediaQuery = window.matchMedia('(max-width: 599px)');
  const carousels = Array.from(document.querySelectorAll('.carousel'));
  const registry = new WeakMap();

  const setActive = (dots, index) => {
    dots.forEach((dot, i) => {
      const isActive = i === index;
      dot.classList.toggle('is-active', isActive);
      if (isActive) {
        dot.setAttribute('aria-current', 'true');
      } else {
        dot.removeAttribute('aria-current');
      }
    });
  };

  const setupCarousel = (carousel) => {
    if (registry.has(carousel)) return;

    const slides = Array.from(carousel.querySelectorAll('.carousel__slide'));
    if (!slides.length) return;

    carousel.setAttribute('tabindex', '0');

    const dotsNav = document.createElement('div');
    dotsNav.className = 'carousel-dots';

    const dots = slides.map((slide, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carousel-dot';
      dot.setAttribute('aria-label', `Slide ${index + 1}`);
      dot.addEventListener('click', () => {
        const offset = slide.offsetLeft - (carousel.clientWidth - slide.clientWidth) / 2;
        carousel.scrollTo({ left: offset, behavior: 'smooth' });
      });
      dotsNav.appendChild(dot);
      return dot;
    });

    carousel.insertAdjacentElement('afterend', dotsNav);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = slides.indexOf(entry.target);
          if (idx !== -1) {
            setActive(dots, idx);
          }
        }
      });
    }, { root: carousel, threshold: 0.6 });

    slides.forEach((slide) => observer.observe(slide));
    setActive(dots, 0);

    registry.set(carousel, { observer, dotsNav });
  };

  const teardownCarousel = (carousel) => {
    const data = registry.get(carousel);
    if (!data) return;

    data.observer.disconnect();
    data.dotsNav.remove();
    registry.delete(carousel);
  };

  const handleChange = (e) => {
    if (e.matches) {
      carousels.forEach(setupCarousel);
    } else {
      carousels.forEach(teardownCarousel);
    }
  };

  handleChange(mediaQuery);
  mediaQuery.addEventListener('change', handleChange);
});
