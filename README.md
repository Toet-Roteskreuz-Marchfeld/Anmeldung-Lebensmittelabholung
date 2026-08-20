# Team Österreich Tafel Marchfeld – Anmeldung

Eine statische Webseite für die wöchentliche Anmeldung zur Team Österreich
Tafel-Ausgabe in der Region Marchfeld, deren Daten in einer Supabase-
Datenbank gespeichert werden (kostenloser Tarif, EU-Hosting möglich) –
dadurch sehen alle Familien und der Admin dieselben Daten, geräte- und
browserübergreifend.

- Familiennummer eingeben
- Ja/Nein zur Abholung bei der kommenden Tafel-Ausgabe am Samstag
- Admin-Bereich mit echtem Login (Supabase Auth), inkl. Klientenverwaltung
- Listen-Gruppe mit gemeinsamem Passwort für eine druckbare Ausgabeliste
- Ergebnisse werden automatisch nach der aktuellen Ausgabeperiode gefiltert

## Dateien

- `index.html` – Formular für die Familien
- `admin-clients.html` / `admin-clients.js` – login-geschützte Klientenverwaltung (Admin-Bereich)
- `liste-drucken.html` / `liste-drucken.js` – login-geschützte, druckbare Ausgabeliste für die Listen-Gruppe
- `styles.css` – Layout und Design
- `shared.js` – gemeinsame Logik für alle Seiten (Supabase-Client, Perioden-Berechnung, Login-Helfer)
- `script.js` – Logik für die öffentliche Anmeldung
- `supabase-config.js` – Zugangsdaten zum eigenen Supabase-Projekt (URL + anon-Key)

## Supabase-Setup (einmalig)

