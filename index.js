function initIndex() {
  const adminLinks = document.querySelectorAll('.admin-only');

  requireSession(
    function () {
      adminLinks.forEach(function (link) {
        link.classList.remove('hidden');
      });
    },
    function () {
      adminLinks.forEach(function (link) {
        link.classList.add('hidden');
      });
    }
  );
}

window.addEventListener('DOMContentLoaded', function () {
  initIndex();
});
