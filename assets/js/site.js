/* Rugged Access Project — site-wide behavior. No dependencies. */
(function () {
  'use strict';

  var track = function (name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  };

  /* ── Header: shadow on scroll + mobile menu ─────────────────────────── */
  var header = document.querySelector('[data-header]');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  var toggle = document.querySelector('[data-menu-toggle]');
  var nav = document.querySelector('[data-nav]');
  if (toggle && nav) {
    var setMenu = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    };
    toggle.addEventListener('click', function () {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); }
    });
  }

  /* ── "Our story" video dialog ───────────────────────────────────────── */
  var dialog = document.querySelector('[data-story-modal]');
  if (dialog && typeof dialog.showModal === 'function') {
    var frameWrap = dialog.querySelector('[data-story-frame]');
    var opener = null;

    var openStory = function (trigger) {
      opener = trigger;
      var id = dialog.getAttribute('data-vimeo-id');
      frameWrap.innerHTML = '<iframe src="https://player.vimeo.com/video/' + id +
        '?autoplay=1&badge=0&autopause=0&dnt=1" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" ' +
        'referrerpolicy="strict-origin-when-cross-origin" title="Introducing Rugged Access Project"></iframe>';
      dialog.showModal();
      track('video_open', { video: 'our_story' });
    };

    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-story-open]');
      if (!t) return;
      e.preventDefault();
      openStory(t);
    });
    dialog.querySelector('[data-story-close]').addEventListener('click', function () { dialog.close(); });
    // Click on the backdrop closes
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    // Removing the iframe stops playback
    dialog.addEventListener('close', function () {
      frameWrap.innerHTML = '';
      if (opener) opener.focus();
    });
  }

  /* ── Stripe donation Buy Button (loaded on intent) ──────────────────── */
  var mount = document.querySelector('[data-stripe-mount]');
  var STRIPE_SRC = 'https://js.stripe.com/v3/buy-button.js';
  var stripePromise = null;

  var loadStripe = function () {
    if (!mount || mount.getAttribute('data-mounted') === 'true') return;
    if (!stripePromise) {
      stripePromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = STRIPE_SRC;
        s.async = true;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    stripePromise.then(function () {
      if (mount.getAttribute('data-mounted') === 'true') return;
      mount.setAttribute('data-mounted', 'true');
      mount.innerHTML = '';
      var el = document.createElement('stripe-buy-button');
      el.setAttribute('buy-button-id', mount.getAttribute('data-buy-button-id'));
      el.setAttribute('publishable-key', mount.getAttribute('data-publishable-key'));
      mount.appendChild(el);
    }).catch(function () {
      stripePromise = null;
      mount.innerHTML = '<p>Secure checkout didn’t load. Please refresh and try again.</p>';
    });
  };

  if (mount) {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-give]')) { loadStripe(); track('donate_intent'); }
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; })) { loadStripe(); io.disconnect(); }
      }, { rootMargin: '200px 0px' });
      io.observe(mount);
    } else {
      loadStripe();
    }
    if (location.hash === '#donate') loadStripe();
  }

  /* ── Weather in the conditions bar (Open-Meteo, cached 30 min) ──────── */
  var wx = document.querySelector('[data-weather]');
  if (wx) {
    var KEY = 'rap_weather_v3';
    var TTL = 30 * 60 * 1000;
    var describe = function (code) {
      if (code === 0) return 'Clear';
      if (code <= 2) return 'Partly cloudy';
      if (code === 3) return 'Overcast';
      if (code === 45 || code === 48) return 'Fog';
      if (code >= 51 && code <= 67) return 'Rain';
      if (code >= 71 && code <= 77) return 'Snow';
      if (code >= 80 && code <= 82) return 'Showers';
      if (code >= 85 && code <= 86) return 'Snow showers';
      if (code >= 95) return 'Storms';
      return 'Mountain weather';
    };
    var show = function (text) { wx.textContent = text; };
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (cached && Date.now() - cached.ts < TTL) {
      show(cached.text);
    } else {
      fetch('https://api.open-meteo.com/v1/forecast?latitude=39.6403&longitude=-106.3742&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FDenver')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var cur = d && d.current;
          if (!cur) throw new Error('no data');
          var text = 'Vail ' + Math.round(cur.temperature_2m) + '°F · ' + describe(cur.weather_code);
          show(text);
          try { localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), text: text })); } catch (e) {}
        })
        .catch(function () { show('Vail Valley conditions unavailable'); });
    }
  }

  /* ── Scroll reveal ──────────────────────────────────────────────────── */
  var reveals = document.querySelectorAll('.reveal');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || reduced) {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); rio.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (el) { rio.observe(el); });
  }
})();
