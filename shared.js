const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getViennaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = parseInt(part.value, 10);
    }
  }

  if (parts.hour === 24) {
    parts.hour = 0;
  }

  return parts;
}

function getPeriodSaturday(date = new Date()) {
  const p = getViennaParts(date);
  const wallClock = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  const dayOfWeek = wallClock.getUTCDay();
  let daysUntilSaturday = (6 - dayOfWeek + 7) % 7;

  if (daysUntilSaturday === 0 && p.hour >= 18) {
    daysUntilSaturday = 7;
  }

  const saturday = new Date(Date.UTC(p.year, p.month - 1, p.day));
  saturday.setUTCDate(saturday.getUTCDate() + daysUntilSaturday);
  return saturday;
}

function formatPeriodLabel(date = new Date()) {
  const s = getPeriodSaturday(date);
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(s);
}

function setStatus(element, message, type) {
  element.textContent = message;
  element.className = 'message';
  if (type) {
    element.classList.add(type);
  }
}

function wireLoginForm({ form, message, emailInput, fixedEmail, submitButton, onSuccess }) {
  // Browsers only treat a submit button as the form's "default button" for
  // Enter-key implicit submission when it's a DOM descendant of the form -
  // not when it's merely associated via a form="..." attribute, which is
  // how submitButton is wired here (it lives in the page header). Without
  // this, Enter in the password field would silently do nothing.
  form.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    const email = fixedEmail || emailInput.value.trim();
    const password = form.querySelector('input[type="password"]').value;
    submitButton.disabled = true;

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitButton.disabled = false;

    if (error) {
      console.error('Supabase login error:', error);
      setStatus(message, 'Passwort ist falsch.', 'error');
      return;
    }

    form.reset();
    onSuccess();
  });
}

// Reagiert nicht nur auf den Session-Stand beim Laden, sondern auch auf
// spätere Änderungen (z. B. Logout über den Header-Button auf derselben
// Seite) - onAuthStateChange liefert den aktuellen Stand bereits beim
// Abonnieren, ein separater erster getSession()-Aufruf ist daher nicht
// nötig. Nur bei tatsächlichem Wechsel eingeloggt/ausgeloggt auslösen,
// damit z. B. ein Token-Refresh nicht jedes Mal die Seite neu lädt.
function requireSession(onAuthenticated, onAnonymous) {
  let lastHasSession = null;

  supabaseClient.auth.onAuthStateChange(function (_event, session) {
    const hasSession = Boolean(session);
    if (hasSession === lastHasSession) {
      return;
    }
    lastHasSession = hasSession;

    if (hasSession) {
      onAuthenticated(session);
    } else if (onAnonymous) {
      onAnonymous();
    }
  });
}

// Auf allen drei Seiten vorhanden (siehe shared.js-Einbindung) und zeigt
// je nach Session-Stand "Login"/"Logout". Ohne Login-Formular auf der
// aktuellen Seite (index.html, liste-drucken.html) führt "Login" auf
// admin-clients.html, wo das Formular liegt; ist eines vorhanden (auf
// admin-clients.html selbst), löst der Klick stattdessen dessen Absenden
// aus (requestSubmit() feuert das normale "submit"-Event, das
// wireLoginForm oben abonniert hat).
function wireHeaderAuthButton() {
  const button = document.getElementById('header-auth-button');

  if (!button) {
    return;
  }

  requireSession(
    function () {
      button.textContent = 'Logout';
    },
    function () {
      button.textContent = 'Login';
    }
  );

  button.addEventListener('click', async function (event) {
    // type="submit" + form="admin-login-form" (see markup) makes this the
    // form's default button purely so Enter in the password field submits
    // it too - always prevent the native submit here and decide explicitly
    // below, otherwise a real click would fire both this handler and a
    // duplicate native form submission.
    event.preventDefault();

    if (button.textContent === 'Logout') {
      button.disabled = true;
      await supabaseClient.auth.signOut();
      button.disabled = false;
      return;
    }

    const loginForm = document.getElementById('admin-login-form');
    if (loginForm) {
      loginForm.requestSubmit();
      return;
    }

    window.location.href = 'admin-clients.html';
  });
}

window.addEventListener('DOMContentLoaded', function () {
  wireHeaderAuthButton();
});
