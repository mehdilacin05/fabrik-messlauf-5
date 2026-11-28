-- Schritt 4: Anmeldung und Rechte (docs/ARCHITEKTUR.md, Abschnitt 8 und 10, E3). Nur neue Objekte, nichts wird entfernt.
-- Q1: Das Konto wird nur mit einer Person verknüpft, wenn es ein Microsoft-Konto (Anbieter `azure`) ist und kein
-- Mail-Konto mit dieser Adresse im Login-Dienst steht. Die erste Verwaltung bestimmt allein die Start-Mail aus
-- `verwaltung_start`, die der Container beim Start schreibt (scripts/migrate.sh); sie ist kein Funktionsparameter.

-- Eine Zeile höchstens. Kein Recht für anon und authenticated (Standardrechte des Schemas), nur die Funktion unten liest sie.
create table inventar.verwaltung_start (
  id boolean primary key default true check (id),
  email text not null check (length(btrim(email)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table inventar.verwaltung_start enable row level security;
revoke all on inventar.verwaltung_start from public, anon, authenticated;

-- true = jetzt verknüpft, false = war schon verknüpft; sonst `nicht_erlaubt` (die App zeigt „Kein Zugang“).
create function inventar.person_verknuepfen() returns boolean
language plpgsql security definer set search_path = inventar, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_mail text;
  v_start text;
  v_name text;
  v_person inventar.person%rowtype;
begin
  if v_uid is null then
    raise exception 'nicht_erlaubt' using errcode = 'insufficient_privilege';
  end if;

  select * into v_person from inventar.person p where p.auth_user_id = v_uid;
  if found then
    if v_person.gesperrt then
      raise exception 'nicht_erlaubt' using errcode = 'insufficient_privilege';
    end if;
    return false;
  end if;

  select lower(btrim(u.email)), coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                                         nullif(btrim(u.raw_user_meta_data ->> 'name'), ''))
    into v_mail, v_name
  from auth.users u where u.id = v_uid;
  if v_mail is null or v_mail = '' then
    raise exception 'nicht_erlaubt' using errcode = 'insufficient_privilege';
  end if;
  -- nur Microsoft: eine Identität `azure` muss da sein, und keine andere Anmeldeart darf zum Konto gehören (ein vorab
  -- per Mail registriertes Konto wird beim Microsoft-Login mit derselben Adresse verbunden; der Login-Dienst führt
  -- eine Adresse nur einmal, darum reicht der Blick auf die Identitäten dieses Kontos)
  if not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider = 'azure')
     or exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'azure') then
    raise exception 'nicht_erlaubt' using errcode = 'insufficient_privilege';
  end if;

  -- zwei gleichzeitige Erst-Logins nacheinander, damit „keine Verwaltung“ nicht zweimal gilt
  perform pg_advisory_xact_lock(hashtext('inventar.person_verknuepfen'));

  select * into v_person from inventar.person p where lower(p.email) = v_mail for update;
  if found then
    if v_person.auth_user_id is not null or v_person.gesperrt then
      raise exception 'nicht_erlaubt' using errcode = 'insufficient_privilege';
    end if;
    update inventar.person p set auth_user_id = v_uid, updated_at = now(),
      rolle = case when p.rolle = 'verwaltung' or (exists (select 1 from inventar.verwaltung_start s where lower(btrim(s.email)) = v_mail)
                   and not exists (select 1 from inventar.person x where x.rolle = 'verwaltung')) then 'verwaltung' else p.rolle end
    where p.id = v_person.id;
    return true;
  end if;

  -- keine Person zur Mail: nur die Start-Mail, nur solange es keine Verwaltung gibt
  select lower(btrim(s.email)) into v_start from inventar.verwaltung_start s;
  if v_start is not null and v_start = v_mail and not exists (select 1 from inventar.person x where x.rolle = 'verwaltung') then
    insert into inventar.person (auth_user_id, name, email, rolle)
    values (v_uid, coalesce(v_name, split_part(v_mail, '@', 1)), v_mail, 'verwaltung');
    return true;
  end if;
  raise exception 'nicht_erlaubt' using errcode = 'insufficient_privilege';
end $$;

revoke execute on function inventar.person_verknuepfen() from public, anon;
grant execute on function inventar.person_verknuepfen() to authenticated;
