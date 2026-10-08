-- Candlestick Pattern Q&A - deterministic question templates, Phase 2 (2026-10-05). Backs the
-- resolution cascade's last deterministic step for a role WITHOUT candlestick_question_answer
-- :llm_calling (migration 058): a small, hand-curated set of recognized question SHAPES, not a
-- general free-text parser. Deliberately narrow - there is no LLM-equivalent sufficiency
-- judgment on this path, so a template only exists for a phrasing unambiguous enough that a
-- regex match is itself a safe confidence signal. A question that matches no template simply
-- falls through to 'unable_to_answer', never a guess.
--
-- filter_mapping is a small declarative DSL, not executable code, so new templates/phrasings can
-- be added via the Admin Console (candlestickQuestionTemplate.service.ts's matchTemplate())
-- without a deploy:
--   { "fixedFilters": { "<filterField>": "<fixedValue>" },
--     "groupFilters":  { "<regex capture group index>": "<filterField>" } }
-- Both resolve into the same filterPatternsByMetadata() call Phase 1 already built (migration
-- 054/055) - this table never introduces new query logic, only new ways to call existing logic.
--
-- response_mode is 'single' (the template expects exactly one matching pattern, e.g. a named
-- lookup) or 'list' (the template expects zero-or-more, e.g. "which patterns are X" - answered by
-- joining every matching pattern's name). Explicit column rather than inferred from the mapping
-- shape, so the engine's formatting logic never has to guess.
--
-- regex_pattern is matched case-insensitively against the raw question text (see
-- matchTemplate()'s own 'i' flag) - stored here without delimiters/flags, same "store the
-- pattern, let the engine own how it's applied" split as every other regex-as-data table design.
--
-- Every pattern below ends its capture group with a trailing $ anchor - a real bug caught live
-- before this shipped: a lazy (.+?) capture group with nothing MANDATORY after it (just an
-- optional \??) has no reason to expand past 1 character, since the engine only expands a lazy
-- quantifier when the rest of the pattern would otherwise fail to match. bias_lookup's own
-- capture happens to be safe without $ (it's followed by the mandatory literal " bullish or
-- bearish"), but mirror_lookup's was not - confirmed live, it captured just "h" from "Hammer"
-- until $ was added. Anchoring every template to end-of-string is the simplest way to avoid this
-- whole class of bug for any future admin-authored template too, not just a fix for this one.
CREATE TABLE m_question_template (
  id SERIAL PRIMARY KEY,
  template_key VARCHAR(50) NOT NULL UNIQUE,
  regex_pattern TEXT NOT NULL,
  response_mode VARCHAR(10) NOT NULL, -- 'single' | 'list', app-validated
  filter_mapping JSONB NOT NULL,
  answer_template TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'inactive', app-validated
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3 deliberately conservative seed templates - the smallest set that still demonstrates all 3
-- mapping shapes (a single-capture-group lookup, a mirror-field lookup, and a list query).
-- regex_pattern values use a tagged $re$...$re$ dollar-quote (not the plain $$...$$ used for the
-- other string literals below) specifically because each one now ends in a literal $ anchor -
-- a plain $$ delimiter can't safely contain a trailing bare $ right before its own closing $$.
INSERT INTO m_question_template (template_key, regex_pattern, response_mode, filter_mapping, answer_template) VALUES
  ('bias_lookup', $re$is (.+?) bullish or bearish\??$$re$, 'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym"}}',
   $${patternName} is {directionalBias}.$$),
  ('mirror_lookup', $re$what(?:'s| is) the (?:opposite|mirror) of (.+?)\??$$re$, 'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym"}}',
   $$The mirror of {patternName} is {mirrorPatternName}.$$),
  ('signal_type_list', $re$which patterns? (?:are|is) (reversal|continuation|indecision) signals?\??$$re$, 'list',
   '{"fixedFilters": {}, "groupFilters": {"1": "signalType"}}',
   $$The {signalType} patterns are: {patternNameList}.$$);
