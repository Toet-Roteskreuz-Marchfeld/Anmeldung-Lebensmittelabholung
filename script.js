const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TABLE_NAME = 'attendance';

function getCurrentWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d;
}

function formatWeekLabel(date) {
  const start = getCurrentWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const format = (value) =>
    new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(value);

  return `${format(start)} - ${format(end)}`;
}

function getWeekKey(date = new Date()) {
  const d = getCurrentWeekStart(date);
  return d.toISOString().slice(0, 10);
}

function setStatus(element, message, type) {
  element.textContent = message;
  element.className = 'message';
  if (type) {
    element.classList.add(type);
  }
}

function initForm() {
  const form = document.getElementById('attendance-form');
  const message = document.getElementById('form-message');

  if (!form || !message) {
    return;
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    const familyNumber = document.getElementById('family-number').value.trim();
    const attendance = document.querySelector('input[name="attendance"]:checked');

    if (!familyNumber || !attendance) {
      setStatus(message, 'Bitte Familiennummer und Antwort eingeben.', 'error');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    const { error } = await supabaseClient
      .from(TABLE_NAME)
      .upsert(
        {
          week_key: getWeekKey(),
          family_number: Number(familyNumber),
          attendance: attendance.value
        },
        { onConflict: 'week_key,family_number', returning: 'minimal' }
      );

    submitButton.disabled = false;

    if (error) {
      console.error('Supabase upsert error:', error);
      setStatus(message, 'Fehler beim Speichern. Bitte versuche es erneut.', 'error');
      return;
    }

    form.reset();
    setStatus(message, 'Deine Antwort wurde gespeichert.', 'success');
  });
}

async function renderResults() {
  const resultsBody = document.getElementById('results-body');
  const weekLabel = document.getElementById('week-label');
  const totalCount = document.getElementById('total-count');
  const yesCount = document.getElementById('yes-count');
  const noCount = document.getElementById('no-count');

  if (!resultsBody || !weekLabel || !totalCount || !yesCount || !noCount) {
    return;
  }

  weekLabel.textContent = `Woche ${formatWeekLabel(new Date())}`;

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select('family_number, attendance, created_at')
    .eq('week_key', getWeekKey())
    .order('family_number', { ascending: true });

  if (error) {
    console.error('Supabase select error:', error);
    resultsBody.innerHTML = `
      <tr>
        <td colspan="3">Fehler beim Laden der Daten.</td>
      </tr>
    `;
    return;
  }

  const entries = data || [];

  totalCount.textContent = String(entries.length);
  yesCount.textContent = String(entries.filter((entry) => entry.attendance === 'ja').length);
  noCount.textContent = String(entries.filter((entry) => entry.attendance === 'nein').length);

  if (entries.length === 0) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="3">Noch keine Antworten für diese Woche.</td>
      </tr>
    `;
    return;
  }

  resultsBody.innerHTML = entries
    .map((entry) => {
      const statusLabel = entry.attendance === 'ja' ? 'Ja' : 'Nein';
      const statusClass = entry.attendance === 'ja' ? 'yes' : 'no';
      const createdAt = new Date(entry.created_at).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <tr>
          <td>${entry.family_number}</td>
          <td><span class="badge ${statusClass}">${statusLabel}</span></td>
          <td>${createdAt}</td>
        </tr>
      `;
    })
    .join('');
}

function initAdmin() {
  const loginSection = document.getElementById('login-section');
  const resultsSection = document.getElementById('results-section');
  const loginForm = document.getElementById('admin-login-form');
  const loginMessage = document.getElementById('login-message');
  const resetButton = document.getElementById('reset-week-button');
  const logoutButton = document.getElementById('logout-button');

  if (!loginForm || !loginMessage || !loginSection || !resultsSection) {
    return;
  }

  function showResults() {
    loginSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    renderResults();
  }

  function showLogin() {
    resultsSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    loginForm.reset();
  }

  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) {
      showResults();
    }
  });

  loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;

    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitButton.disabled = false;

    if (error) {
      console.error('Supabase login error:', error);
      setStatus(loginMessage, 'E-Mail oder Passwort ist falsch.', 'error');
      return;
    }

    showResults();
  });

  if (resetButton) {
    resetButton.addEventListener('click', async function () {
      const confirmed = window.confirm(
        'Willst du die aktuelle Woche wirklich zurücksetzen? Alle Antworten werden gelöscht.'
      );

      if (!confirmed) {
        return;
      }

      const { error } = await supabaseClient
        .from(TABLE_NAME)
        .delete()
        .eq('week_key', getWeekKey());

      if (error) {
        console.error('Supabase delete error:', error);
        setStatus(loginMessage, 'Fehler beim Zurücksetzen.', 'error');
        return;
      }

      await renderResults();
      setStatus(loginMessage, 'Die Anmeldeliste wurde für diese Woche zurückgesetzt.', 'success');
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async function () {
      await supabaseClient.auth.signOut();
      showLogin();
    });
  }
}

window.addEventListener('DOMContentLoaded', function () {
  initForm();
  initAdmin();
});
