# Team Österreich Tafel Marchfeld – Anmeldung

Eine statische Webseite für die wöchentliche Anmeldung zur Team Österreich
Tafel-Ausgabe in der Region Marchfeld, deren Daten in einer Supabase-
Datenbank gespeichert werden (kostenloser Tarif, EU-Hosting möglich) –
dadurch sehen alle Familien und der Admin dieselben Daten, geräte- und
browserübergreifend.

- Jede Familie bekommt jeden Freitag automatisch eine E-Mail mit einem
  persönlichen Link – ein Klick auf "Ja" oder "Nein" genügt, ein Login ist
  nicht nötig
- Admin-Bereich mit echtem Login (Supabase Auth), inkl. Klientenverwaltung
  (Name, Telefon, E-Mail, Haushaltsdaten)
- Listen-Betrachter bekommen samstags einen personalisierten, 14 Tage
  gültigen Link auf die druckbare Ausgabeliste (kein Login/Passwort nötig);
  angemeldete Admins sehen dieselbe Liste direkt, ganz ohne Link/Token
- Ergebnisse werden automatisch nach der aktuellen Ausgabeperiode gefiltert
- Am Samstagvormittag bekommt der Organisator automatisch eine
  Zusammenfassung per E-Mail (Zusagen/Absagen/offene Antworten)

## Dateien

