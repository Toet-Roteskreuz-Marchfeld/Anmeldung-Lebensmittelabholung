function initClients() {
  const loginSection = document.getElementById('login-section');
  const clientsSection = document.getElementById('clients-section');
  const loginForm = document.getElementById('admin-login-form');
  const loginMessage = document.getElementById('login-message');
  const logoutButton = document.getElementById('clients-logout-button');
  const searchInput = document.getElementById('client-search');
  const newClientButton = document.getElementById('new-client-button');
  const clientForm = document.getElementById('client-form');
  const cancelButton = document.getElementById('client-cancel-button');
  const formMessage = document.getElementById('client-form-message');
  const clientsBody = document.getElementById('clients-body');

  if (!loginForm || !clientsSection) {
    return;
  }

  let clients = [];

  function showClients() {
    loginSection.classList.add('hidden');
    clientsSection.classList.remove('hidden');
    loadClients();
  }

  function showLogin() {
    clientsSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    loginForm.reset();
  }

  requireSession(showClients);

  wireLoginForm({
    form: loginForm,
    message: loginMessage,
    emailInput: document.getElementById('admin-email'),
    onSuccess: showClients
  });

  wireLogout(logoutButton, showLogin);

  function resetForm() {
    clientForm.reset();
    document.getElementById('client-id').value = '';
    clientForm.classList.add('hidden');
    setStatus(formMessage, '', null);
  }

  newClientButton.addEventListener('click', function () {
    resetForm();
    clientForm.classList.remove('hidden');
  });

  cancelButton.addEventListener('click', function () {
    resetForm();
  });

  function fillForm(client) {
    document.getElementById('client-id').value = client.id;
    document.getElementById('client-nummer').value = client.nummer;
    document.getElementById('client-name').value = client.name;
    document.getElementById('client-telefon').value = client.telefon ?? '';
    document.getElementById('client-email').value = client.email ?? '';
    document.getElementById('client-aktiv').checked = client.aktiv;
    document.getElementById('client-ew').value = client.ew;
    document.getElementById('client-ki').value = client.ki;
    document.getElementById('client-hund').value = client.hund;
    document.getElementById('client-katze').value = client.katze;
    document.getElementById('client-gf').checked = client.gf;
    document.getElementById('client-ep').checked = client.ep;
    document.getElementById('client-musl').checked = client.musl;
    document.getElementById('client-sonstiges').value = client.sonstiges ?? '';
    clientForm.classList.remove('hidden');
  }

  clientForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const id = document.getElementById('client-id').value;
    const payload = {
      nummer: Number(document.getElementById('client-nummer').value),
      name: document.getElementById('client-name').value.trim(),
      telefon: document.getElementById('client-telefon').value.trim() || null,
      email: document.getElementById('client-email').value.trim() || null,
      aktiv: document.getElementById('client-aktiv').checked,
      ew: Number(document.getElementById('client-ew').value) || 0,
      ki: Number(document.getElementById('client-ki').value) || 0,
      hund: Number(document.getElementById('client-hund').value) || 0,
      katze: Number(document.getElementById('client-katze').value) || 0,
      gf: document.getElementById('client-gf').checked,
      ep: document.getElementById('client-ep').checked,
      musl: document.getElementById('client-musl').checked,
      sonstiges: document.getElementById('client-sonstiges').value.trim() || null
    };

    const submitButton = clientForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    const { error } = id
      ? await supabaseClient.from('clients').update(payload).eq('id', id)
      : await supabaseClient.from('clients').insert(payload);

    submitButton.disabled = false;

    if (error) {
      console.error('Supabase clients save error:', error);
      setStatus(formMessage, 'Fehler beim Speichern. Sind Nummer oder E-Mail bereits vergeben?', 'error');
      return;
    }

    resetForm();
    await loadClients();
  });

  clientsBody.addEventListener('click', async function (event) {
    const editId = event.target.dataset.editId;
    const deleteId = event.target.dataset.deleteId;

    if (editId) {
      const client = clients.find((c) => String(c.id) === editId);
      if (client) {
        fillForm(client);
      }
      return;
    }

    if (deleteId) {
      const confirmed = window.confirm('Diesen Klienten wirklich löschen?');
      if (!confirmed) {
        return;
      }

      const { error } = await supabaseClient.from('clients').delete().eq('id', deleteId);

      if (error) {
        console.error('Supabase clients delete error:', error);
        return;
      }

      await loadClients();
    }
  });

  searchInput.addEventListener('input', function () {
    renderClients(filterClients(searchInput.value));
  });

  function filterClients(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      return clients;
    }
    return clients.filter(
      (c) =>
        String(c.nummer).includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.telefon || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
    );
  }

  function renderClients(list) {
    if (list.length === 0) {
      clientsBody.innerHTML = '<tr><td colspan="14">Keine Klienten gefunden.</td></tr>';
      return;
    }

    clientsBody.innerHTML = list
      .map(
        (c) => `
        <tr>
          <td>${c.nummer}</td>
          <td>${c.name}</td>
          <td>${c.telefon ?? ''}</td>
          <td>${c.email ?? ''}</td>
          <td>${c.aktiv ? 'Ja' : ''}</td>
          <td>${c.ew}</td>
          <td>${c.ki}</td>
          <td>${c.gf ? 'Ja' : ''}</td>
          <td>${c.ep ? 'Ja' : ''}</td>
          <td>${c.musl ? 'Ja' : ''}</td>
          <td>${c.hund}</td>
          <td>${c.katze}</td>
          <td>${c.sonstiges ?? ''}</td>
          <td class="row-actions">
            <button type="button" class="secondary small" data-edit-id="${c.id}">Bearbeiten</button>
            <button type="button" class="secondary small" data-delete-id="${c.id}">Löschen</button>
          </td>
        </tr>`
      )
      .join('');
  }

  async function loadClients() {
    const { data, error } = await supabaseClient
      .from('clients')
      .select('*')
      .order('nummer', { ascending: true });

    if (error) {
      console.error('Supabase clients load error:', error);
      clientsBody.innerHTML = '<tr><td colspan="14">Fehler beim Laden der Klienten.</td></tr>';
      return;
    }

    clients = data || [];
    renderClients(filterClients(searchInput.value));
  }
}

window.addEventListener('DOMContentLoaded', function () {
  initClients();
});
