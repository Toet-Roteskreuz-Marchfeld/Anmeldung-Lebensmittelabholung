// Wird samstags per pg_cron aufgerufen (siehe README, Abschnitt
// "Automatisierung"). Fasst die Einladungen der aktuellen Ausgabeperiode
// zusammen - wer zugesagt, abgesagt oder noch nicht geantwortet hat - und
// schickt das Ergebnis an ORGANIZATOR_EMAIL. Liest direkt aus "invites"
// (dort steht der Status ohnehin schon aktuell, angelegt von
// send-weekly-invites), nicht aus "attendance".
//
// Für die benötigten Secrets siehe den Kommentar in
// send-weekly-invites/index.ts; diese Funktion nutzt zusätzlich
// ORGANIZATOR_EMAIL als Empfängeradresse.

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
const ORGANIZATOR_EMAIL = Deno.env.get('ORGANIZATOR_EMAIL')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function renderSection(title: string, names: string[]) {
  const items = names.length
    ? names.map((n) => `<li>${n}</li>`).join('')
    : '<li><em>-</em></li>';
  return `<h3>${title} (${names.length})</h3><ul>${items}</ul>`;
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
      supabase.from('clients').select('nummer, name')
    ]);

  if (invitesError || clientsError) {
    console.error('Fehler beim Laden der Daten:', invitesError ?? clientsError);
    return new Response(JSON.stringify({ error: (invitesError ?? clientsError)?.message }), {
      status: 500
    });
  }

  const nameByNummer = new Map((clients ?? []).map((c) => [c.nummer, c.name]));

  const kommt: string[] = [];
  const kommtNicht: string[] = [];
  const offen: string[] = [];

  for (const invite of invites ?? []) {
    const name = nameByNummer.get(invite.family_number) ?? `Familie ${invite.family_number}`;
    if (invite.status === 'ja') {
      kommt.push(name);
    } else if (invite.status === 'nein') {
      kommtNicht.push(name);
    } else {
      offen.push(name);
    }
  }

  const dateLabel = formatPeriodLabel();
  const html = `
    <h2>Ausgabeliste für ${dateLabel}</h2>
    ${renderSection('Kommt', kommt)}
    ${renderSection('Kommt nicht', kommtNicht)}
    ${renderSection('Keine Rückmeldung', offen)}
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ORGANIZATOR_EMAIL],
      subject: `Ausgabeliste ${dateLabel}: ${kommt.length} Zusagen`,
      html
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Resend-Fehler:', text);
    return new Response(JSON.stringify({ error: text }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ kommt: kommt.length, kommtNicht: kommtNicht.length, offen: offen.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
