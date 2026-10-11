// Aktuelle Periode plus die drei davor (offset 0..3, siehe get_print_list()).
const PERIOD_OFFSETS = [0, 1, 2, 3];

let adminMode = false;
let listToken = null;
let selectedOffset = 0;
let gruppen = [];
const entriesByOffset = new Map();

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

function formatTime(time) {
  return String(time).slice(0, 5);
}

function periodTabLabel(offset) {
  const date = formatSaturday(getPeriodSaturdayForOffset(offset), {
    day: '2-digit',
    month: '2-digit'
  });
  return offset === 0 ? `Aktuell (${date}.)` : `Sa ${date}.`;
}

function periodLabelFor(offset) {
  return formatSaturday(getPeriodSaturdayForOffset(offset), {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// ---- Bildschirmansicht: eine Tabelle mit allen Zusagen ----

function renderRow(r) {
  return `
    <tr class="${r.gf ? 'gf-row' : ''}">
      <td class="col-nr">${r.family_number}</td>
      <td>${r.gruppe ?? ''}</td>
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
      <td colspan="2">Summe</td>
      <td class="col-ew">${sums.ew}</td>
      <td class="col-ki">${sums.ki}</td>
      <td>${sums.ep}</td>
      <td>${sums.musl}</td>
      <td>${sums.hund}</td>
      <td>${sums.katze}</td>
      <td></td>
    </tr>`;
}

function renderScreenTable(entries) {
  const printBody = document.getElementById('print-body');

  if (entries.length === 0) {
    printBody.innerHTML = '<tr><td colspan="9">Keine Anmeldungen in dieser Periode.</td></tr>';
    return;
  }

  printBody.innerHTML = entries.map(renderRow).join('') + renderSumRow(sumEntries(entries));
}

// ---- Druckansicht: die Gruppen nebeneinander (Abhakliste) ----

// Anteile der Spalten (Kästchen, Nr., Köpfe/Tiere) an der Gruppenbreite.
const GROUP_COL_FRACTIONS = [0.14, 0.24, 0.62];
const GROUP_COLORS = ['#c0392b', '#2a6fb5', '#2e6b4a', '#7a4fa0'];

function headcount(r) {
  const parts = [];
  if (r.ew) {
    parts.push(`${r.ew}E`);
  }
  if (r.ki) {
    parts.push(`${r.ki}K`);
  }
  return parts.join('/');
}

function petsLabel(r) {
  const parts = [];
  if (r.hund) {
    parts.push(`\u{1F415}${r.hund > 1 ? '×' + r.hund : ''}`);
  }
  if (r.katze) {
    parts.push(`\u{1F408}${r.katze > 1 ? '×' + r.katze : ''}`);
  }
  return parts.join(' ');
}

// Eine Tabellenzeile pro Listenposition, in der die i-te Familie jeder
// Gruppe nebeneinander steht. Eine einzige Tabelle bricht sauber über
// Seiten um (Kopfzeile wiederholt sich), anders als nebeneinander
// gestellte Einzeltabellen. Unter der letzten Familie jeder Gruppe steht
// deren Summe; unter Gruppe 1 zusätzlich die Legende.
function renderGroupTable(entries) {
  const table = document.getElementById('group-table');

  const columns = gruppen.map((g) => ({
    title: `${g.name.toUpperCase()} <span class="group-time">${formatTime(g.abholzeit)} Uhr</span>`,
    rows: entries.filter((e) => e.gruppe === g.nummer)
  }));

  const ungrouped = entries.filter((e) => !gruppen.some((g) => g.nummer === e.gruppe));
  if (ungrouped.length > 0) {
    columns.push({ title: 'OHNE GRUPPE', rows: ungrouped });
  }

  if (columns.length === 0) {
    table.innerHTML = '';
    return;
  }

  const attending = entries;
  const gfCount = attending.filter((e) => e.gf).length;
  const epCount = attending.filter((e) => !e.gf && e.ep).length;
  const legend = [
    ['', ''],
    [gfCount, 'GF'],
    [attending.length - gfCount - epCount, 'F'],
    [epCount, 'EP'],
    ['', ''],
    [attending.length, 'Gesamt']
  ];

  columns.forEach((c, index) => {
    const sums = sumEntries(c.rows);
    c.after = [['', `${sums.ew}E / ${sums.ki}K`]];
    if (index === 0) {
      c.after.push(...legend);
    }
  });

  const rowCount = Math.max(...columns.map((c) => c.rows.length + c.after.length));
  const bodyRows = [];

  for (let i = 0; i < rowCount; i++) {
    const cells = columns
      .map((c) => {
        const r = c.rows[i];
        if (r) {
          const pets = petsLabel(r);
          return `
            <td class="cb">&#9744;</td>
            <td class="nr${r.gf ? ' gf-cell' : ''}">${r.family_number}</td>
            <td class="hc">${headcount(r)}${pets ? ' ' + pets : ''}</td>`;
        }

        const extra = c.after[i - c.rows.length];
        if (extra) {
          return `<td class="free"></td><td class="free num">${extra[0]}</td><td class="free lbl">${extra[1]}</td>`;
        }
        return '<td class="free"></td><td class="free"></td><td class="free"></td>';
      })
      .join('<td class="gap-col"></td>');
    bodyRows.push(`<tr>${cells}</tr>`);
  }

  // Feste, gleiche Spaltenbreiten pro Gruppe (in Prozent der Seitenbreite).
  const gapPercent = 4;
  const share = (100 - gapPercent * (columns.length - 1)) / columns.length;
  const groupCols = GROUP_COL_FRACTIONS
    .map((f) => `<col style="width:${(share * f).toFixed(2)}%" />`)
    .join('');
  const colgroup = `<colgroup>${columns
    .map(() => groupCols)
    .join(`<col style="width:${gapPercent}%" />`)}</colgroup>`;

  const titleRow = columns
    .map(
      (c, i) =>
        `<th colspan="3" class="group-title" style="color:${GROUP_COLORS[i % GROUP_COLORS.length]}">${c.title}</th>`
    )
    .join('<th class="gap-col"></th>');

  table.innerHTML = `
    ${colgroup}
    <thead><tr>${titleRow}</tr></thead>
    <tbody>${bodyRows.join('')}</tbody>`;
}

// Alles soll auf eine A4-Seite passen: Hoch- oder Querformat je nach Anzahl
// der Zeilen, dazu eine Schriftskalierung (--print-scale). Gewählt wird das
// Format, in dem die Tabelle größer gedruckt werden kann. Maße in mm: Zeilen-
// höhe bei Skalierung 1 (11 pt) und der für Zeilen verfügbare Platz nach
// Abzug von Seitenrand, Kopfzeile, Gruppenüberschrift und Legende.
const ROW_MM = 6.2;
const AVAILABLE_MM = { portrait: 226, landscape: 139 };
const MIN_SCALE = 0.5;
// Im Querformat ist pro Gruppe mehr Breite da, daher darf die Schrift dort
// größer werden - bei wenigen Zusagen gewinnt so das Querformat.
const MAX_SCALE = { portrait: 1.3, landscape: 1.6 };

function fitPrintLayout(entries) {
  const counts = gruppen.map((g) => entries.filter((e) => e.gruppe === g.nummer).length);
  const ungrouped = entries.filter((e) => !gruppen.some((g) => g.nummer === e.gruppe)).length;
  if (ungrouped > 0) {
    counts.push(ungrouped);
  }

  // Zeilen inkl. Summenzeile; Gruppe 1 trägt zusätzlich die Legende (7 Zeilen).
  const rows = Math.max(1, ...counts.map((n, i) => n + (i === 0 ? 7 : 1)));
  const scaleFor = (orientation) =>
    Math.min(MAX_SCALE[orientation], AVAILABLE_MM[orientation] / (rows * ROW_MM));

  // Zusätzlich darf die Schrift nicht so groß werden, dass der längste Eintrag
  // ("2E/1K 🐕×2 🐈") nicht mehr in die Zelle passt. Breite in em geschätzt
  // (Emoji ~1,3 em, sonstige Zeichen ~0,6 em).
  const longestEm = Math.max(
    1,
    ...entries.map((r) => {
      const label = `${headcount(r)} ${petsLabel(r)}`.trim();
      return Array.from(label).reduce((sum, ch) => sum + (ch.codePointAt(0) > 0x2000 ? 1.3 : 0.6), 0);
    })
  );
  const widthScaleFor = (pageWidthMm) => {
    const groups = Math.max(1, counts.length);
    const groupMm = (pageWidthMm - 2 * 10 - 0.04 * pageWidthMm * (groups - 1)) / groups;
    const cellMm = groupMm * GROUP_COL_FRACTIONS[2] - 2.5;
    return cellMm / (longestEm * 11 * 0.3528);
  };

  const portrait = Math.min(scaleFor('portrait'), widthScaleFor(210));
  const landscape = Math.min(scaleFor('landscape'), widthScaleFor(297));
  const orientation = landscape > portrait * 1.05 ? 'landscape' : 'portrait';
  const scale = Math.max(MIN_SCALE, orientation === 'landscape' ? landscape : portrait);

  let style = document.getElementById('print-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: A4 ${orientation}; margin: 10mm 10mm 12mm; }`;
  document.documentElement.style.setProperty('--print-scale', scale.toFixed(3));
}

// ---- Laden & Tabs ----

async function loadGruppen() {
  const { data, error } = await supabaseClient
    .from('gruppen')
    .select('nummer, name, abholzeit')
    .order('nummer', { ascending: true });

  if (error) {
    throw error;
  }

  gruppen = data || [];
}

// Angemeldete Admins brauchen keinen Token, alle anderen den Link-Token aus
// der Mail (get_print_list prüft das serverseitig).
async function loadEntries(offset) {
  if (entriesByOffset.has(offset)) {
    return entriesByOffset.get(offset);
  }

  const { data, error } = await supabaseClient.rpc('get_print_list', {
    p_offset: offset,
    p_token: adminMode ? null : listToken
  });

  if (error) {
    throw error;
  }

  entriesByOffset.set(offset, data || []);
  return entriesByOffset.get(offset);
}

function renderTabs() {
  const tabs = document.getElementById('period-tabs');
  tabs.innerHTML = PERIOD_OFFSETS.map(
    (offset) => `
      <button type="button" role="tab" class="tab${offset === selectedOffset ? ' active' : ''}"
        aria-selected="${offset === selectedOffset}" data-offset="${offset}">
        ${periodTabLabel(offset)}
      </button>`
  ).join('');
}

// Kopfzeile der Druckansicht: Ausgabedatum der gewählten Periode und
// Druckzeitpunkt. Beim Druck (Button wie auch Strg+P) neu setzen, damit der
// Zeitstempel stimmt.
function updatePrintMeta() {
  document.getElementById('print-period').textContent = periodLabelFor(selectedOffset);
  document.getElementById('print-timestamp').textContent = new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Vienna'
  }).format(new Date());
}

async function selectPeriod(offset, onError) {
  selectedOffset = offset;
  renderTabs();
  document.getElementById('period-label').textContent = `Ausgabeliste für ${periodLabelFor(offset)}`;
  updatePrintMeta();

  try {
    const entries = await loadEntries(offset);
    // Falls inzwischen ein anderer Tab gewählt wurde, nichts überschreiben.
    if (offset !== selectedOffset) {
      return;
    }
    renderScreenTable(entries);
    renderGroupTable(entries);
    fitPrintLayout(entries);
  } catch (error) {
    console.error('Supabase get_print_list error:', error);
    onError();
  }
}

function initDrucken() {
  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');
  const printSection = document.getElementById('print-section');
  const printButton = document.getElementById('print-button');
  const tabs = document.getElementById('period-tabs');

  if (!printSection || !errorSection) {
    return;
  }

  function showError(message) {
    printSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    setStatus(errorMessage, message, 'error');
  }

  function showPrint() {
    errorSection.classList.add('hidden');
    printSection.classList.remove('hidden');
  }

  function onLoadError() {
    showError(
      adminMode
        ? 'Fehler beim Laden der Ausgabeliste.'
        : 'Dieser Link ist ungültig oder abgelaufen. Bitte warte auf die nächste E-Mail oder kontaktiere die Tafel.'
    );
  }

  async function start() {
    entriesByOffset.clear();
    try {
      await loadGruppen();
    } catch (error) {
      console.error('Supabase gruppen error:', error);
      onLoadError();
      return;
    }
    showPrint();
    await selectPeriod(0, onLoadError);
  }

  window.addEventListener('beforeprint', updatePrintMeta);

  tabs.addEventListener('click', function (event) {
    const button = event.target.closest('[data-offset]');
    if (button) {
      selectPeriod(Number(button.dataset.offset), onLoadError);
    }
  });

  listToken = new URLSearchParams(window.location.search).get('token');

  requireSession(
    function onAuthenticated() {
      adminMode = true;
      start();
    },
    function onAnonymous() {
      adminMode = false;
      if (!listToken) {
        showError('Ungültiger Link. Bitte benutze den Link aus der E-Mail.');
        return;
      }
      start();
    }
  );

  if (printButton) {
    printButton.addEventListener('click', function () {
      window.print();
    });
  }
}

window.addEventListener('DOMContentLoaded', function () {
  initDrucken();
});
