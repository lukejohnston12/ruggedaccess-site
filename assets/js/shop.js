/* Rugged Access Project — shop listing (filter + sort) and product page (gallery + checkout). */
(function () {
  'use strict';

  var track = function (name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
  };

  /* ── Listing: filter by style, sort, keep state in the URL ──────────── */
  var grid = document.querySelector('[data-shop-grid]');
  var toolbar = document.querySelector('[data-shop-toolbar]');
  if (grid && toolbar) {
    toolbar.hidden = false; // the toolbar only appears when JS can drive it
    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-product]'));
    var chips = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
    var sortSelect = toolbar.querySelector('[data-sort]');
    var countEl = toolbar.querySelector('[data-shop-count]');
    var emptyEl = document.querySelector('[data-shop-empty]');
    var params = new URLSearchParams(location.search);
    var state = { style: params.get('style') || 'all', sort: params.get('sort') || 'featured' };

    var sorters = {
      'featured': function (a, b) { return a.dataset.featured - b.dataset.featured; },
      'price-asc': function (a, b) { return a.dataset.price - b.dataset.price || a.dataset.featured - b.dataset.featured; },
      'price-desc': function (a, b) { return b.dataset.price - a.dataset.price || a.dataset.featured - b.dataset.featured; },
      'name': function (a, b) { return a.dataset.name.localeCompare(b.dataset.name); }
    };

    var render = function () {
      if (!sorters[state.sort]) state.sort = 'featured';
      var visible = 0;
      cards.slice().sort(sorters[state.sort]).forEach(function (card) {
        var show = state.style === 'all' || card.dataset.style === state.style;
        card.hidden = !show;
        if (show) visible++;
        grid.appendChild(card);
      });
      chips.forEach(function (chip) {
        if (chip.classList.contains('chip')) chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.style));
      });
      sortSelect.value = state.sort;
      countEl.textContent = visible + (visible === 1 ? ' product' : ' products');
      if (emptyEl) emptyEl.hidden = visible > 0;

      var q = new URLSearchParams();
      if (state.style !== 'all') q.set('style', state.style);
      if (state.sort !== 'featured') q.set('sort', state.sort);
      var qs = q.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
    };

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () { state.style = chip.dataset.filter; render(); });
    });
    sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; render(); });
    render();
  }

  /* ── Product page gallery: thumbnails + swipe + arrow keys ──────────── */
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var stage = gallery.querySelector('[data-gallery-stage]');
    var slides = Array.prototype.slice.call(gallery.querySelectorAll('[data-gallery-slide]'));
    var thumbs = Array.prototype.slice.call(gallery.querySelectorAll('[data-gallery-thumb]'));
    var current = 0;

    var mark = function (i) {
      current = i;
      thumbs.forEach(function (t, n) {
        if (n === i) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      });
    };
    var go = function (i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      stage.scrollTo({ left: slides[i].offsetLeft - stage.offsetLeft, behavior: 'smooth' });
      mark(i);
    };

    thumbs.forEach(function (t) {
      t.addEventListener('click', function () { go(Number(t.dataset.galleryThumb)); });
    });
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1); }
    });
    if ('IntersectionObserver' in window) {
      var gio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) mark(slides.indexOf(en.target)); });
      }, { root: stage, threshold: 0.6 });
      slides.forEach(function (s) { gio.observe(s); });
    }
  }

  /* ── Checkout: Stripe Payment Link + analytics ──────────────────────── */
  document.querySelectorAll('[data-checkout]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      track('begin_checkout', {
        currency: 'USD',
        value: Number(btn.dataset.price),
        items: [{ item_id: btn.dataset.sku, item_name: btn.dataset.name, price: Number(btn.dataset.price), quantity: 1 }]
      });
    });
  });
})();
