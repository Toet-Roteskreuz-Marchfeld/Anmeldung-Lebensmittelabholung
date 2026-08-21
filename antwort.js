async function submitByToken() {
  const message = document.getElementById('antwort-message');

  if (!message) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const attendance = params.get('wahl');

  if (!token || !['ja', 'nein'].includes(attendance)) {
    setStatus(message, 'Ungültiger Link. Bitte benutze den Link aus der E-Mail.', 'error');
    return;
  }

  const { error } = await supabaseClient.rpc('submit_attendance_by_token', {
    p_token: token,
    p_attendance: attendance
  });

  if (error) {
    console.error('Supabase submit_attendance_by_token error:', error);
    setStatus(message, 'Fehler beim Speichern. Bitte versuche es erneut oder kontaktiere die Tafel.', 'error');
    return;
  }

  const label = attendance === 'ja' ? 'Du kommst.' : 'Du kommst nicht.';
  setStatus(message, `Deine Rückmeldung wurde gespeichert: ${label}`, 'success');
}

window.addEventListener('DOMContentLoaded', function () {
  submitByToken();
});
