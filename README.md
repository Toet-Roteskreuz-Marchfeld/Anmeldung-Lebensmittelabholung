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
- `admin.html` – login-geschützter Bereich mit Resultaten
- `admin-clients.html` / `admin-clients.js` – login-geschützte Klientenverwaltung
- `liste.html` / `liste.js` – Login für die Listen-Gruppe (gemeinsames Passwort)
- `liste-drucken.html` / `liste-drucken.js` – druckbare Ausgabeliste für die Listen-Gruppe
- `styles.css` – Layout und Design
- `shared.js` – gemeinsame Logik für alle Seiten (Supabase-Client, Perioden-Berechnung, Login-Helfer)
- `script.js` – Logik für Speicherung, Anmeldungen und Admin-Sicht
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
     klientennummer integer,
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

   -- Ausgabeliste: verknüpft die aktuellen "Ja"-Antworten mit den
   -- Haushaltsdaten aus "clients", liefert aber nie Name/Telefon, weil
   -- diese Spalten gar nicht erst selektiert werden. Die View läuft mit
   -- den Rechten ihres Eigentümers (wie schon "submit_attendance") und
   -- umgeht damit RLS auf beiden Basistabellen - Admin und Listen-Gruppe
   -- dürfen sie beide lesen.
   create or replace view public.print_list as
   select
     a.week_key,
     a.family_number,
     c.ew, c.ki, c.gf, c.ep, c.musl, c.hund, c.katze, c.sonstiges
   from attendance a
   left join clients c on c.nummer = a.family_number
   where a.attendance = 'ja';

   revoke all on public.print_list from public, anon;
   grant select on public.print_list to authenticated;
   ```

4. Unter **Authentication → Users** einen Admin-Account per "Add user"
   anlegen (E-Mail + Passwort). Damit meldet man sich später in `admin.html`
   und `admin-clients.html` an. Zusätzlich einen zweiten Nutzer für die
   Listen-Gruppe anlegen (E-Mail `liste@toet-marchfeld.local`, ein
   gemeinsames Passwort für alle Tagesleiter) – dieser Nutzer meldet sich in
   `liste.html` an und wird von `is_list_account()` oben erkannt. Es sind
   keine öffentlichen Registrierungen aktiviert – nur die von dir angelegten
   Nutzer können sich einloggen. Ein Passwortwechsel für die Listen-Gruppe
   erfolgt bewusst nur manuell hier im Dashboard, es gibt dafür keine
   In-App-Funktion.
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

Die Tafel-Ausgabe findet immer samstags statt. Der Schlüssel `week_key`
bezeichnet deshalb nicht mehr eine Kalenderwoche, sondern die aktuelle
**Ausgabeperiode von Samstag 18 Uhr bis zum folgenden Samstag 18 Uhr**,
berechnet in der Zeitzone Europa/Wien (unabhängig davon, wie das Gerät der
Familie eingestellt ist – siehe `getPeriodKey()`/`getPeriodSaturday()` in
`shared.js`). Alte Perioden werden nicht mehr gelöscht, sondern bleiben in
der Datenbank erhalten; Admin-Ansicht, Anmeldung und Ausgabeliste filtern
jeweils nur auf die aktuelle Periode. Der "Zurücksetzen"-Button in
`admin.html` löscht bei Bedarf nur die Datensätze der laufenden Periode.

## Datenschutz

- Die Datenbank läuft (bei Wahl der Region Frankfurt) in der EU.
- Öffentlich kann nur eine Antwort abgegeben/aktualisiert werden (nur
  Familiennummer + Ja/Nein) – Lesen und Löschen der Anmeldungen ist
  ausschließlich eingeloggten Admin-Accounts vorbehalten.
- Name und Telefonnummer werden ausschließlich admin-seitig in der
  Klientenverwaltung (`clients`-Tabelle) für die Haushaltsverwaltung
  gespeichert. Sie werden nie öffentlich angezeigt und erscheinen auch nicht
  auf der Ausgabeliste der Listen-Gruppe – nur der Admin kann sie einsehen.
