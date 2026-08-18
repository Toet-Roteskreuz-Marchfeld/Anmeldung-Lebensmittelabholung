const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const LISTE_ACCOUNT_EMAIL = 'liste@toet-marchfeld.local';

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

function wireLoginForm({ form, message, emailInput, fixedEmail, onSuccess }) {
  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    const email = fixedEmail || emailInput.value.trim();
    const password = form.querySelector('input[type="password"]').value;
    const submitButton = form.querySelector('button[type="submit"]');
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

function requireSession(onAuthenticated, onAnonymous) {
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) {
      onAuthenticated(data.session);
    } else if (onAnonymous) {
      onAnonymous();
    }
  });
}

function wireLogout(button, onLoggedOut) {
  if (!button) {
    return;
  }

  button.addEventListener('click', async function () {
    await supabaseClient.auth.signOut();
    onLoggedOut();
  });
}
