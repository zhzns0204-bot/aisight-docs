(function () {
  "use strict";
  var btn = document.getElementById('mobileMenuBtn');
  var sidebar = document.getElementById('sidebar');
  var backdrop = document.getElementById('sidebarBackdrop');
  function openMenu() { sidebar.classList.add('mobile-open'); backdrop.classList.add('show'); }
  function closeMenu() { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('show'); }
  if (btn) btn.addEventListener('click', function () {
    if (sidebar.classList.contains('mobile-open')) closeMenu(); else openMenu();
  });
  if (backdrop) backdrop.addEventListener('click', closeMenu);

  var search = document.getElementById('navSearch');
  if (search) {
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var items = document.querySelectorAll('#treeNav .tree-item');
      items.forEach(function (li) {
        var text = li.getAttribute('data-search') || '';
        li.style.display = (!q || text.indexOf(q) !== -1) ? '' : 'none';
      });
    });
  }
})();
