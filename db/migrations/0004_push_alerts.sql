-- Web push to the owner's installed web app (owner decision 2026-10-24: web app first, Telegram deferred).
CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,          -- push service URL, unique per browser install
  p256dh     TEXT NOT NULL,             -- browser public key (base64url)
  auth       TEXT NOT NULL,             -- browser auth secret (base64url)
  created_at TEXT NOT NULL,
  last_ok_at TEXT
);

-- Delivery state (docs/04 §4): pending → sent | shadow | dropped (held in quiet hours, over the daily cap or muted).
ALTER TABLE alerts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'shadow', 'dropped'));