1. Kostenloses Konto auf [supabase.com](https://supabase.com) anlegen und ein
   neues Projekt erstellen. Als Region **Frankfurt (eu-central-1)** wählen,
   damit die Daten in der EU liegen.
2. Im Projekt unter **SQL Editor** folgendes Skript ausführen, um die Tabelle
   und die Zugriffsregeln (Row Level Security) anzulegen:

   ```sql
   -- Kein week_key: zu welcher Ausgabeperiode eine Zeile gehört, wird bei
   -- jeder Abfrage aus created_at berechnet (siehe current_period_start()
   -- weiter unten). Auch kein unique(family_number) - mehrfache An-/
   -- Abmeldungen pro Familie sind erlaubt, die neueste zählt.
   create table attendance (
     id bigint generated always as identity primary key,
     family_number integer not null,
     attendance text not null check (attendance in ('ja', 'nein')),
     created_at timestamptz not null default now()
   );

   alter table attendance enable row level security;

   -- Nur eingeloggte Admins dürfen die Liste einsehen.
   create policy "only admins can view responses"
     on attendance for select
     to authenticated
     using (true);

   -- Nur eingeloggte Admins dürfen Anmeldungen löschen.
   create policy "only admins can delete responses"
     on attendance for delete
     to authenticated
     using (true);

   -- Öffentliches Speichern läuft bewusst NICHT über eine INSERT-Policy für
   -- anon, sondern über diese Funktion: ein direkter anon-Insert über die
   -- Data API scheiterte an einem Supabase-Plattformproblem. Die Funktion
   -- läuft stattdessen mit den Rechten ihres Besitzers (security definer)
   -- und umgeht damit die RLS der Tabelle, ist selbst aber auf genau diesen
   -- einen, klar begrenzten Vorgang beschränkt. Es ist immer ein reines
   -- INSERT (kein Upsert) - mehrfache An-/Abmeldungen sind erlaubt.
   create or replace function public.submit_attendance(
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

     insert into attendance (family_number, attendance)
     values (p_family_number, p_attendance);
   end;
   $$;

   revoke all on function public.submit_attendance(integer, text) from public;
   grant execute on function public.submit_attendance(integer, text) to anon, authenticated;
   ```

3. Im selben **SQL Editor** zusätzlich folgendes Skript ausführen, um die
   Klientenverwaltung, die Rollentrennung zwischen Admin und Listen-Gruppe
   sowie die Ausgabeliste anzulegen:

   ```sql
   -- Vom Admin gepflegte Klientenregistry. Bewusst ohne Foreign Key zur
   -- "attendance"-Tabelle: die öffentliche Anmeldung akzeptiert weiterhin
   -- jede Nummer, ohne gegen diese Liste zu prüfen.
   create table clients (
     id bigint generated always as identity primary key,
     nummer integer not null,
     name text not null,
     telefon text,
     ew integer not null default 0,
     ki integer not null default 0,
     gf boolean not null default false,
     ep boolean not null default false,
     musl boolean not null default false,
     hund integer not null default 0,
     katze integer not null default 0,
     sonstiges text,
     created_at timestamptz not null default now()
   );

   -- Verhindert, dass eine doppelt vergebene Nummer die Ausgabeliste per
   -- JOIN verdoppelt.
   create unique index clients_nummer_key on clients (nummer);
   alter table clients enable row level security;

   -- Admin und Listen-Gruppe sind beide normale Supabase-Auth-Nutzer ohne
   -- eigene Rollen/Claims. Die E-Mail ist das einzige Unterscheidungsmerkmal.
   -- "Admin" = jeder eingeloggte Nutzer außer dem Listen-Account, damit ein
   -- zweiter echter Admin-Account später ohne SQL-Änderung funktioniert.
   create or replace function public.is_list_account()
   returns boolean
   language sql stable
   set search_path = public, auth
   as $$
     select coalesce(auth.email(), '') = 'liste@toet-marchfeld.local';
   $$;

   create or replace function public.is_admin_account()
   returns boolean
   language sql stable
   set search_path = public, auth
   as $$
     select auth.role() = 'authenticated' and not public.is_list_account();
   $$;

   grant execute on function public.is_list_account() to authenticated;
   grant execute on function public.is_admin_account() to authenticated;

   -- Nur Admins dürfen Klienten verwalten. Weder anon noch die
   -- Listen-Gruppe bekommen hier jemals Zugriff.
   create policy "only admins can view clients"
     on clients for select
     to authenticated
     using (public.is_admin_account());

   create policy "only admins can add clients"
     on clients for insert
     to authenticated
     with check (public.is_admin_account());

   create policy "only admins can edit clients"
     on clients for update
     to authenticated
     using (public.is_admin_account())
     with check (public.is_admin_account());

   create policy "only admins can delete clients"
     on clients for delete
     to authenticated
     using (public.is_admin_account());

   -- Die bestehenden Policies auf "attendance" erlaubten bisher jedem
   -- eingeloggten Nutzer Lese-/Löschzugriff ("to authenticated using
   -- (true)"). Das würde dem neuen Listen-Account vollen Zugriff auf die
   -- Rohdaten geben - deshalb auf is_admin_account() verschärfen.
   drop policy "only admins can view responses" on attendance;
   drop policy "only admins can delete responses" on attendance;

   create policy "only admins can view responses"
     on attendance for select
     to authenticated
     using (public.is_admin_account());

   create policy "only admins can delete responses"
     on attendance for delete
     to authenticated
     using (public.is_admin_account());

   -- Es gibt keine gespeicherte Perioden-Kennung mehr. Die aktuelle
   -- Ausgabeperiode (Samstag 18 Uhr bis zum folgenden Samstag 18 Uhr,
   -- Europe/Vienna) wird bei jeder Abfrage aus "jetzt" berechnet - dieselbe
   -- Logik wie getPeriodSaturday() in shared.js, nur serverseitig.
   create or replace function public.current_period_start()
   returns timestamptz
   language plpgsql
   stable
   as $$
   declare
     local_now timestamp := now() at time zone 'Europe/Vienna';
     days_since_saturday int := (extract(dow from local_now)::int - 6 + 7) % 7;
     candidate timestamp := date_trunc('day', local_now)
       - (days_since_saturday || ' days')::interval
       + interval '18 hours';
   begin
     if candidate > local_now then
       candidate := candidate - interval '7 days';
     end if;

     return candidate at time zone 'Europe/Vienna';
   end;
   $$;

   -- Interne Basis (nicht direkt gegrantet): pro Familiennummer nur die
   -- neueste Zeile innerhalb der aktuellen Periode - mehrfache An-/
   -- Abmeldungen sind erlaubt, hier zählt immer die zuletzt gespeicherte.
   create or replace view public.current_attendance_base as
   select distinct on (family_number)
     family_number, attendance, created_at
   from attendance
   where created_at >= public.current_period_start()
   order by family_number, created_at desc;

   revoke all on public.current_attendance_base from public, anon, authenticated;

   -- Ausgabeliste: verknüpft die aktuellen "Ja"-Antworten mit den
   -- Haushaltsdaten aus "clients", liefert aber nie Name/Telefon, weil
   -- diese Spalten gar nicht erst selektiert werden. Admin und
   -- Listen-Gruppe dürfen die Ausgabeliste beide lesen.
   create or replace view public.print_list as
   select
     cab.family_number,
     c.ew, c.ki, c.gf, c.ep, c.musl, c.hund, c.katze, c.sonstiges
   from public.current_attendance_base cab
   left join clients c on c.nummer = cab.family_number
   where cab.attendance = 'ja';

   revoke all on public.print_list from public, anon;
   grant select on public.print_list to authenticated;
   ```

   Falls dieses Skript schon einmal mit einer eigenen `klientennummer`-Spalte
   ausgeführt wurde: die getrennte Klientennummer war ein Fehlgriff, es gibt
   nur eine Nummer (`nummer`). Einmalig nachziehen:

   ```sql
   alter table clients drop column if exists klientennummer;
   ```

   Falls dieses Skript schon einmal mit einer `week_key`-Spalte auf
   `attendance` ausgeführt wurde: `week_key` wurde entfernt, die aktuelle
   Periode wird stattdessen bei jeder Abfrage aus `created_at` berechnet
   (siehe `current_period_start()` oben) und mehrfache An-/Abmeldungen pro
   Familie sind jetzt erlaubt (die neueste zählt). Einmalig nachziehen:

   ```sql
   drop view if exists public.print_list;
   drop function if exists public.submit_attendance(text, integer, text);
   alter table attendance drop column if exists week_key;
   ```

   Anschließend die `submit_attendance`-Funktion aus Schritt 2 sowie
   `current_period_start()`, `current_attendance_base` und `print_list` aus
   dem Skript oben (erneut) ausführen - alle sind als `create or replace`
   geschrieben und daher gefahrlos wiederholbar.

   Falls dieses Skript schon einmal mit der `current_attendance`-View
   ausgeführt wurde: die zeigte nur die Rohliste in `admin.html`, das es
   nicht mehr gibt (siehe unten). Einmalig aufräumen:

   ```sql
   drop view if exists public.current_attendance;
   ```

4. Unter **Authentication → Users** einen Admin-Account per "Add user"
   anlegen (E-Mail + Passwort). Damit meldet man sich später in
   `admin-clients.html` an. Zusätzlich einen zweiten Nutzer für die
   Listen-Gruppe anlegen (E-Mail `liste@toet-marchfeld.local`, ein
   gemeinsames Passwort für alle Tagesleiter) – dieser Nutzer meldet sich in
   `liste-drucken.html` an und wird von `is_list_account()` oben erkannt. Es
   sind keine öffentlichen Registrierungen aktiviert – nur die von dir
   angelegten Nutzer können sich einloggen. Ein Passwortwechsel für die
   Listen-Gruppe erfolgt bewusst nur manuell hier im Dashboard, es gibt
   dafür keine In-App-Funktion.
5. Unter **Settings → API** die **Project URL** und den **anon public key**
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

Die Tafel-Ausgabe findet immer samstags statt. `attendance` speichert dafür
keine eigene Perioden-Kennung – jede An-/Abmeldung ist einfach eine neue
Zeile mit ihrem `created_at`-Zeitstempel. Ob eine Zeile zur **aktuellen
Ausgabeperiode (Samstag 18 Uhr bis zum folgenden Samstag 18 Uhr, Zeitzone
Europa/Wien)** gehört, wird bei jeder Abfrage aus `created_at` berechnet –
serverseitig über die SQL-Funktion `current_period_start()`, im Browser über
`getPeriodSaturday()`/`formatPeriodLabel()` in `shared.js` (nur noch für die
Anzeige, nicht mehr für Abfragen). Mehrfache An-/Abmeldungen derselben
Familie innerhalb einer Periode sind kein Problem – die zeitlich neueste
zählt (`current_attendance_base`/`print_list` wählen das automatisch aus).
Alte Perioden werden nicht gelöscht, sondern bleiben unverändert in der
Datenbank erhalten.

## Datenschutz

- Die Datenbank läuft (bei Wahl der Region Frankfurt) in der EU.
- Öffentlich kann nur eine Antwort abgegeben/aktualisiert werden (nur
  Familiennummer + Ja/Nein) – Lesen und Löschen der Anmeldungen ist
  ausschließlich eingeloggten Admin-Accounts vorbehalten.
- Name und Telefonnummer werden ausschließlich admin-seitig in der
  Klientenverwaltung (`clients`-Tabelle) für die Haushaltsverwaltung
  gespeichert. Sie werden nie öffentlich angezeigt und erscheinen auch nicht
  auf der Ausgabeliste der Listen-Gruppe – nur der Admin kann sie einsehen.
