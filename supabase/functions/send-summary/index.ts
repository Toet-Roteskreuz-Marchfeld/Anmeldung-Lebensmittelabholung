// Wird samstags per pg_cron aufgerufen (siehe README, Abschnitt
// "Automatisierung"). Fasst die Einladungen der aktuellen Ausgabeperiode
// zusammen - wer zugesagt, abgesagt oder noch nicht geantwortet hat - und
// schickt das Ergebnis an alle Organisatoren. Liest direkt aus "invites"
// (dort steht der Status ohnehin schon aktuell, angelegt von
// send-weekly-invites), nicht aus "attendance". Die Zusagen kommen als
// Tabelle mit den Haushaltsdaten aus "clients" (wie die gedruckte
// Ausgabeliste, hier zusätzlich mit Namen - diese Mail geht nur an die
// Organisatoren, nicht an die Listen-Betrachter).
//
// Verschickt zusätzlich an jeden Listen-Betrachter (Tabelle
// "mail_recipients", kind = 'list_viewer') einen personalisierten,
// 14 Tage gültigen Link auf die Ausgabeliste (liste-drucken.html?token=...)
// statt des früheren gemeinsamen Listen-Kontos - siehe
// get_print_list_by_token() im README. Jeder Empfänger bekommt einen
// eigenen Token, damit sich ein veröffentlichter/geleakter Token im
// Nachhinein einer Person zuordnen lässt.
//
// Empfänger (Organisatoren wie Listen-Betrachter) stehen bewusst in der
// Tabelle "mail_recipients" statt in einem Secret: Secrets sind in Supabase
// write-only (nicht mehr einsehbar, sobald gesetzt), damit ungeeignet für
// eine Liste, die sich ändert. Jede Mail geht einzeln raus (eigenes "to"
// pro Empfänger), nie mit mehreren Adressen im selben "to"-Feld.
//
// Für die übrigen benötigten Secrets siehe den Kommentar in
// send-weekly-invites/index.ts; diese Funktion nutzt zusätzlich SITE_URL
// für die Listen-Links.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Portiert von getPeriodSaturday()/formatPeriodLabel() in shared.js, damit
// diese Mail dasselbe "kommender Samstag" wie das Frontend und
// current_period_start() in Postgres anzeigt. Bewusst inline statt als
// gemeinsamer Import aus einer _shared-Datei: eine einzelne Datei pro
// Funktion lässt sich auch ohne Supabase CLI direkt im Dashboard-Editor
// anlegen. Bei einer Änderung der Perioden-Logik müssen alle Stellen
// (hier, send-weekly-invites/index.ts, shared.js, current_period_start())
// synchron bleiben.
function getViennaParts(date: Date = new Date()) {
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

  const parts: Record<string, number> = {};
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

function getPeriodSaturday(date: Date = new Date()) {
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

function formatPeriodLabel(date: Date = new Date()) {
  const s = getPeriodSaturday(date);
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(s);
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SITE_URL = Deno.env.get('SITE_URL')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendMail(to: string, subject: string, html: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
  });

  if (!response.ok) {
    console.error(`Resend-Fehler für ${to}:`, await response.text());
    return false;
  }

  return true;
}

interface ClientRow {
  nummer: number;
  name: string;
  ew: number;
  ki: number;
  gf: boolean;
  ep: boolean;
  musl: boolean;
  hund: number;
  katze: number;
  sonstiges: string | null;
}

function renderSection(title: string, names: string[]) {
  const items = names.length
    ? names.map((n) => `<li>${n}</li>`).join('')
    : '<li><em>-</em></li>';
  return `<h3>${title} (${names.length})</h3><ul>${items}</ul>`;
}

function renderKommtTable(rows: ClientRow[]) {
  if (!rows.length) {
    return '<h3>Kommt (0)</h3><p><em>-</em></p>';
  }

  const sums = rows.reduce(
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

  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td>${r.nummer}</td>
        <td>${r.name}</td>
        <td>${r.ew}</td>
        <td>${r.ki}</td>
        <td>${r.gf ? 'Ja' : ''}</td>
        <td>${r.ep ? 'Ja' : ''}</td>
        <td>${r.musl ? 'Ja' : ''}</td>
        <td>${r.hund}</td>
        <td>${r.katze}</td>
        <td>${r.sonstiges ?? ''}</td>
      </tr>`
    )
    .join('');

  return `
    <h3>Kommt (${rows.length})</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead>
        <tr>
          <th>Nr.</th><th>Name</th><th>EW</th><th>Ki</th><th>GF</th><th>EP</th>
          <th>Musl.</th><th>Hund</th><th>Katze</th><th>Sonstiges</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr>
          <td colspan="2"><strong>Summe</strong></td>
          <td><strong>${sums.ew}</strong></td>
          <td><strong>${sums.ki}</strong></td>
          <td></td>
          <td><strong>${sums.ep}</strong></td>
          <td><strong>${sums.musl}</strong></td>
          <td><strong>${sums.hund}</strong></td>
          <td><strong>${sums.katze}</strong></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `;
}

Deno.serve(async () => {
  // Dieselbe Grenze wie current_attendance_base/print_list, statt die
  // Vienna-Wochenlogik hier ein drittes Mal nachzubauen.
  const { data: periodStart, error: periodStartError } = await supabase.rpc('current_period_start');

  if (periodStartError) {
    console.error('Fehler beim Laden der aktuellen Periode:', periodStartError);
    return new Response(JSON.stringify({ error: periodStartError.message }), { status: 500 });
  }

  const [{ data: invites, error: invitesError }, { data: clients, error: clientsError }] =
    await Promise.all([
      supabase.from('invites').select('family_number, status').gte('created_at', periodStart),
      supabase.from('clients').select('nummer, name, ew, ki, gf, ep, musl, hund, katze, sonstiges')
    ]);

  if (invitesError || clientsError) {
    console.error('Fehler beim Laden der Daten:', invitesError ?? clientsError);
    return new Response(JSON.stringify({ error: (invitesError ?? clientsError)?.message }), {
      status: 500
    });
  }

  const clientByNummer = new Map((clients ?? []).map((c) => [c.nummer, c as ClientRow]));

  const kommt: ClientRow[] = [];
  const kommtNicht: string[] = [];
  const offen: string[] = [];

  for (const invite of invites ?? []) {
    const client = clientByNummer.get(invite.family_number);
    const name = client?.name ?? `Familie ${invite.family_number}`;

    if (invite.status === 'ja') {
      kommt.push(
        client ?? {
          nummer: invite.family_number,
          name,
          ew: 0,
          ki: 0,
          gf: false,
          ep: false,
          musl: false,
          hund: 0,
          katze: 0,
          sonstiges: null
        }
      );
    } else if (invite.status === 'nein') {
      kommtNicht.push(name);
    } else {
      offen.push(name);
    }
  }

  const dateLabel = formatPeriodLabel();
  const organizerHtml = `
    <h2>Ausgabeliste für ${dateLabel}</h2>
    ${renderKommtTable(kommt)}
    ${renderSection('Kommt nicht', kommtNicht)}
    ${renderSection('Keine Rückmeldung', offen)}
  `;

  const { data: recipients, error: recipientsError } = await supabase
    .from('mail_recipients')
    .select('email, kind');

  if (recipientsError) {
    console.error('Fehler beim Laden der Empfänger:', recipientsError);
    return new Response(JSON.stringify({ error: recipientsError.message }), { status: 500 });
  }

  const organizers = (recipients ?? []).filter((r) => r.kind === 'organizer');
  const listViewers = (recipients ?? []).filter((r) => r.kind === 'list_viewer');

  const organizerResults = await Promise.all(
    organizers.map((r) =>
      sendMail(r.email, `Ausgabeliste ${dateLabel}: ${kommt.length} Zusagen`, organizerHtml)
    )
  );

  const listViewerResults = await Promise.all(
    listViewers.map(async (r) => {
      const { data: tokenRow, error: tokenError } = await supabase
        .from('list_view_tokens')
        .insert({ email: r.email })
        .select('token')
        .single();

      if (tokenError || !tokenRow) {
        console.error(`Konnte keinen Listen-Token für ${r.email} anlegen:`, tokenError);
        return false;
      }

      const link = `${SITE_URL}/liste-drucken.html?token=${tokenRow.token}`;
      const html = `
        <p>Ausgabeliste für ${dateLabel}:</p>
        <p><a href="${link}">${link}</a></p>
        <p>Dieser Link ist 14 Tage gültig und zeigt immer den aktuellen Stand.</p>
      `;

      return sendMail(r.email, `Ausgabeliste ${dateLabel}`, html);
    })
  );

  return new Response(
    JSON.stringify({
      kommt: kommt.length,
      kommtNicht: kommtNicht.length,
      offen: offen.length,
      organizerMailsSent: organizerResults.filter(Boolean).length,
      listViewerMailsSent: listViewerResults.filter(Boolean).length
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
