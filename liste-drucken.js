function sumEntries(rows) {
  return rows.reduce(
    (acc, r) => ({
      ew: acc.ew + (r.ew || 0),
      ki: acc.ki + (r.ki || 0),
      hund: acc.hund + (r.hund || 0),
      katze: acc.katze + (r.katze || 0),
      ep: acc.ep + (r.ep ? 1 : 0),
      musl: acc.musl + (r.musl ? 1 : 0)
    }),
    { ew: 0, ki: 0, hund: 0, katze: 0, ep: 0, musl: 0 }
  );
}

function renderRow(r) {
  return `
    <tr>
      <td class="col-nr${r.gf ? ' gf-highlight' : ''}">${r.family_number}</td>
      <td class="col-ew">${r.ew ?? ''}</td>
      <td class="col-ki">${r.ki ?? ''}</td>
      <td>${r.ep ? 'Ja' : ''}</td>
      <td>${r.musl ? 'Ja' : ''}</td>
      <td>${r.hund ?? ''}</td>
      <td>${r.katze ?? ''}</td>
      <td>${r.sonstiges ?? ''}</td>
    </tr>`;
}

function renderSumRow(sums) {
  return `
    <tr class="sum-row">
      <td>Summe</td>
      <td class="col-ew">${sums.ew}</td>
      <td class="col-ki">${sums.ki}</td>
      <td>${sums.ep}</td>
      <td>${sums.musl}</td>
      <td>${sums.hund}</td>
      <td>${sums.katze}</td>
      <td></td>
    </tr>`;
}

async function loadPrintList(token) {
  const printBody = document.getElementById('print-body');
  const periodLabel = document.getElementById('period-label');

  periodLabel.textContent = `Ausgabeliste für ${formatPeriodLabel()}`;

  const { data, error } = await supabaseClient.rpc('get_print_list_by_token', {
    p_token: token
  });

  if (error) {
    throw error;
  }

  const entries = data || [];

  if (entries.length === 0) {
    printBody.innerHTML = '<tr><td colspan="8">Noch keine Anmeldungen für diese Woche.</td></tr>';
    return;
  }

  printBody.innerHTML = entries.map(renderRow).join('') + renderSumRow(sumEntries(entries));
}

function initDrucken() {
  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');
  const printSection = document.getElementById('print-section');
  const printButton = document.getElementById('print-button');

  if (!printSection || !errorSection) {
    return;
  }

  function showError(message) {
    printSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    setStatus(errorMessage, message, 'error');
  }

  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    showError('Ungültiger Link. Bitte benutze den Link aus der E-Mail.');
    return;
  }

  loadPrintList(token)
    .then(function () {
      printSection.classList.remove('hidden');
    })
    .catch(function (error) {
      console.error('Supabase get_print_list_by_token error:', error);
      showError('Dieser Link ist ungültig oder abgelaufen. Bitte warte auf die nächste E-Mail oder kontaktiere die Tafel.');
    });

  if (printButton) {
    printButton.addEventListener('click', function () {
      window.print();
    });
  }
}

window.addEventListener('DOMContentLoaded', function () {
  initDrucken();
});
