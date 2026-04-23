(function() {
  function initFilter() {
    var container = document.querySelector('.category-filter-bar');
    if (!container) return;

    container.addEventListener('click', function(e) {
      var btn = e.target.closest('.cat-filter-btn');
      if (!btn) return;

      container.querySelectorAll('.cat-filter-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');

      var cat = btn.getAttribute('data-category');
      var cards = document.querySelectorAll('.grid-card');

      cards.forEach(function(card) {
        if (cat === 'all') {
          card.removeAttribute('data-hidden');
          card.style.display = '';
        } else {
          var cats = card.getAttribute('data-categories') || '';
          if (cats.indexOf(cat) !== -1) {
            card.removeAttribute('data-hidden');
            card.style.display = '';
          } else {
            card.setAttribute('data-hidden', 'true');
            card.style.display = 'none';
          }
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFilter);
  } else {
    initFilter();
  }
})();
