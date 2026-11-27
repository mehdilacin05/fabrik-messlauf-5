-- Schritt 3: DB-Funktionen für Geräte (docs/ARCHITEKTUR.md, Abschnitt 5, E1). Nur neue Funktionen, nichts wird entfernt.
-- Jede Funktion ist security definer mit festem search_path, prüft Rolle und Sperre selbst (aus auth.uid(), nie aus einem
-- Parameter) und ändert Zustand und Historie in einer Transaktion: ein Aufruf = ein Ereignis, bei Fehler nichts.
-- Fehler sind Meldungen ohne Zusatz (`nicht_erlaubt`, `nicht_im_lager`, …); die App bildet sie auf Codes ab.

-- Hilfsfunktion: Id der angemeldeten, nicht gesperrten Verwaltung, sonst `nicht_erlaubt`. Nur intern (kein Recht für Clients).
create function inventar.verwaltung_pruefen() returns uuid
language plpgsql stable security definer set search_path = inventar, pg_temp as $$
declare v_id uuid;
begin
  select p.id into v_id from inventar.person p
  where p.auth_user_id = auth.uid() and p.rolle = 'verwaltung' and not p.gesperrt;
  if v_id is null then
    raise exception 'nicht_erlaubt' using errcode = 'insufficient_privilege';
  end if;
  return v_id;
end $$;

create function inventar.geraet_anlegen(p_seriennummer text, p_bezeichnung text, p_kategorie_id uuid, p_notiz text default null)
returns uuid
language plpgsql security definer set search_path = inventar, pg_temp as $$
declare
  v_wer uuid := inventar.verwaltung_pruefen();
  v_id uuid;
begin
  if p_seriennummer is null or length(p_seriennummer) = 0 or p_seriennummer <> btrim(p_seriennummer)
     or p_bezeichnung is null or length(btrim(p_bezeichnung)) = 0 or p_kategorie_id is null then
    raise exception 'ungueltig';
  end if;
  begin
    insert into inventar.geraet (seriennummer, bezeichnung, kategorie_id, notiz)
    values (p_seriennummer, btrim(p_bezeichnung), p_kategorie_id, nullif(btrim(p_notiz), ''))
    returning id into v_id;
  exception
    when unique_violation then raise exception 'seriennummer_vergeben';
    when foreign_key_violation then raise exception 'kategorie_unbekannt';
  end;
  insert into inventar.geraet_ereignis (geraet_id, art, ausgefuehrt_von) values (v_id, 'angelegt', v_wer);
  return v_id;
end $$;

create function inventar.geraet_ausgeben(p_geraet_id uuid, p_person_id uuid) returns void
language plpgsql security definer set search_path = inventar, pg_temp as $$
declare
  v_wer uuid := inventar.verwaltung_pruefen();
  v_gesperrt boolean;
  v_zeilen int;
begin
  -- for share: eine gleichzeitige Sperre der Person wartet, bis die Ausgabe fertig ist
  select p.gesperrt into v_gesperrt from inventar.person p where p.id = p_person_id for share;
  if not found then raise exception 'nicht_gefunden'; end if;
  if v_gesperrt then raise exception 'person_gesperrt'; end if;
  -- bedingtes Update: bei zwei gleichzeitigen Aufrufen wartet der zweite und findet den Status nicht mehr
  update inventar.geraet set status = 'ausgegeben', inhaber_id = p_person_id, updated_at = now()
  where id = p_geraet_id and status = 'lager';
  get diagnostics v_zeilen = row_count;
  if v_zeilen = 0 then
    if exists (select 1 from inventar.geraet where id = p_geraet_id) then
      raise exception 'nicht_im_lager';
    end if;
    raise exception 'nicht_gefunden';
  end if;
  insert into inventar.geraet_ereignis (geraet_id, art, person_id, ausgefuehrt_von)
  values (p_geraet_id, 'ausgegeben', p_person_id, v_wer);
end $$;

create function inventar.geraet_zuruecknehmen(p_geraet_id uuid) returns void
language plpgsql security definer set search_path = inventar, pg_temp as $$
declare
  v_wer uuid := inventar.verwaltung_pruefen();
  v_status text;
  v_inhaber uuid;
begin
  select g.status, g.inhaber_id into v_status, v_inhaber from inventar.geraet g where g.id = p_geraet_id for update;
  if not found then raise exception 'nicht_gefunden'; end if;
  if v_status <> 'ausgegeben' then raise exception 'nicht_ausgegeben'; end if;
  update inventar.geraet set status = 'lager', inhaber_id = null, updated_at = now() where id = p_geraet_id;
  insert into inventar.geraet_ereignis (geraet_id, art, person_id, ausgefuehrt_von)
  values (p_geraet_id, 'zurueckgenommen', v_inhaber, v_wer);
end $$;

create function inventar.geraet_ausmustern(p_geraet_id uuid) returns void
language plpgsql security definer set search_path = inventar, pg_temp as $$
declare
  v_wer uuid := inventar.verwaltung_pruefen();
  v_status text;
begin
  select g.status into v_status from inventar.geraet g where g.id = p_geraet_id for update;
  if not found then raise exception 'nicht_gefunden'; end if;
  if v_status = 'ausgegeben' then raise exception 'ist_ausgegeben'; end if;
  if v_status = 'ausgemustert' then raise exception 'bereits_ausgemustert'; end if;
  update inventar.geraet set status = 'ausgemustert', updated_at = now() where id = p_geraet_id;
  insert into inventar.geraet_ereignis (geraet_id, art, ausgefuehrt_von) values (p_geraet_id, 'ausgemustert', v_wer);
end $$;

-- Mitarbeiter-Sicht: nur die eigenen Geräte, nur vier Felder. Ohne Person oder gesperrt: leer (kein Fehler).
create function inventar.meine_geraete()
returns table (bezeichnung text, kategorie text, seriennummer text, seit timestamptz)
language sql stable security definer set search_path = inventar, pg_temp as $$
  select g.bezeichnung, k.name, g.seriennummer,
         (select max(e.zeitpunkt) from inventar.geraet_ereignis e where e.geraet_id = g.id and e.art = 'ausgegeben')
  from inventar.person p
  join inventar.geraet g on g.inhaber_id = p.id and g.status = 'ausgegeben'
  join inventar.kategorie k on k.id = g.kategorie_id
  where p.auth_user_id = auth.uid() and not p.gesperrt
  order by g.bezeichnung, g.seriennummer
$$;

grant execute on function
  inventar.geraet_anlegen(text, text, uuid, text),
  inventar.geraet_ausgeben(uuid, uuid),
  inventar.geraet_zuruecknehmen(uuid),
  inventar.geraet_ausmustern(uuid),
  inventar.meine_geraete()
to authenticated;
