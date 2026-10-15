-- Explicit, additive migration. Never run automatically at application startup.
CREATE TABLE IF NOT EXISTS auth_abuse_counters (
  key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 10000),
  expires_at timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_abuse_expiry_idx ON auth_abuse_counters (expires_at);
