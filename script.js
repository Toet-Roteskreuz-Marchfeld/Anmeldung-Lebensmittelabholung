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

window.addEventListener('DOMContentLoaded', function () {
  initForm();
});
