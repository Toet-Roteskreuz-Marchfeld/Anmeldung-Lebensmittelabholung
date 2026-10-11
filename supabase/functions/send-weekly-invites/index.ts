// Wird montags per pg_cron aufgerufen (siehe README, Abschnitt
// "Automatisierung") und verschickt nur, wenn es in Wien gerade 9 Uhr ist
// (pg_cron läuft in UTC und startet deshalb um 07:00 und 08:00 UTC; je nach
// Sommer-/Winterzeit passt genau einer der beiden Aufrufe). Legt für jeden aktiven Klienten mit E-Mail-Adresse
// eine neue "invites"-Zeile mit einem frischen Token an (status 'offen')
// und schickt einen personalisierten Link mit genau diesem Token - je
// einen zum direkten Zusagen und einen zum direkten Absagen. Ein älterer
// Token aus einer vorigen Einladung wird damit automatisch ungültig, weil
// submit_attendance_by_token() nur den jeweils neuesten Token pro
// Familiennummer akzeptiert. Die Mail ist deutsch, ukrainisch und
// kroatisch/serbisch (lateinische Schrift) formuliert.
//
// Benötigte Secrets (per `supabase secrets set` gesetzt, siehe README):
//   RESEND_API_KEY - API-Key von resend.com
//   SITE_URL - Basis-URL der Seite:
//     https://www.toet-marchfeld.at
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

// Portiert von getPeriodSaturday()/formatPeriodLabel() in shared.js, damit
// diese Mail dasselbe "kommender Samstag" wie das Frontend und
// current_period_start() in Postgres anzeigt. Bewusst inline statt als
// gemeinsamer Import aus einer _shared-Datei: eine einzelne Datei pro
// Funktion lässt sich auch ohne Supabase CLI direkt im Dashboard-Editor
// anlegen. Bei einer Änderung der Perioden-Logik müssen alle Stellen
// (hier, send-summary/index.ts, shared.js, current_period_start()) synchron
// bleiben.
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

  if (daysUntilSaturday === 0 && p.hour >= 19) {
    daysUntilSaturday = 7;
  }

  const saturday = new Date(Date.UTC(p.year, p.month - 1, p.day));
  saturday.setUTCDate(saturday.getUTCDate() + daysUntilSaturday);
  return saturday;
}

function formatPeriodLabel(date: Date = new Date(), locale = 'de-DE') {
  const s = getPeriodSaturday(date);
  return new Intl.DateTimeFormat(locale, {
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

interface Client {
  nummer: number;
  name: string;
  email: string;
  gruppe: number | null;
}

async function sendInvite(client: Client, token: string, abholzeit: string | null) {
  const link = (wahl: 'ja' | 'nein') => `${SITE_URL}/antwort.html?token=${token}&wahl=${wahl}`;
  const de = formatPeriodLabel(new Date(), 'de-DE');
  const uk = formatPeriodLabel(new Date(), 'uk-UA');
  const hr = formatPeriodLabel(new Date(), 'hr-HR');

  const slot = (text: (g: number, t: string) => string) =>
    abholzeit && client.gruppe ? `<p>${text(client.gruppe, abholzeit)}</p>` : '';

  const html = `
    <div style="max-width:560px;font-family:Arial,Helvetica,sans-serif;line-height:1.5">
      <h3 style="margin-bottom:4px">Deutsch</h3>
      <p>Hallo ${client.name},</p>
      <p>kommst du zur Tafel-Ausgabe? Termin: <strong>${de}</strong></p>
      ${slot((g, t) => `Deine Gruppe: <strong>${g}</strong>, Abholzeit: <strong>${t} Uhr</strong>`)}
      <p>
        <a href="${link('ja')}">&#10004; Ja, ich komme</a><br />
        <a href="${link('nein')}">&#10008; Nein, ich komme nicht</a>
      </p>
      <hr />
      <h3 style="margin-bottom:4px">Українська</h3>
      <p>Доброго дня, ${client.name}!</p>
      <p>Чи прийдете ви на видачу продуктів Tafel? Дата: <strong>${uk}</strong></p>
      ${slot((g, t) => `Ваша група: <strong>${g}</strong>, час видачі: <strong>${t}</strong>`)}
      <p>
        <a href="${link('ja')}">&#10004; Так, я прийду</a><br />
        <a href="${link('nein')}">&#10008; Ні, я не прийду</a>
      </p>
      <hr />
      <h3 style="margin-bottom:4px">Hrvatski / Srpski</h3>
      <p>Dobar dan, ${client.name}!</p>
      <p>Dolazite li na podjelu namirnica (Tafel)? Termin: <strong>${hr}</strong></p>
      ${slot((g, t) => `Vaša grupa: <strong>${g}</strong>, termin preuzimanja: <strong>${t}</strong>`)}
      <p>
        <a href="${link('ja')}">&#10004; Da, dolazim</a><br />
        <a href="${link('nein')}">&#10008; Ne, ne dolazim</a>
      </p>
    </div>
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
      subject: `Tafel Marchfeld ${de} · ${uk} · ${hr}`,
      html
    })
  });

  if (!response.ok) {
    console.error(`Resend-Fehler für ${client.email}:`, await response.text());
  }
}

async function inviteClient(client: Client, abholzeiten: Map<number, string>) {
  const { data: invite, error } = await supabase
    .from('invites')
    .insert({ family_number: client.nummer })
    .select('token')
    .single();

  if (error || !invite) {
    console.error(`Konnte keine Einladung für Familie ${client.nummer} anlegen:`, error);
    return;
  }

  await sendInvite(client, invite.token, client.gruppe ? (abholzeiten.get(client.gruppe) ?? null) : null);
}

const SEND_HOUR_VIENNA = 9;

Deno.serve(async (req) => {
  // Nur um 9 Uhr Wiener Zeit verschicken (siehe Kopfkommentar). Zum Testen
  // außerhalb dieser Zeit: ?force=1 mit dem service_role-Key als Bearer-Token.
  const forced =
    new URL(req.url).searchParams.get('force') === '1' &&
    req.headers.get('Authorization') === `Bearer ${SERVICE_ROLE_KEY}`;

  if (!forced && getViennaParts().hour !== SEND_HOUR_VIENNA) {
    return new Response(JSON.stringify({ skipped: 'not 09:00 Europe/Vienna' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const [{ data: clients, error }, { data: gruppen, error: gruppenError }] = await Promise.all([
    supabase
      .from('clients')
      .select('nummer, name, email, gruppe')
      .eq('aktiv', true)
      .not('email', 'is', null),
    supabase.from('gruppen').select('nummer, abholzeit')
  ]);

  if (error || gruppenError) {
    console.error('Fehler beim Laden der Daten:', error ?? gruppenError);
    return new Response(JSON.stringify({ error: (error ?? gruppenError)?.message }), {
      status: 500
    });
  }

  // "18:30:00" -> "18:30"
  const abholzeiten = new Map<number, string>(
    (gruppen ?? []).map((g) => [g.nummer, String(g.abholzeit).slice(0, 5)])
  );

  await Promise.all((clients ?? []).map((c) => inviteClient(c as Client, abholzeiten)));

  return new Response(JSON.stringify({ sent: clients?.length ?? 0 }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
