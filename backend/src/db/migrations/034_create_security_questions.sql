-- Security-question-based account recovery (CLAUDE.md's "Self-Registration & Password Policy"
-- section) - a "Forgot Password" flow that doesn't depend on an email provider (none exists in
-- this repo). At registration, 7 questions are offered at random from this master list and the
-- user answers all 7; at Forgot Password time, 4 of the user's own 7 saved answers are randomly
-- challenged.

-- m_-prefixed: a static, admin-seeded catalog (nobody user-authors a new question), same bucket
-- as m_function_master. Seeded with the app's initial 15; status lets a question be retired
-- later without breaking already-saved users_security_answers rows that reference it.
CREATE TABLE m_security_question (
  id            SERIAL PRIMARY KEY,
  question_text VARCHAR(100) UNIQUE NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active'|'inactive', app-enforced, no DB check
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unprefixed: per-user assignment data, a child of the account itself - same bucket as
-- users_roles/users_subscriptions, not m_ (it's not reference data) and not tx_ (not portfolio-
-- scoped). answer_hash is always bcrypt ciphertext, never plaintext, same treatment as
-- users.password_hash - these are personal-identity answers, not throwaway trivia.
-- UNIQUE(user_id, question_id) mirrors users_subscriptions' own (user_id, provider) shape.
CREATE TABLE users_security_answers (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES m_security_question(id),
  answer_hash   VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);

INSERT INTO m_security_question (question_text) VALUES
  ('Your father''s middle name'),
  ('Your mother''s maiden name'),
  ('Your paternal grandfather''s birth city'),
  ('Your favourite childhood cartoon character'),
  ('Your maternal grandmother''s first name'),
  ('Your first pet''s name'),
  ('Your first school''s name'),
  ('Your childhood best friend''s first name'),
  ('Your favourite childhood teacher''s first name'),
  ('The city where your mother was born'),
  ('Your first car''s make and model'),
  ('Your favourite childhood sport'),
  ('The street you grew up on'),
  ('Your first employer''s name'),
  ('Your favourite subject in middle school');
