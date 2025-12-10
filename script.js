document.querySelectorAll('[data-scroll]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-scroll');
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  });
});

const yearSpan = document.getElementById('year');
yearSpan.textContent = new Date().getFullYear();
