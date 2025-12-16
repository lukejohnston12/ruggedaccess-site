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
      document.body.style.overflow = 'hidden'; // prevent background scroll
    }
  });
});

// Close modal via X button or clicking the dark overlay
document.addEventListener('click', (e) => {
  if (e.target.matches('.modal-close')) {
    const overlay = e.target.closest('.modal-overlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  }
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('is-open');
    document.body.style.overflow = '';
  }
});

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.is-open').forEach(overlay => {
      overlay.classList.remove('is-open');
    });
    document.body.style.overflow = '';
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
