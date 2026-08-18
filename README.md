# Team Österreich Tafel Marchfeld – Anmeldung

Eine statische Webseite für die wöchentliche Anmeldung zur Team Österreich
Tafel-Ausgabe in der Region Marchfeld, deren Daten in einer Supabase-
Datenbank gespeichert werden (kostenloser Tarif, EU-Hosting möglich) –
dadurch sehen alle Familien und der Admin dieselben Daten, geräte- und
browserübergreifend.

- Familiennummer eingeben
- Ja/Nein zur Abholung bei der kommenden Tafel-Ausgabe am Samstag
- Admin-Bereich mit echtem Login (Supabase Auth)
- Ergebnisse werden automatisch nach Kalenderwoche gefiltert

## Dateien

- `index.html` – Formular für die Familien
- `admin.html` – login-geschützter Bereich mit Resultaten
- `styles.css` – Layout und Design
- `script.js` – Logik für Speicherung, Woche und Admin-Sicht
- `supabase-config.js` – Zugangsdaten zum eigenen Supabase-Projekt (URL + anon-Key)

## Supabase-Setup (einmalig)

1. Kostenloses Konto auf [supabase.com](https://supabase.com) anlegen und ein
   neues Projekt erstellen. Als Region **Frankfurt (eu-central-1)** wählen,
   damit die Daten in der EU liegen.
2. Im Projekt unter **SQL Editor** folgendes Skript ausführen, um die Tabelle
   und die Zugriffsregeln (Row Level Security) anzulegen:

   ```sql
   create table attendance (
     id bigint generated always as identity primary key,
     week_key text not null,
     family_number integer not null,
     attendance text not null check (attendance in ('ja', 'nein')),
     created_at timestamptz not null default now(),
     unique (week_key, family_number)
   );

   alter table attendance enable row level security;

   -- Nur eingeloggte Admins dürfen die Liste einsehen.
   create policy "only admins can view responses"
     on attendance for select
     to authenticated
     using (true);

   -- Nur eingeloggte Admins dürfen die Woche zurücksetzen.
   create policy "only admins can delete responses"
     on attendance for delete
     to authenticated
     using (true);

   -- Öffentliches Speichern/Aktualisieren läuft bewusst NICHT über eine
   -- INSERT/UPDATE-Policy für anon, sondern über diese Funktion:
   -- "INSERT ... ON CONFLICT DO UPDATE" (unser Upsert) verlangt von der
   -- ausführenden Rolle zusätzlich eine passende SELECT-Policy auf die
   -- betroffene Zeile (Postgres muss prüfen, ob es einen Konflikt gibt).
   -- Da anon absichtlich nichts lesen darf, würde ein direkter Upsert-Zugriff
   -- als anon immer an genau dieser Regel scheitern. Die Funktion läuft
   -- stattdessen mit den Rechten ihres Besitzers (security definer) und
   -- umgeht damit die RLS der Tabelle komplett, ist selbst aber auf genau
   -- diesen einen, klar begrenzten Vorgang beschränkt.
   create or replace function public.submit_attendance(
     p_week_key text,
     p_family_number integer,
     p_attendance text
   )
   returns void
   language plpgsql
   security definer
   set search_path = public
   as $$
   begin
     if p_attendance not in ('ja', 'nein') then
       raise exception 'invalid attendance value: %', p_attendance;
     end if;

     insert into attendance (week_key, family_number, attendance)
     values (p_week_key, p_family_number, p_attendance)
     on conflict (week_key, family_number)
     do update set attendance = excluded.attendance, created_at = now();
   end;
   $$;

   revoke all on function public.submit_attendance(text, integer, text) from public;
   grant execute on function public.submit_attendance(text, integer, text) to anon, authenticated;
   ```

3. Unter **Authentication → Users** einen Admin-Account per "Add user"
   anlegen (E-Mail + Passwort). Damit meldet man sich später in `admin.html`
   an. Es sind keine öffentlichen Registrierungen aktiviert – nur die von dir
   angelegten Nutzer können sich einloggen.
4. Unter **Settings → API** die **Project URL** und den **anon public key**
   kopieren und in `supabase-config.js` eintragen:

   ```js
   const SUPABASE_URL = 'https://dein-projekt.supabase.co';
   const SUPABASE_ANON_KEY = 'dein-anon-key';
   ```

   Der `anon`-Key ist bewusst öffentlich (er landet im Browser-Code) – der
   eigentliche Datenschutz kommt von den RLS-Regeln oben, **nicht** von der
   Geheimhaltung dieses Keys. Der `service_role`-Key darf dagegen niemals in
   den Frontend-Code oder ins Repository.

## GitHub Pages

1. Lade alle Dateien in ein GitHub-Repository hoch.
2. Aktiviere in GitHub unter Settings → Pages die Option "Deploy from a branch".
3. Wähle den Hauptbranch und den Ordner `/`.
4. Die Seite ist dann unter deiner GitHub-Page-URL verfügbar.

## Wochenlogik

Beim Speichern und Anzeigen wird immer der Schlüssel der aktuellen
Kalenderwoche (`week_key`) verwendet, da die Tafel-Ausgabe wöchentlich
stattfindet. Die Admin-Ansicht zeigt automatisch nur die Anmeldungen der
laufenden Woche; ein "Zurücksetzen" löscht nur die Datensätze dieser Woche,
alte Wochen bleiben in der Datenbank erhalten.

## Datenschutz

- Die Datenbank läuft (bei Wahl der Region Frankfurt) in der EU.
- Öffentlich kann nur eine Antwort abgegeben/aktualisiert werden – Lesen und
  Löschen ist ausschließlich eingeloggten Admin-Accounts vorbehalten.
- Es werden keine Namen gespeichert, nur Familiennummer, Antwort und
  Zeitstempel.
