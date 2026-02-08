CREATE TABLE IF NOT EXISTS saved_quotes (
  user_id UUID NOT NULL REFERENCES users(id),
  quote_id UUID NOT NULL REFERENCES quotes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, quote_id)
);

CREATE TABLE IF NOT EXISTS quote_likes (
  user_id UUID NOT NULL REFERENCES users(id),
  quote_id UUID NOT NULL REFERENCES quotes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, quote_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_quotes_quote_id ON saved_quotes (quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_likes_quote_id ON quote_likes (quote_id);
