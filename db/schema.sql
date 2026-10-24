-- Pumpevakt · D1 (SQLite) schema. See docs/03-data-model.md
-- Timestamps are ISO-8601 UTC strings. Prices are NOK per litre incl. VAT.

CREATE TABLE stations (
  id       TEXT PRIMARY KEY,            -- drivstoffapp.no station id, e.g. 'j1i4da8bf8wkcql'
  name     TEXT NOT NULL,
  brand    TEXT,
  address  TEXT,
  city     TEXT,
  lat      REAL NOT NULL,
  lon      REAL NOT NULL,
  active   INTEGER NOT NULL DEFAULT 1
);

-- Append-only; a row is written only when the price for (station, fuel) changes.
CREATE TABLE prices (
  id          INTEGER PRIMARY KEY,
  station_id  TEXT NOT NULL REFERENCES stations(id),
  fuel        TEXT NOT NULL CHECK (fuel IN ('diesel','petrol95','petrol98','hvo100')),
  price       REAL NOT NULL CHECK (price BETWEEN 5 AND 60),
  observed_at TEXT NOT NULL,           -- when the price was seen, not when we fetched it
  source      TEXT NOT NULL            -- 'drivstoffapp'
);
CREATE INDEX prices_station_fuel_time ON prices (station_id, fuel, observed_at DESC);

-- One value per day per series: oslo_diesel_median, ulsd_usd_gal, usdnok, wdi_nok_l
CREATE TABLE market_daily (
  day    TEXT NOT NULL,                -- YYYY-MM-DD
  series TEXT NOT NULL,
  value  REAL NOT NULL,
  PRIMARY KEY (day, series)
);

CREATE TABLE alerts (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('market_drop','outlier','system')),
  dedupe_key TEXT NOT NULL UNIQUE,
  payload    TEXT NOT NULL,            -- JSON
  shadow     INTEGER NOT NULL DEFAULT 0, -- 1 = logged, not sent (calibration)
  created_at TEXT NOT NULL,
  sent_at    TEXT,
  feedback   TEXT CHECK (feedback IN ('up','down'))
);

CREATE TABLE fillups (                 -- "⛽ filled here" taps, for the savings metric
  id         INTEGER PRIMARY KEY,
  station_id TEXT NOT NULL REFERENCES stations(id),
  price      REAL NOT NULL,
  oslo_median REAL NOT NULL,
  at         TEXT NOT NULL
);

CREATE TABLE runs (
  id          INTEGER PRIMARY KEY,
  job         TEXT NOT NULL,           -- 'prices' | 'market'
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER,
  detail      TEXT                     -- JSON: per-source counts or error
);

CREATE TABLE settings (                -- runtime toggles changed from the bot (/mute, /shadow off)
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
