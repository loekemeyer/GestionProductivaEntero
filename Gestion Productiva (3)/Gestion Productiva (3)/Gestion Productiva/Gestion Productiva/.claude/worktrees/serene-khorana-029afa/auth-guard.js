(function() {
  if (sessionStorage.getItem('gp_auth') !== 'ok') {
    var script = document.querySelector('script[src*="auth-guard"]');
    var src = script.getAttribute('src');
    window.location.replace(src.replace('auth-guard.js', 'login.html'));
  }
})();