- `index.html` – Info-Seite: erklärt, dass die Anmeldung per E-Mail-Link läuft
- `antwort.html` / `antwort.js` – Ziel der personalisierten E-Mail-Links, speichert Ja/Nein anhand des Tokens
- `admin-clients.html` / `admin-clients.js` – login-geschützte Klientenverwaltung (Admin-Bereich)
- `liste-drucken.html` / `liste-drucken.js` – druckbare Ausgabeliste; für angemeldete Admins direkt sichtbar, sonst Ziel der personalisierten Listen-Links (Token in der URL)
- `styles.css` – Layout und Design
- `shared.js` – gemeinsame Logik für alle Seiten (Supabase-Client, Perioden-Berechnung, Login-Helfer)
- `supabase-config.js` – Zugangsdaten zum eigenen Supabase-Projekt (URL + anon-Key)
- `supabase/functions/send-weekly-invites` – Edge Function: verschickt freitags die personalisierten Einladungs-Mails
- `supabase/functions/send-summary` – Edge Function: verschickt samstags die Zusammenfassung an den Organisator

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

   -- Es gibt hier bewusst noch keine INSERT-Möglichkeit für anon: das
   -- öffentliche Speichern läuft über die Funktion
   -- submit_attendance_by_token() in Schritt 3, die einen gültigen Token
   -- aus der "invites"-Tabelle voraussetzt - die erst dort angelegt wird.
   ```

3. Im selben **SQL Editor** zusätzlich folgendes Skript ausführen, um die
   Klientenverwaltung, die Einladungs-Tokens sowie die (tokenbasierte)
   Ausgabeliste anzulegen:

   ```sql
   -- Vom Admin gepflegte Klientenregistry. Bewusst ohne Foreign Key zur
   -- "attendance"-Tabelle: die öffentliche Rückmeldung läuft über die
   -- "invites"-Tabelle weiter unten, nicht über einen direkten Verweis auf
   -- attendance-Zeilen.
   create table clients (
     id bigint generated always as identity primary key,
     nummer integer not null,
     name text not null,
     telefon text,
     email text,
     aktiv boolean not null default true,
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

   -- Nur für gesetzte Adressen eindeutig - mehrere Klienten ohne E-Mail
   -- verletzen den Index nicht, weil mehrere NULLs erlaubt sind.
   create unique index clients_email_key on clients (email) where email is not null;

   alter table clients enable row level security;

   -- Admin ist einfach jeder eingeloggte Supabase-Auth-Nutzer (kein
   -- Listen-Account mehr, der Zugriff auf die Ausgabeliste läuft
   -- inzwischen über get_print_list_by_token() weiter unten statt über
   -- ein eigenes Konto). Eigene Funktion statt "to authenticated" direkt
   -- in den Policies, damit ein späterer Rollenzuschnitt an einer Stelle
   -- geändert werden kann.
   create or replace function public.is_admin_account()
   returns boolean
   language sql stable
   set search_path = public, auth
   as $$
     select auth.role() = 'authenticated';
   $$;

   grant execute on function public.is_admin_account() to authenticated;

   -- Nur Admins dürfen Klienten verwalten.
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
   -- (true)") - auf is_admin_account() verschärfen, damit das nur für
   -- Admins gilt.
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

   -- Pro Einladung ein frischer, zufälliger Token statt eines dauerhaften
   -- Tokens pro Klient: ein geleakter Link aus einer alten E-Mail wird mit
   -- der nächsten Einladung automatisch ungültig, weil
   -- submit_attendance_by_token() unten nur den jeweils neuesten Token pro
   -- Familiennummer akzeptiert. Jede Zeile wird beim Versand der Einladung
   -- (Edge Function send-weekly-invites) mit status 'offen' angelegt.
   create table invites (
     id bigint generated always as identity primary key,
     family_number integer not null,
     token uuid not null default gen_random_uuid(),
     status text not null default 'offen' check (status in ('offen', 'ja', 'nein')),
     created_at timestamptz not null default now(),
     updated_at timestamptz
   );

   create unique index invites_token_key on invites (token);
   alter table invites enable row level security;

   -- Nur zum Nachschauen/Debuggen durch den Admin - anon bekommt hier nie
   -- Zugriff, das öffentliche Update läuft ausschließlich über
   -- submit_attendance_by_token().
   create policy "only admins can view invites"
     on invites for select
     to authenticated
     using (public.is_admin_account());

   -- Öffentliche Rückmeldung: statt einer frei eingebbaren Familiennummer
   -- (die auch für eine andere Familie eingegeben werden könnte) validiert
   -- diese Funktion den Token aus der zuletzt für diese Familiennummer
   -- angelegten "invites"-Zeile. Läuft wie schon zuvor mit den Rechten
   -- ihres Eigentümers (security definer) und umgeht damit die RLS auf
   -- "invites" (Update) und "attendance" (Insert) - beschränkt auf genau
   -- diesen einen Vorgang. Mehrfaches Umentscheiden mit demselben Token ist
   -- erlaubt (kein Upsert-Zwang), solange keine neuere Einladung existiert.
   create or replace function public.submit_attendance_by_token(
     p_token uuid,
     p_attendance text
   )
   returns void
   language plpgsql
   security definer
   set search_path = public
   as $$
   declare
     v_family_number integer;
     v_latest_token uuid;
   begin
     if p_attendance not in ('ja', 'nein') then
       raise exception 'invalid attendance value: %', p_attendance;
     end if;

     select family_number into v_family_number
     from invites
     where token = p_token;

     if v_family_number is null then
       raise exception 'invalid token';
     end if;

     select token into v_latest_token
     from invites
     where family_number = v_family_number
     order by created_at desc
     limit 1;

     if v_latest_token is distinct from p_token then
       raise exception 'token superseded by a newer invite';
     end if;

     update invites
     set status = p_attendance, updated_at = now()
     where token = p_token;

     insert into attendance (family_number, attendance)
     values (v_family_number, p_attendance);
   end;
   $$;

   revoke all on function public.submit_attendance_by_token(uuid, text) from public;
   grant execute on function public.submit_attendance_by_token(uuid, text) to anon, authenticated;

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
   -- diese Spalten gar nicht erst selektiert werden. Direkter Zugriff nur
   -- für Admins (z. B. zum Nachschauen im Adminbereich); Listen-Betrachter
   -- lesen dieselben Daten stattdessen ausschließlich über
   -- get_print_list_by_token() weiter unten.
   create or replace view public.print_list as
   select
     cab.family_number,
     c.ew, c.ki, c.gf, c.ep, c.musl, c.hund, c.katze, c.sonstiges
   from public.current_attendance_base cab
   left join clients c on c.nummer = cab.family_number
   where cab.attendance = 'ja';

   revoke all on public.print_list from public, anon;
   grant select on public.print_list to authenticated;

   -- E-Mail-Adressen der Organisatoren (kind = 'organizer') und
   -- Listen-Betrachter (kind = 'list_viewer'). Bewusst eine Tabelle statt
   -- Secrets: Supabase-Secrets sind write-only (nicht mehr einsehbar,
   -- sobald gesetzt) - ungeeignet für eine Liste, die sich mal ändert.
   -- Verwaltung erfolgt direkt hier im SQL Editor per insert/delete.
   create table mail_recipients (
     id bigint generated always as identity primary key,
     email text not null,
     kind text not null check (kind in ('organizer', 'list_viewer')),
     created_at timestamptz not null default now()
   );

   create unique index mail_recipients_email_kind_key on mail_recipients (email, kind);
   alter table mail_recipients enable row level security;
   -- Kein Zugriff für anon/authenticated - nur der service_role-Key aus
   -- send-summary liest das, Verwaltung läuft über den SQL Editor.

   -- Pro Listen-Betrachter ein eigener, 14 Tage gültiger Token statt des
   -- früheren gemeinsamen Listen-Kontos. Wird jeden Samstag frisch von
   -- send-summary angelegt und personalisiert per Mail verschickt - weil
   -- jede Person einen eigenen Token hat, lässt sich ein veröffentlichter
   -- Token im Nachhinein zuordnen (select email from list_view_tokens
   -- where token = '...'). Keine eigene Widerrufs-Logik: die kurze
   -- Gültigkeit reicht als Risikobegrenzung.
   create table list_view_tokens (
     id bigint generated always as identity primary key,
     token uuid not null default gen_random_uuid(),
     email text not null,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null default now() + interval '14 days'
   );

   create unique index list_view_tokens_token_key on list_view_tokens (token);
   alter table list_view_tokens enable row level security;
   -- Kein Zugriff für anon/authenticated direkt - nur über die Funktion
   -- unten bzw. den service_role-Key aus send-summary.

   -- Öffentlicher, tokenbasierter Lesezugriff auf die Ausgabeliste ohne
   -- Login - security definer umgeht damit gezielt die RLS auf
   -- "print_list" (die nur Admins erlaubt), beschränkt auf einen gültigen,
   -- nicht abgelaufenen Token.
   create or replace function public.get_print_list_by_token(p_token uuid)
   returns setof public.print_list
   language plpgsql
   security definer
   set search_path = public
   as $$
   begin
     if not exists (
       select 1 from list_view_tokens
       where token = p_token and expires_at > now()
     ) then
       raise exception 'invalid or expired token';
     end if;

     return query select * from public.print_list;
   end;
   $$;

   revoke all on function public.get_print_list_by_token(uuid) from public;
   grant execute on function public.get_print_list_by_token(uuid) to anon;
   ```

4. Unter **Authentication → Users** einen Admin-Account per "Add user"
   anlegen (E-Mail + Passwort). Damit meldet man sich später in
   `admin-clients.html` an. Es sind keine öffentlichen Registrierungen
   aktiviert – nur die von dir angelegten Nutzer können sich einloggen.
   Für weitere Admins einfach weitere Nutzer anlegen, siehe
   `is_admin_account()` oben. Ein eigenes Konto für Listen-Betrachter ist
   nicht mehr nötig – die bekommen ihren Zugriff über personalisierte
   Mail-Links, siehe Abschnitt "Automatisierung" unten.
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

## Automatisierung: Einladungen & Zusammenfassung per E-Mail

Der Mailversand läuft über [Resend](https://resend.com) (kostenloser Tarif)
und zwei Supabase Edge Functions, die per `pg_cron` wöchentlich aufgerufen
werden.

1. Kostenloses Konto auf resend.com anlegen und einen **API-Key** erzeugen.
   Für echten Versand an beliebige Empfänger muss eine eigene Domain bei
   Resend verifiziert werden (SPF/DKIM-Einträge im DNS) – ohne verifizierte
   Domain liefert Resend nur an die eigene Account-E-Mail-Adresse aus
   (Absender `onboarding@resend.dev`, nur zum Testen geeignet).
2. Beide Edge Functions anlegen. Am einfachsten direkt im Dashboard unter
   **Edge Functions → "Deploy a new function" → "Via Editor"**: je eine
   Function mit dem Namen `send-weekly-invites` bzw. `send-summary`
   anlegen und den Code aus
   `supabase/functions/send-weekly-invites/index.ts` bzw.
   `supabase/functions/send-summary/index.ts` hineinkopieren - beide
   Dateien sind bewusst eigenständig (keine Imports aus einer gemeinsamen
   Datei), damit das ohne Supabase CLI funktioniert. Die Namen müssen genau
   passen, weil `pg_cron` in Schritt 4 die Functions über diese Namen in
   der URL aufruft. Die Standard-JWT-Prüfung bleibt dabei aktiv - das passt,
   weil `pg_cron` die Functions mit dem `service_role`-Key als Bearer-Token
   aufruft, der selbst ein gültiges JWT ist.
3. Secrets setzen. Im Dashboard unter **Edge Functions → Secrets** (oder
   **Project Settings → Edge Functions**) folgende Werte eintragen
   (Platzhalter ersetzen):

   - `RESEND_API_KEY` = `re_dein_api_key`
   - `SITE_URL` = `https://www.toet-marchfeld.at` (für beide Functions -
     `send-summary` baut damit die Listen-Links, `send-weekly-invites` die
     Zu-/Absage-Links)
   - `FROM_EMAIL` = `einladung@deine-verifizierte-domain.at`

   `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` setzt Supabase in Edge
   Functions automatisch – dafür ist kein eigenes Secret nötig. Der
   Service-Role-Key wird bewusst nur hier (serverseitig, nie im
   Frontend-Code) verwendet, weil die Functions alle Klienten lesen müssen,
   was laut RLS sonst nur ein eingeloggter Admin darf.

   Organisatoren und Listen-Betrachter stehen **nicht** in Secrets, sondern
   in der Tabelle `mail_recipients` (siehe SQL-Setup oben) - Secrets sind
   in Supabase write-only, also ungeeignet für eine Liste, die sich mal
   ändert. Im **SQL Editor** z. B.:

   ```sql
   insert into mail_recipients (email, kind) values
     ('organisator@example.com', 'organizer'),
     ('tagesleiter1@example.com', 'list_viewer'),
     ('tagesleiter2@example.com', 'list_viewer');
   ```

   Zum Entfernen einer Adresse reicht ein `delete from mail_recipients
   where email = '...';`. `send-summary` verschickt an jeden Eintrag eine
   eigene, einzelne Mail (nie mehrere Adressen im selben `to`-Feld) -
   Organisatoren bekommen die volle Zusammenfassung mit Namen,
   Listen-Betrachter einen personalisierten, 14 Tage gültigen Link auf die
   anonymisierte Ausgabeliste (`liste-drucken.html?token=...`, siehe
   `get_print_list_by_token()` oben).
