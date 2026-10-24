-- Chain morning levels and /api/outlook read recent reports across all stations by time (docs/spec-flaws.md F23).
CREATE INDEX prices_time ON prices (observed_at);
