function initListe() {
  const loginSection = document.getElementById('login-section');
  const landingSection = document.getElementById('landing-section');
  const loginForm = document.getElementById('liste-login-form');
  const loginMessage = document.getElementById('login-message');
  const periodLabel = document.getElementById('period-label');
  const logoutButton = document.getElementById('liste-logout-button');

  if (!loginForm || !landingSection) {
    return;
  }

  function showLanding() {
    loginSection.classList.add('hidden');
    landingSection.classList.remove('hidden');
    periodLabel.textContent = `Ausgabe am Samstag, ${formatPeriodLabel()}`;
  }

  function showLogin() {
    landingSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    loginForm.reset();
  }

  requireSession(showLanding);

  wireLoginForm({
    form: loginForm,
    message: loginMessage,
    fixedEmail: LISTE_ACCOUNT_EMAIL,
    onSuccess: showLanding
  });

  wireLogout(logoutButton, showLogin);
}

window.addEventListener('DOMContentLoaded', function () {
  initListe();
});
