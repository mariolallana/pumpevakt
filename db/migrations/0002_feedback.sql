-- User-test feedback from the web page (docs/spec-flaws.md F21). One row per 👍/👎/note.
CREATE TABLE feedback (
  id              INTEGER PRIMARY KEY,
  created_at      TEXT NOT NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('ok','wrong','note')),
  station_id      TEXT,                 -- null for a general note
  station_name    TEXT,
  fuel            TEXT,
  app_price       REAL,                 -- what the app showed
  app_observed_at TEXT,                 -- age of the shown price
  actual_price    REAL,                 -- price on the sign, if given
  note            TEXT,
  lat             REAL,                 -- where the user was, if known
  lon             REAL
);
