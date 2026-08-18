function chunkIntoGroups(items, groupCount = 3) {
  const size = Math.ceil(items.length / groupCount);
  return Array.from({ length: groupCount }, (_, i) => items.slice(i * size, (i + 1) * size));
}

function sumGroup(rows) {
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

function renderGroupTable(rows) {
  const sums = sumGroup(rows);
  const body = rows
    .map(
      (r) => `
      <tr>
        <td class="col-nr${r.gf ? ' gf-highlight' : ''}">${r.family_number}</td>
        <td class="col-ew">${r.ew ?? ''}</td>
        <td class="col-ki">${r.ki ?? ''}</td>
        <td>${r.ep ? 'Ja' : ''}</td>
        <td>${r.musl ? 'Ja' : ''}</td>
        <td>${r.hund ?? ''}</td>
        <td>${r.katze ?? ''}</td>
        <td>${r.sonstiges ?? ''}</td>
      </tr>`
    )
    .join('');

  return `<table>
    <thead>
      <tr><th>Nr.</th><th>EW</th><th>Ki</th><th>EP</th><th>Musl.</th><th>Hund</th><th>Katze</th><th>Sonst.</th></tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr class="sum-row">
        <td>Summe</td>
        <td class="col-ew">${sums.ew}</td>
        <td class="col-ki">${sums.ki}</td>
        <td>${sums.ep}</td>
        <td>${sums.musl}</td>
        <td>${sums.hund}</td>
        <td>${sums.katze}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>`;
}

async function loadPrintList() {
  const printGroups = document.getElementById('print-groups');
  const periodLabel = document.getElementById('period-label');

  periodLabel.textContent = `Ausgabeliste für Samstag, ${formatPeriodLabel()}`;

  const { data, error } = await supabaseClient
    .from('print_list')
    .select('family_number, ew, ki, gf, ep, musl, hund, katze, sonstiges')
    .eq('week_key', getPeriodKey())
    .order('family_number', { ascending: true });

  if (error) {
    console.error('Supabase print_list error:', error);
    printGroups.innerHTML = '<p>Fehler beim Laden der Ausgabeliste.</p>';
    return;
  }

  const entries = data || [];

  if (entries.length === 0) {
    printGroups.innerHTML = '<p>Noch keine Anmeldungen für diese Woche.</p>';
    return;
  }

  const groups = chunkIntoGroups(entries, 3);
  printGroups.innerHTML = groups.map(renderGroupTable).join('');
}

function initDrucken() {
  const printButton = document.getElementById('print-button');
  const logoutButton = document.getElementById('liste-logout-button');

  if (!document.getElementById('print-groups')) {
    return;
  }

  requireSession(loadPrintList, function () {
    window.location.href = 'liste.html';
  });

  if (printButton) {
    printButton.addEventListener('click', function () {
      window.print();
    });
  }

  wireLogout(logoutButton, function () {
    window.location.href = 'liste.html';
  });
}

window.addEventListener('DOMContentLoaded', function () {
  initDrucken();
});
