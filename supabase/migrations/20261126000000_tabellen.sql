-- Schritt 2: Tabellen person, kategorie, geraet, geraet_ereignis (docs/ARCHITEKTUR.md, Abschnitt 5).
-- Regeln der Daten (Q2) stehen in der Datenbank: Check, Unique-Indizes, Trigger. Rechte (Q1): RLS an jeder Tabelle,
-- `authenticated` darf nur lesen; geschrieben wird später ausschließlich über DB-Funktionen (E1, Schritt 3).

create table inventar.person (
  id uuid primary key default gen_random_uuid(),
  -- null bis zum ersten Login; Konto weg (Anonymisieren) => null
  auth_user_id uuid references auth.users (id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  -- null nach Anonymisieren
  email text check (email is null or length(btrim(email)) > 0),
  rolle text not null check (rolle in ('verwaltung', 'mitarbeiter')),
  gesperrt boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index person_auth_user_id_key on inventar.person (auth_user_id);
create unique index person_email_klein_key on inventar.person (lower(email));

create table inventar.kategorie (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index kategorie_name_klein_key on inventar.kategorie (lower(name));

create table inventar.geraet (
  id uuid primary key default gen_random_uuid(),
  -- ohne Leerraum am Rand: sonst umgeht " ABC" den Unique-Index auf lower(seriennummer)
  seriennummer text not null check (length(seriennummer) > 0 and seriennummer = btrim(seriennummer)),
  bezeichnung text not null check (length(btrim(bezeichnung)) > 0),
  kategorie_id uuid not null references inventar.kategorie (id),
  notiz text,
  status text not null default 'lager' check (status in ('lager', 'ausgegeben', 'ausgemustert')),
  inhaber_id uuid references inventar.person (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ein Gerät ist im Lager, ausgemustert oder bei genau einer Person (inhaber_id ist eine Spalte: höchstens ein Besitzer)
  constraint geraet_status_inhaber check ((status = 'ausgegeben') = (inhaber_id is not null))
);
-- Seriennummer bleibt für immer reserviert: Index über alle Geräte, auch ausgemusterte
create unique index geraet_seriennummer_klein_key on inventar.geraet (lower(seriennummer));
create index geraet_inhaber_id_idx on inventar.geraet (inhaber_id);
create index geraet_kategorie_id_idx on inventar.geraet (kategorie_id);
create index geraet_status_idx on inventar.geraet (status);

create table inventar.geraet_ereignis (
  id uuid primary key default gen_random_uuid(),
  geraet_id uuid not null references inventar.geraet (id),
  art text not null check (art in ('angelegt', 'geaendert', 'ausgegeben', 'zurueckgenommen', 'ausgemustert')),
  person_id uuid references inventar.person (id),
  -- null = Vorbereitung durch die Servicerolle (Tests); die DB-Funktionen setzen es immer
  ausgefuehrt_von uuid references inventar.person (id),
  zeitpunkt timestamptz not null default now(),
  notiz text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index geraet_ereignis_geraet_zeitpunkt_idx on inventar.geraet_ereignis (geraet_id, zeitpunkt);
create index geraet_ereignis_person_id_idx on inventar.geraet_ereignis (person_id);
create index geraet_ereignis_ausgefuehrt_von_idx on inventar.geraet_ereignis (ausgefuehrt_von);

-- Schutzregeln (Trigger enthalten sonst keine Logik)
create function inventar.trg_seriennummer_unveraenderlich() returns trigger
language plpgsql set search_path = inventar, pg_temp as $$
begin
  raise exception 'seriennummer_unveraenderlich' using errcode = 'restrict_violation';
end $$;
create trigger geraet_seriennummer_unveraenderlich
  before update of seriennummer on inventar.geraet
  for each row when (old.seriennummer is distinct from new.seriennummer)
  execute function inventar.trg_seriennummer_unveraenderlich();

create function inventar.trg_historie_nur_anhaengend() returns trigger
language plpgsql set search_path = inventar, pg_temp as $$
begin
  raise exception 'historie_nur_anhaengend' using errcode = 'restrict_violation';
end $$;
create trigger geraet_ereignis_nur_anhaengend
  before update or delete on inventar.geraet_ereignis
  for each row execute function inventar.trg_historie_nur_anhaengend();
create trigger geraet_ereignis_kein_truncate
  before truncate on inventar.geraet_ereignis
  for each statement execute function inventar.trg_historie_nur_anhaengend();

-- Löschen gibt es nicht (Anonymisieren überschreibt, Ausmustern ändert den Status)
create function inventar.trg_loeschen_verboten() returns trigger
language plpgsql set search_path = inventar, pg_temp as $$
begin
  raise exception 'loeschen_verboten' using errcode = 'restrict_violation';
end $$;
create trigger person_kein_loeschen before delete on inventar.person
  for each row execute function inventar.trg_loeschen_verboten();
create trigger geraet_kein_loeschen before delete on inventar.geraet
  for each row execute function inventar.trg_loeschen_verboten();

-- Rolle aus der Tabelle, nie aus dem Token. security definer, damit die Regel auf `person` sich nicht selbst aufruft.
-- Liefert für alle ohne Recht false (kein Fehler: sie steht in RLS-Regeln, die für jede Zeile laufen).
create function inventar.ist_verwaltung() returns boolean
language sql stable security definer set search_path = inventar, pg_temp as $$
  select exists (
    select 1 from inventar.person p
    where p.auth_user_id = auth.uid() and p.rolle = 'verwaltung' and not p.gesperrt
  )
$$;

-- Rechte: nichts, was nicht ausdrücklich vergeben wird. Funktionen sind für PUBLIC standardmäßig ausführbar.
alter default privileges in schema inventar revoke all on tables from anon, authenticated;
alter default privileges in schema inventar revoke execute on functions from public, anon;
revoke all on all tables in schema inventar from public, anon, authenticated;
revoke execute on all functions in schema inventar from public, anon, authenticated;
grant select on inventar.person, inventar.kategorie, inventar.geraet, inventar.geraet_ereignis to authenticated;
-- Servicerolle: nur Testvorbereitung, nie die App
grant select, insert, update, delete on all tables in schema inventar to service_role;
grant execute on function inventar.ist_verwaltung() to authenticated;

alter table inventar.person enable row level security;
alter table inventar.kategorie enable row level security;
alter table inventar.geraet enable row level security;
alter table inventar.geraet_ereignis enable row level security;

-- Lesen. Schreiben: keine Regel und kein Recht für authenticated (nur DB-Funktionen, Schritt 3).
create policy person_lesen on inventar.person for select to authenticated
  using (inventar.ist_verwaltung() or (auth_user_id = auth.uid() and not gesperrt));
create policy kategorie_lesen on inventar.kategorie for select to authenticated
  using (exists (select 1 from inventar.person p where p.auth_user_id = auth.uid() and not p.gesperrt));
-- Mitarbeiter lesen Geräte nur über meine_geraete() (Schritt 3), nicht über die Tabelle
create policy geraet_lesen on inventar.geraet for select to authenticated
  using (inventar.ist_verwaltung());
create policy geraet_ereignis_lesen on inventar.geraet_ereignis for select to authenticated
  using (inventar.ist_verwaltung());

insert into inventar.kategorie (name) values ('Laptop'), ('Monitor'), ('Handy'), ('Headset');
