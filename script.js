const TABLE_NAME = 'attendance';

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

    const { error } = await supabaseClient.rpc('submit_attendance', {
      p_week_key: getPeriodKey(),
      p_family_number: Number(familyNumber),
      p_attendance: attendance.value
    });

    submitButton.disabled = false;

    if (error) {
      console.error('Supabase submit_attendance error:', error);
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

  weekLabel.textContent = `Anmeldungen für Samstag, ${formatPeriodLabel()}`;

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select('family_number, attendance, created_at')
    .eq('week_key', getPeriodKey())
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

  requireSession(showResults);

  wireLoginForm({
    form: loginForm,
    message: loginMessage,
    emailInput: document.getElementById('admin-email'),
    onSuccess: showResults
  });

  wireLogout(logoutButton, showLogin);
}

window.addEventListener('DOMContentLoaded', function () {
  initForm();
  initAdmin();
});
