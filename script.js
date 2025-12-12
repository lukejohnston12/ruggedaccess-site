document.querySelectorAll('[data-scroll]').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    const targetId = btn.getAttribute('data-scroll');
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: 'smooth' });

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
