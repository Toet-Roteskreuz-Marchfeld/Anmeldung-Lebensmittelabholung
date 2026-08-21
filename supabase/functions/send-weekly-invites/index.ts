// Wird freitags per pg_cron aufgerufen (siehe README, Abschnitt
// "Automatisierung"). Legt für jeden aktiven Klienten mit E-Mail-Adresse
// eine neue "invites"-Zeile mit einem frischen Token an (status 'offen')
// und schickt einen personalisierten Link mit genau diesem Token - je
// einen zum direkten Zusagen und einen zum direkten Absagen. Ein älterer
// Token aus einer vorigen Einladung wird damit automatisch ungültig, weil
// submit_attendance_by_token() nur den jeweils neuesten Token pro
// Familiennummer akzeptiert.
//
// Benötigte Secrets (per `supabase secrets set` gesetzt, siehe README):
//   RESEND_API_KEY - API-Key von resend.com
//   SITE_URL - Basis-URL der GitHub-Pages-Seite, z. B.
//     https://dein-username.github.io/toet-marchfeld
//   FROM_EMAIL - Absenderadresse; muss eine bei Resend verifizierte Domain
//     sein, sonst kann testweise "onboarding@resend.dev" verwendet werden
//     (liefert dann aber nur an die eigene Resend-Account-E-Mail aus)
//
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY sind in Edge Functions von
// Supabase automatisch als Umgebungsvariablen gesetzt, dafür ist kein
// eigenes Secret nötig. Der Service-Role-Key wird hier bewusst verwendet
// (nicht der anon-Key), weil die Funktion alle Klienten lesen und
// Einladungen anlegen muss - das darf laut RLS auf "clients"/"invites"
// sonst nur ein eingeloggter Admin.

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
}

async function sendInvite(client: Client, token: string, dateLabel: string) {
  const link = (wahl: 'ja' | 'nein') => `${SITE_URL}/antwort.html?token=${token}&wahl=${wahl}`;

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

async function inviteClient(client: Client, dateLabel: string) {
  const { data: invite, error } = await supabase
    .from('invites')
    .insert({ family_number: client.nummer })
    .select('token')
    .single();

  if (error || !invite) {
    console.error(`Konnte keine Einladung für Familie ${client.nummer} anlegen:`, error);
    return;
  }

  await sendInvite(client, invite.token, dateLabel);
}

Deno.serve(async () => {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('nummer, name, email')
    .eq('aktiv', true)
    .not('email', 'is', null);

  if (error) {
    console.error('Fehler beim Laden der Klienten:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const dateLabel = formatPeriodLabel();
  await Promise.all((clients ?? []).map((c) => inviteClient(c as Client, dateLabel)));

  return new Response(JSON.stringify({ sent: clients?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