4. Im **SQL Editor** `pg_cron`/`pg_net` aktivieren, den Service-Role-Key
   sicher im Vault ablegen (nicht direkt im Cron-Job-SQL, das für jeden mit
   DB-Zugriff lesbar wäre) und die beiden wöchentlichen Aufrufe einrichten.

   Den echten Service-Role-Key findest du unter **Project Settings → API**
   im Abschnitt "Project API keys" - dort gibt es neben dem `anon`/`public`-
   Key (der schon in `supabase-config.js` steht) einen zweiten,
   `service_role`/`secret` genannten Key. Genau diesen unten anstelle von
   `DEIN-SERVICE-ROLE-KEY` einsetzen (samt Anführungszeichen). Die
   Projekt-Ref (für die URLs weiter unten) steht unter **Project Settings
   → General**.

   `vault.create_secret(...)` nur **einmal** ausführen - ein zweiter Lauf
   mit demselben Namen legt einen weiteren Eintrag an, wodurch die
   `where name = 'service_role_key'`-Abfrage in den Cron-Jobs nicht mehr
   eindeutig ist und fehlschlägt. Muss der Key später geändert werden,
   stattdessen `select id from vault.secrets where name = 'service_role_key';`
   ausführen und mit der gefundenen id
   `select vault.update_secret('<id>', 'NEUER-KEY');` aufrufen.

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;

   select vault.create_secret('DEIN-SERVICE-ROLE-KEY', 'service_role_key');

   -- pg_cron rechnet ausschließlich in UTC und kennt keine Sommer-/
   -- Winterzeit-Umstellung. Europe/Vienna liegt bei UTC+1 (MEZ, Winter)
   -- bzw. UTC+2 (MESZ, Sommer) - die Uhrzeiten unten sind auf MEZ
   -- abgestimmt und laufen im Sommer eine Stunde später als angegeben. Wer
   -- eine feste lokale Uhrzeit braucht, muss zweimal im Jahr per
   -- `select cron.alter_job(job_id, schedule := '...')` nachjustieren.

   -- Freitag 08:00 Uhr MEZ.
   select cron.schedule(
     'send-weekly-invites',
     '0 7 * * 5',
     $$
     select net.http_post(
       url := 'https://DEIN-PROJEKT-REF.functions.supabase.co/send-weekly-invites',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (
           select decrypted_secret from vault.decrypted_secrets
           where name = 'service_role_key'
         )
       ),
       body := '{}'::jsonb
     );
     $$
   );

   -- Samstag 10:00 Uhr MEZ.
   select cron.schedule(
     'send-summary',
     '0 9 * * 6',
     $$
     select net.http_post(
       url := 'https://DEIN-PROJEKT-REF.functions.supabase.co/send-summary',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (
           select decrypted_secret from vault.decrypted_secrets
           where name = 'service_role_key'
         )
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```
5. Testen, ohne auf den Cron zu warten - per curl mit dem `anon`-Key als
   Bearer-Token (aus `supabase-config.js` bzw. Settings → API; Projekt-Ref
   wie in Schritt 4):

   ```bash
   curl -i --request POST 'https://DEIN-PROJEKT-REF.functions.supabase.co/send-weekly-invites' \
     --header 'Authorization: Bearer DEIN-ANON-KEY'
   curl -i --request POST 'https://DEIN-PROJEKT-REF.functions.supabase.co/send-summary' \
     --header 'Authorization: Bearer DEIN-ANON-KEY'
   ```

   Ergebnis und Fehler lassen sich unter **Edge Functions → [Funktion] →
   Logs** im Dashboard nachvollziehen.

Die Klientenverwaltung (`admin-clients.html`) hat pro Klient ein Häkchen
"Erhält wöchentliche Einladungen per E-Mail" (`aktiv`) und ein E-Mail-Feld –
nur Klienten mit gesetzter E-Mail und aktiviertem Häkchen bekommen die
wöchentliche Einladung.

## GitHub Pages

1. Lade alle Dateien in ein GitHub-Repository hoch.
2. Aktiviere in GitHub unter Settings → Pages die Option "Deploy from a branch".
3. Wähle den Hauptbranch und den Ordner `/`.
4. Die Seite ist dann unter deiner GitHub-Page-URL verfügbar.

### Eigene Domain (www.toet-marchfeld.at)

Die Seite läuft unter der eigenen Domain **www.toet-marchfeld.at**, hinterlegt
über die `CNAME`-Datei im Repository-Root.

1. Beim Domain-Provider einen `CNAME`-Eintrag für `www` anlegen, der auf
   `<username>.github.io` zeigt (GitHub-Pages-Zielhost des Repos).
2. In GitHub unter Settings → Pages bei **Custom domain**
   `www.toet-marchfeld.at` eintragen (das schreibt/bestätigt die
   `CNAME`-Datei im Repo) und "Enforce HTTPS" aktivieren, sobald das
   Zertifikat ausgestellt wurde.
3. Für die apex-Domain (`toet-marchfeld.at` ohne `www`) beim
   Domain-Provider einen Eintrag auf die GitHub-Pages-Server anlegen,
   damit GitHub automatisch auf `www.toet-marchfeld.at` (die primäre
   Domain aus der `CNAME`-Datei) weiterleitet. Für den Apex-Root ist kein
   normaler `CNAME`-Record möglich (DNS-Standard) - zwei Varianten:

   - **Bevorzugt, falls vom Provider unterstützt**: ein `ALIAS`- bzw.
     `ANAME`-Record auf `<username>.github.io` (derselbe Zielhost wie
     beim `www`-`CNAME` oben). Wird bei jeder Anfrage live aufgelöst,
     bleibt also auch dann korrekt, wenn GitHub seine Pages-IPs mal
     ändert - im Gegensatz zu den fest hinterlegten IPs unten.
   - **Fallback**, falls der Provider kein `ALIAS`/`ANAME` kann: die
     GitHub-Pages-IPs direkt als `A`/`AAAA`-Records eintragen:

     ```
     A     185.199.108.153
     A     185.199.109.153
     A     185.199.110.153
     A     185.199.111.153
     AAAA  2606:50c0:8000::153
     AAAA  2606:50c0:8001::153
     AAAA  2606:50c0:8002::153
     AAAA  2606:50c0:8003::153
     ```

     Ändert GitHub diese IPs künftig, müssen sie hier manuell
     nachgezogen werden.
4. Domain-Verifizierung (optional, verhindert dass jemand anders eure
   Domain in einem fremden Repo beansprucht): Da das Repo einer
   Organisation gehört, unter
   **github.com/organizations/\<org\>/settings/pages** → **Verified
   domains** → **Add a domain** die apex-Domain (`toet-marchfeld.at`)
   eintragen. GitHub zeigt dann einen `TXT`-Record
   (`_github-pages-challenge-<org>`) zum Anlegen beim Domain-Provider an;
   danach in GitHub auf **Verify** klicken.

## Wochenlogik

Die Tafel-Ausgabe findet immer samstags statt. `attendance` speichert dafür
keine eigene Perioden-Kennung – jede An-/Abmeldung ist einfach eine neue
Zeile mit ihrem `created_at`-Zeitstempel. Ob eine Zeile zur **aktuellen
Ausgabeperiode (Samstag 18 Uhr bis zum folgenden Samstag 18 Uhr, Zeitzone
Europa/Wien)** gehört, wird bei jeder Abfrage aus `created_at` berechnet –
serverseitig über die SQL-Funktion `current_period_start()`, im Browser über
`getPeriodSaturday()`/`formatPeriodLabel()` in `shared.js` und in beiden
Edge Functions über eine portierte, eigenständige Kopie derselben zwei
Funktionen (nur für Anzeige bzw. Mail-Texte, nicht mehr für die
eigentliche Filterung von Abfragen).
Mehrfache An-/Abmeldungen derselben Familie innerhalb einer Periode sind
kein Problem – die zeitlich neueste zählt (`current_attendance_base`/
`print_list` wählen das automatisch aus). Alte Perioden werden nicht
gelöscht, sondern bleiben unverändert in der Datenbank erhalten.

Ausgelöst wird eine Periode durch die Edge Function `send-weekly-invites`
(freitags per `pg_cron`), die für jeden aktiven Klienten mit E-Mail-Adresse
eine neue `invites`-Zeile mit einem frischen Token anlegt (status `offen`)
und einen Link mit genau diesem Token schickt. Ein Klick auf "Ja" oder
"Nein" ruft `antwort.html` auf, das den Token gegen
`submit_attendance_by_token()` prüft, den Status in `invites` aktualisiert
und die Antwort speichert – ohne Login und ohne dass eine Familie die
Nummer einer anderen erraten oder eingeben könnte. Ein Token aus einer
älteren, z. B. versehentlich weitergeleiteten E-Mail wird mit der nächsten
Einladung automatisch ungültig, weil nur der jeweils neueste Token pro
Familiennummer akzeptiert wird. Samstags fasst `send-summary` die
`invites`-Zeilen der aktuellen Periode zusammen und schickt sie einzeln an
jeden Organisator aus `mail_recipients` (`kind = 'organizer'`): die
Zusagen als Tabelle mit den Haushaltsdaten aus `clients` (wie die gedruckte
Ausgabeliste, hier zusätzlich mit Namen), Absagen und offene Antworten nur
als Namensliste. Zeitgleich verschickt dieselbe Function an jeden
Listen-Betrachter (`kind = 'list_viewer'`) einen eigenen, frischen,
14 Tage gültigen Link auf `liste-drucken.html`, der über
`get_print_list_by_token()` immer den aktuellen Periodenstand zeigt - ganz
ohne Login.

## Datenschutz

- Die Datenbank läuft (bei Wahl der Region Frankfurt) in der EU.
- Öffentlich kann nur über einen personalisierten, nicht erratbaren Token
  aus der E-Mail abgestimmt werden (Ja/Nein) – Lesen und Löschen der
  Anmeldungen ist ausschließlich eingeloggten Admin-Accounts vorbehalten.
- Name, Telefonnummer und E-Mail-Adresse werden ausschließlich admin-seitig
  in der Klientenverwaltung (`clients`-Tabelle) für die Haushaltsverwaltung
  und den Mailversand gespeichert. Sie werden nie öffentlich angezeigt und
  erscheinen auch nicht auf der Ausgabeliste für Listen-Betrachter – nur
  der Admin kann sie einsehen.
- Listen-Betrachter greifen über einen personalisierten, 14 Tage gültigen
  Token zu statt über ein gemeinsames Konto/Passwort wie früher. Jeder
  Token ist einer einzelnen E-Mail-Adresse zugeordnet (`list_view_tokens`),
  damit sich ein versehentlich weitergegebener Link im Nachhinein einer
  Person zuordnen lässt. Es gibt bewusst keine Widerrufs-Möglichkeit vor
  Ablauf - die kurze Gültigkeit begrenzt das Risiko stattdessen zeitlich.
- Der Mailversand läuft über Resend, einen Anbieter außerhalb der EU. Die
  versendeten Inhalte sind auf Name, Datum und den Ja-/Nein-Link begrenzt;
  wer für den Mailversand ebenfalls eine EU-only-Verarbeitung braucht,
  sollte das vorab mit Resend klären oder einen alternativen Anbieter mit
  EU-Hosting-Zusage wählen.
