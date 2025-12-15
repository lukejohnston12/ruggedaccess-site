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
