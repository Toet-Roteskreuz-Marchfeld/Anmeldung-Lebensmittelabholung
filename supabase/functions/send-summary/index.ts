// Wird samstags per pg_cron aufgerufen (siehe README, Abschnitt
// "Automatisierung"). Fasst die aktuelle Ausgabeperiode zusammen - wer
// zugesagt, abgesagt oder noch nicht geantwortet hat - und schickt das
// Ergebnis an ORGANIZATOR_EMAIL.
//
// Für die benötigten Secrets siehe den Kommentar in
// send-weekly-invites/index.ts; diese Funktion nutzt zusätzlich
// ORGANIZATOR_EMAIL als Empfängeradresse.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formatPeriodLabel } from '../_shared/period.ts';

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
  const [{ data: clients, error: clientsError }, { data: responses, error: responsesError }] =
    await Promise.all([
      supabase.from('clients').select('nummer, name').eq('aktiv', true).not('email', 'is', null),
      // current_attendance_base ist auf public/anon/authenticated revoked,
      // aber nicht auf service_role - genau dafür ist die View gedacht
      // (siehe README-Kommentar "Interne Basis").
      supabase.from('current_attendance_base').select('family_number, attendance')
    ]);

  if (clientsError || responsesError) {
    console.error('Fehler beim Laden der Daten:', clientsError ?? responsesError);
    return new Response(JSON.stringify({ error: (clientsError ?? responsesError)?.message }), {
      status: 500
    });
  }

  const statusByNummer = new Map((responses ?? []).map((r) => [r.family_number, r.attendance]));

  const kommt: string[] = [];
  const kommtNicht: string[] = [];
  const offen: string[] = [];

  for (const client of clients ?? []) {
    const status = statusByNummer.get(client.nummer);
    if (status === 'ja') {
      kommt.push(client.name);
    } else if (status === 'nein') {
      kommtNicht.push(client.name);
    } else {
      offen.push(client.name);
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
