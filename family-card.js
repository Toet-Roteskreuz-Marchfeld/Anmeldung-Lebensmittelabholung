// Familienkarte: ein A4-Blatt, zweiseitig bedruckt (Vorderseite/Rückseite),
// mit Schnittmarken um die zentrierte A6-Karte (105 x 148 mm), die danach
// laminiert wird. Vorne die Familiennummer samt Erwachsenen/Kindern, hinten
// Name, K-Nr. und der EAN als Strichcode zum Scannen bei der Ausgabe.
//
// Die Karte sitzt bewusst genau in der Blattmitte, damit Vorder- und
// Rückseite deckungsgleich liegen. Beim Drucken "beidseitig, Wenden an der
// langen Kante" wählen (Standard).

const CARD_WIDTH_MM = 105;
const CARD_HEIGHT_MM = 148;
const SHEET_WIDTH_MM = 210;
const SHEET_HEIGHT_MM = 297;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- EAN-8 / EAN-13 ----

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function isValidEan(code) {
  if (!/^([0-9]{8}|[0-9]{13})$/.test(code)) {
    return false;
  }

  let sum = 0;
  for (let i = code.length - 2; i >= 0; i--) {
    const weight = (code.length - 2 - i) % 2 === 0 ? 3 : 1;
    sum += Number(code[i]) * weight;
  }

  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

function eanModules(code) {
  const d = code.split('').map(Number);

  if (code.length === 8) {
    return (
      '101' +
      d.slice(0, 4).map((n) => EAN_L[n]).join('') +
      '01010' +
      d.slice(4).map((n) => EAN_R[n]).join('') +
      '101'
    );
  }

  const parity = EAN_PARITY[d[0]];
  return (
    '101' +
    d.slice(1, 7).map((n, i) => (parity[i] === 'L' ? EAN_L[n] : EAN_G[n])).join('') +
    '01010' +
    d.slice(7).map((n) => EAN_R[n]).join('') +
    '101'
  );
}

// Strichcode als skalierbares SVG samt Ziffern darunter und Ruhezone.
function eanToSvg(code) {
  const modules = eanModules(code);
  const quiet = 9;
  const barHeight = 58;
  const guardHeight = 64;
  const width = modules.length + quiet * 2;
  const isGuard = (i) =>
    i < 3 || i >= modules.length - 3 || (i >= modules.length / 2 - 2.5 && i < modules.length / 2 + 2.5);

  // Zusammenhängende schwarze Module zu einem Balken verschmelzen, damit
  // beim Skalieren keine feinen Lücken zwischen den Modulen aufblitzen.
  let bars = '';
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '0') {
      i++;
      continue;
    }

    const guard = isGuard(i);
    let end = i;
    while (end < modules.length && modules[end] === '1' && isGuard(end) === guard) {
      end++;
    }
    bars += `<rect x="${quiet + i}" y="0" width="${end - i}" height="${guard ? guardHeight : barHeight}" />`;
    i = end;
  }

  const textY = guardHeight + 11;
  const digit = (ch, x) => `<text x="${x}" y="${textY}" text-anchor="middle">${ch}</text>`;
  let digits = '';

  if (code.length === 13) {
    digits += digit(code[0], quiet / 2);
    for (let n = 0; n < 6; n++) {
      digits += digit(code[1 + n], quiet + 3 + 7 * n + 3.5);
      digits += digit(code[7 + n], quiet + 3 + 42 + 5 + 7 * n + 3.5);
    }
  } else {
    for (let n = 0; n < 4; n++) {
      digits += digit(code[n], quiet + 3 + 7 * n + 3.5);
      digits += digit(code[4 + n], quiet + 3 + 28 + 5 + 7 * n + 3.5);
    }
  }

  return `
    <svg class="card-barcode" viewBox="0 0 ${width} ${textY + 3}" xmlns="http://www.w3.org/2000/svg"
         shape-rendering="crispEdges" role="img" aria-label="EAN ${code}">
      <rect x="0" y="0" width="${width}" height="${textY + 3}" fill="#fff" />
      <g fill="#000">${bars}</g>
      <g fill="#000" font-family="Arial, Helvetica, sans-serif" font-size="10">${digits}</g>
    </svg>`;
}

// ---- Karte ----

function cropMarksSvg() {
  const x0 = (SHEET_WIDTH_MM - CARD_WIDTH_MM) / 2;
  const y0 = (SHEET_HEIGHT_MM - CARD_HEIGHT_MM) / 2;
  const x1 = x0 + CARD_WIDTH_MM;
  const y1 = y0 + CARD_HEIGHT_MM;
  const gap = 2;
  const len = 6;
  let lines = '';

  for (const x of [x0, x1]) {
    const dir = x === x0 ? -1 : 1;
    for (const y of [y0, y1]) {
      const vdir = y === y0 ? -1 : 1;
      // waagrechte Marke neben der Ecke, senkrechte Marke über/unter der Ecke
      lines += `<line x1="${x + dir * gap}" y1="${y}" x2="${x + dir * (gap + len)}" y2="${y}" />`;
      lines += `<line x1="${x}" y1="${y + vdir * gap}" x2="${x}" y2="${y + vdir * (gap + len)}" />`;
    }
  }

  return `
    <svg class="card-marks" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}"
         xmlns="http://www.w3.org/2000/svg" stroke="#000" stroke-width="0.25">${lines}</svg>`;
}

function buildFamilyCardHtml(client) {
  const nummer = escapeHtml(client.nummer);
  const kNr = client.k_nr != null ? escapeHtml(client.k_nr) : '&ndash;';

  return `
    <section class="card-sheet">
      ${cropMarksSvg()}
      <div class="card-face card-front">
        <div class="card-label">Familiennummer</div>
        <div class="card-number">${nummer}</div>
        <div class="card-counts">
          <div><strong>${escapeHtml(client.ew)}</strong> Erwachsene</div>
          <div><strong>${escapeHtml(client.ki)}</strong> Kinder</div>
        </div>
      </div>
    </section>
    <section class="card-sheet">
      ${cropMarksSvg()}
      <div class="card-face card-back">
        <div class="card-name">${escapeHtml(client.name)}</div>
        <div class="card-knr">K-Nr. <strong>${kNr}</strong></div>
        ${eanToSvg(client.ean)}
      </div>
    </section>`;
}

// Füllt den Druckbereich, setzt für den Druck Seitenrand 0 (damit die
// mm-genaue Positionierung stimmt) und räumt danach wieder auf.
function printFamilyCard(client) {
  const container = document.getElementById('card-print');
  container.innerHTML = buildFamilyCardHtml(client);

  const pageStyle = document.createElement('style');
  pageStyle.textContent = '@page { size: A4 portrait; margin: 0; }';
  document.head.appendChild(pageStyle);
  document.body.classList.add('printing-card');

  function cleanup() {
    window.removeEventListener('afterprint', cleanup);
    document.body.classList.remove('printing-card');
    pageStyle.remove();
    container.innerHTML = '';
  }

  window.addEventListener('afterprint', cleanup);
  window.print();
}
