-- Pumpevakt · initial schema
-- See docs/03-data-model.md and docs/04-alert-engine.md

create extension if not exists postgis;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── Enums ────────────────────────────────────────────────────────────────
create type fuel_type    as enum ('diesel', 'petrol95', 'petrol98', 'hvo100');
create type alert_kind   as enum ('market_drop', 'outlier', 'target_price');
create type alert_status as enum ('pending', 'sent', 'deferred', 'failed');
create type channel_kind as enum ('telegram', 'email', 'webpush');

-- ─── Stations & prices ────────────────────────────────────────────────────
create table stations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  brand       text,
  address     text,
  geom        geography(Point, 4326) not null,
  osm_id      bigint unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index stations_geom_idx on stations using gist (geom);

create table station_source_ids (
  source             text not null,
  source_station_id  text not null,
  station_id         uuid not null references stations(id) on delete cascade,
  primary key (source, source_station_id)
);

create table prices (
  id          bigserial primary key,
  station_id  uuid not null references stations(id) on delete cascade,
  fuel        fuel_type not null,
  price_nok   numeric(6,2) not null check (price_nok between 5 and 60),
  observed_at timestamptz not null,
  source      text not null,
  confidence  real not null default 0.9 check (confidence between 0 and 1)
);
create index prices_station_fuel_time_idx on prices (station_id, fuel, observed_at desc);
create index prices_time_idx on prices (observed_at desc);

create table price_current (
  station_id   uuid not null references stations(id) on delete cascade,
  fuel         fuel_type not null,
  price_nok    numeric(6,2) not null,
  observed_at  timestamptz not null,
  last_seen_at timestamptz not null default now(),
  source       text not null,
  confidence   real not null,
  primary key (station_id, fuel)
);

-- ─── Area statistics ──────────────────────────────────────────────────────
-- hour-of-week band in Europe/Oslo: 0..41 (7 days × six 4-hour bands)
create or replace function how_band(ts timestamptz) returns int
language sql immutable as $$
  select ((extract(isodow from ts at time zone 'Europe/Oslo')::int - 1) * 6
          + floor(extract(hour from ts at time zone 'Europe/Oslo') / 4))::int
$$;

create table area_stats_15m (
  area    text not null,
  fuel    fuel_type not null,
  bucket  timestamptz not null,           -- floored to 15 min
  median  numeric(6,2) not null,
  p10     numeric(6,2) not null,
  p25     numeric(6,2) not null,
  mad     numeric(6,3) not null,          -- median absolute deviation
  n_fresh int not null,
  primary key (area, fuel, bucket)
);

create table area_baseline (
  area       text not null,
  fuel       fuel_type not null,
  how_band   int not null check (how_band between 0 and 41),
  median_14d numeric(6,2),
  median_28d numeric(6,2),
  updated_at timestamptz not null default now(),
  primary key (area, fuel, how_band)
);

create table area_stats_daily (
  area   text not null,
  fuel   fuel_type not null,
  day    date not null,
  median numeric(6,2) not null,
  min    numeric(6,2) not null,
  primary key (area, fuel, day)
);

-- ─── Users, places, channels, alerts ──────────────────────────────────────
create table profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  fuel             fuel_type not null default 'diesel',
  tank_l           numeric(5,1) not null default 50,
  consumption_l100 numeric(4,1) not null default 6.5,
  radius_km        numeric(4,1) not null default 5,
  sensitivity      text not null default 'normal' check (sensitivity in ('relaxed','normal','eager')),
  quiet_from       time default '22:00',
  quiet_to         time default '07:00',
  tz               text not null default 'Europe/Oslo',
  created_at       timestamptz not null default now()
);

create table saved_places (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  label   text not null,
  geom    geography(Point, 4326) not null
);

create table notification_channels (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        channel_kind not null,
  address     jsonb not null,                -- {chat_id} | {email} | {subscription}
  verified_at timestamptz,
  enabled     boolean not null default true
);

