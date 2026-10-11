-- Migration: Gruppen, K-Nr./EAN, neue Periodengrenze (Samstag 19 Uhr) und
-- Perioden-Historie für die Ausgabeliste. Im Supabase SQL Editor ausführen,
-- nachdem das Basis-Setup aus dem README (Schritte 2-3) schon eingespielt ist.
-- Reihenfolge: erst dieses Skript, dann die Webseite und die beiden Edge
-- Functions aktualisieren (die alte Webseite nutzt print_list /
-- get_print_list_by_token, die hier ersetzt werden).

-- 1) Gruppen: jede Gruppe hat ihre feste Abholzeit am Samstag.
create table gruppen (
  nummer integer primary key,
  name text not null,
  abholzeit time not null
);

insert into gruppen (nummer, name, abholzeit) values
  (1, 'Gruppe 1', '18:30'),
  (2, 'Gruppe 2', '19:00'),
  (3, 'Gruppe 3', '19:30');

alter table gruppen enable row level security;

-- Die Gruppenzeiten sind nicht sensibel und werden auch von den
-- (nicht eingeloggten) Listen-Betrachtern für die Druckansicht gelesen.
create policy "everyone can view gruppen"
  on gruppen for select
  to anon, authenticated
  using (true);

create policy "only admins can add gruppen"
  on gruppen for insert
  to authenticated
  with check (public.is_admin_account());

create policy "only admins can edit gruppen"
  on gruppen for update
  to authenticated
  using (public.is_admin_account())
  with check (public.is_admin_account());

create policy "only admins can delete gruppen"
  on gruppen for delete
  to authenticated
  using (public.is_admin_account());

-- 2) Neue Spalten bei den Klienten.
alter table clients
  add column gruppe integer references gruppen (nummer) on delete set null,
  add column k_nr integer,
  add column ean text check (ean ~ '^([0-9]{8}|[0-9]{13})$');

create unique index clients_k_nr_key on clients (k_nr) where k_nr is not null;
create unique index clients_ean_key on clients (ean) where ean is not null;

-- 3) Periodengrenze ist jetzt Samstag 19:00 (Europe/Vienna) statt 18:00.
-- period_start(0) = aktuelle Periode, 1 = die davor usw. Die Sommer-/
-- Winterzeit wird korrekt behandelt, weil in lokaler Zeit gerechnet wird.
create or replace function public.period_start(p_offset integer default 0)
returns timestamptz
language plpgsql
stable
as $$
declare
  local_now timestamp := now() at time zone 'Europe/Vienna';
  days_since_saturday int := (extract(dow from local_now)::int - 6 + 7) % 7;
  candidate timestamp := date_trunc('day', local_now)
    - make_interval(days => days_since_saturday)
    + interval '19 hours';
begin
  if candidate > local_now then
    candidate := candidate - interval '7 days';
  end if;

  candidate := candidate - make_interval(days => p_offset * 7);

  return candidate at time zone 'Europe/Vienna';
end;
$$;

create or replace function public.current_period_start()
returns timestamptz
language sql
stable
as $$
  select public.period_start(0);
$$;

-- 4) Ausgabeliste pro Periode (0 = aktuelle, 1-3 = die drei davor). Ersetzt
-- die View print_list und get_print_list_by_token(). Zugriff haben
-- eingeloggte Admins (p_token bleibt leer) oder Listen-Betrachter mit einem
-- gültigen Token. Liefert nie Name/Telefon. Die Gruppe stammt aus dem
-- aktuellen Stand der Klientenverwaltung (keine Historie der Zuordnung).
drop function if exists public.get_print_list_by_token(uuid);
drop view if exists public.print_list;
drop view if exists public.current_attendance_base;

drop function if exists public.get_print_list(integer, uuid);

-- Liefert die Familien, die in der Periode zugesagt haben.
create or replace function public.get_print_list(
  p_offset integer default 0,
  p_token uuid default null
)
returns table (
  family_number integer,
  gruppe integer,
  ew integer,
  ki integer,
  gf boolean,
  ep boolean,
  musl boolean,
  hund integer,
  katze integer,
  sonstiges text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_offset < 0 or p_offset > 3 then
    raise exception 'invalid period offset';
  end if;

  if not (
    public.is_admin_account()
    or exists (
      select 1 from list_view_tokens t
      where t.token = p_token and t.expires_at > now()
    )
  ) then
    raise exception 'invalid or expired token';
  end if;

  v_start := public.period_start(p_offset);
  v_end := case
    when p_offset = 0 then 'infinity'::timestamptz
    else public.period_start(p_offset - 1)
  end;

  -- Pro Familie zählt die zuletzt gespeicherte Antwort der Periode.
  return query
  select l.family_number, c.gruppe, c.ew, c.ki, c.gf, c.ep, c.musl,
         c.hund, c.katze, c.sonstiges
  from (
    select distinct on (a.family_number) a.family_number, a.attendance
    from attendance a
    where a.created_at >= v_start and a.created_at < v_end
    order by a.family_number, a.created_at desc
  ) l
  left join clients c on c.nummer = l.family_number
  where l.attendance = 'ja'
  order by l.family_number;
end;
$$;

revoke all on function public.get_print_list(integer, uuid) from public;
grant execute on function public.get_print_list(integer, uuid) to anon, authenticated;

-- 5) pg_cron: Einladung Montag 09:00, Zusammenfassung Samstag 09:00
-- (jeweils Europe/Vienna). pg_cron kennt nur UTC, deshalb läuft der Job zu
-- beiden möglichen UTC-Zeiten (07:00 und 08:00); die Edge Functions
-- verschicken nur, wenn es in Wien gerade 9 Uhr ist. Bestehende Jobs
-- ersetzen (URL/Projekt-Ref wie im README einsetzen):
--
--   select cron.unschedule('send-weekly-invites');
--   select cron.unschedule('send-summary');
--   -- danach beide neu anlegen, siehe README Abschnitt "Automatisierung",
--   -- Schritt 4 (Zeitplan '0 7,8 * * 1' bzw. '0 7,8 * * 6').
