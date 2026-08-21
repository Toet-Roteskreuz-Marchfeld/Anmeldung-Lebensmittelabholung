// Wird freitags per pg_cron aufgerufen (siehe README, Abschnitt
// "Automatisierung"). Lädt alle aktiven Klienten mit E-Mail-Adresse und
// schickt jedem einen personalisierten Link mit seinem/ihrem Token - je
// einen zum direkten Zusagen und einen zum direkten Absagen.
//
// Benötigte Secrets (per `supabase secrets set` gesetzt, siehe README):
//   RESEND_API_KEY - API-Key von resend.com
//   ORGANIZATOR_EMAIL - wird von dieser Funktion nicht verwendet, aber von
//     send-summary; beide Secrets werden zusammen gesetzt
//   SITE_URL - Basis-URL der GitHub-Pages-Seite, z. B.
//     https://dein-username.github.io/toet-marchfeld
//   FROM_EMAIL - Absenderadresse; muss eine bei Resend verifizierte Domain
//     sein, sonst kann testweise "onboarding@resend.dev" verwendet werden
//     (liefert dann aber nur an die eigene Resend-Account-E-Mail aus)
//
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY sind in Edge Functions von
// Supabase automatisch als Umgebungsvariablen gesetzt, dafür ist kein
// eigenes Secret nötig. Der Service-Role-Key wird hier bewusst verwendet
// (nicht der anon-Key), weil die Funktion alle Klienten lesen muss - das
// darf laut RLS auf "clients" sonst nur ein eingeloggter Admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formatPeriodLabel } from '../_shared/period.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SITE_URL = Deno.env.get('SITE_URL')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface Client {
  nummer: number;
  name: string;
  email: string;
  token: string;
}

async function sendInvite(client: Client, dateLabel: string) {
  const link = (wahl: 'ja' | 'nein') =>
    `${SITE_URL}/antwort.html?token=${client.token}&wahl=${wahl}`;

  const html = `
    <p>Hallo ${client.name},</p>
    <p>kommst du am <strong>${dateLabel}</strong> zur Tafel-Ausgabe?</p>
    <p>
      <a href="${link('ja')}">Ja, ich komme</a>
      &nbsp;|&nbsp;
      <a href="${link('nein')}">Nein, ich komme nicht</a>
    </p>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [client.email],
      subject: `Kommst du am ${dateLabel}?`,
      html
    })
  });

  if (!response.ok) {
    console.error(`Resend-Fehler für ${client.email}:`, await response.text());
  }
}

Deno.serve(async () => {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('nummer, name, email, token')
    .eq('aktiv', true)
    .not('email', 'is', null);

  if (error) {
    console.error('Fehler beim Laden der Klienten:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const dateLabel = formatPeriodLabel();
  await Promise.all((clients ?? []).map((c) => sendInvite(c as Client, dateLabel)));

  return new Response(JSON.stringify({ sent: clients?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