create table alert_rules (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references profiles(id) on delete cascade,
  kind     alert_kind not null,
  fuel     fuel_type not null,
  place_id uuid references saved_places(id) on delete cascade,
  params   jsonb not null default '{}',
  enabled  boolean not null default true
);

create table alert_events (
  id         bigserial primary key,
  rule_id    uuid not null references alert_rules(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  dedupe_key text not null unique,
  payload    jsonb not null,
  status     alert_status not null default 'pending',
  attempts   int not null default 0,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  feedback   text check (feedback in ('up','down'))
);
create index alert_events_pending_idx on alert_events (status) where status in ('pending','deferred');

create table ingest_runs (
  id          bigserial primary key,
  source      text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  n_obs       int,
  n_changes   int,
  error       text
);

-- ─── RPC: stations near a point, ranked by net saving ─────────────────────
-- Detour model: round trip from the user's position, road factor 1.3 over
-- straight-line distance. Reference price = median of fresh prices in radius.
create or replace function stations_near(
  p_lat double precision, p_lon double precision,
  p_radius_km double precision default 5,
  p_fuel fuel_type default 'diesel',
  p_tank_l double precision default 50,
  p_consumption_l100 double precision default 6.5
) returns table (
  station_id uuid, name text, brand text, address text,
  lat double precision, lon double precision,
  price_nok numeric, observed_at timestamptz, is_stale boolean,
  distance_km double precision, ref_price numeric, net_saving_nok numeric
) language sql stable as $$
  with origin as (select st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography g),
  cand as (
    select s.id, s.name, s.brand, s.address, s.geom, pc.price_nok, pc.observed_at,
           st_distance(s.geom, o.g) / 1000.0 as distance_km
    from stations s
    join price_current pc on pc.station_id = s.id and pc.fuel = p_fuel
    cross join origin o
    where s.is_active
      and st_dwithin(s.geom, o.g, p_radius_km * 1000)
      and pc.observed_at > now() - interval '24 hours'
  ),
  ref as (
    select percentile_cont(0.5) within group (order by price_nok) as m
    from cand where observed_at > now() - interval '6 hours'
  )
  select c.id, c.name, c.brand, c.address,
         st_y(c.geom::geometry), st_x(c.geom::geometry),
         c.price_nok, c.observed_at,
         c.observed_at < now() - interval '6 hours',
         round(c.distance_km::numeric, 2)::double precision,
         round(r.m::numeric, 2),
         round(((r.m - c.price_nok) * p_tank_l
               - (2 * c.distance_km * 1.3) * p_consumption_l100 / 100 * c.price_nok)::numeric, 0)
  from cand c cross join ref r
  order by 12 desc nulls last;
$$;

-- ─── RLS ──────────────────────────────────────────────────────────────────
alter table stations              enable row level security;
alter table price_current         enable row level security;
alter table prices                enable row level security;
alter table area_stats_15m        enable row level security;
alter table area_baseline         enable row level security;
alter table area_stats_daily      enable row level security;
alter table profiles              enable row level security;
alter table saved_places          enable row level security;
alter table notification_channels enable row level security;
alter table alert_rules           enable row level security;
alter table alert_events          enable row level security;
alter table ingest_runs           enable row level security;
alter table station_source_ids    enable row level security;

create policy "public read" on stations         for select using (true);
create policy "public read" on price_current    for select using (true);
create policy "public read" on prices           for select using (true);
create policy "public read" on area_stats_15m   for select using (true);
create policy "public read" on area_baseline    for select using (true);
create policy "public read" on area_stats_daily for select using (true);

create policy "own profile" on profiles              for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own places"  on saved_places          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own channels" on notification_channels for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rules"   on alert_rules           for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own events read" on alert_events      for select using (user_id = auth.uid());
create policy "own events feedback" on alert_events  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Schedules are created in 0002_cron.sql, after the function URLs and secrets exist.
