-- Candlestick Pattern Q&A - adds a basic "What is <pattern>?" phrasing (closing a real gap the
-- user flagged directly: there was no template that answered the single most natural question
-- shape in this whole feature) plus 3 more templates for coverage the existing 10 didn't reach -
-- candle-count/complexity lookup, and prior-uptrend/prior-downtrend pattern lists.
--
-- Same regex_pattern conventions as migrations 057/060/064: case-insensitive match against the
-- raw question text, every pattern ends in \??$ (the lazy-capture-needs-an-end-anchor bug class
-- documented in 057's header), $re$...$re$ dollar-quoting for patterns ending in a literal $.
--
-- pattern_description's own regex grows a 4th branch for "what is X"/"what's X"/"what is a X"
-- etc. - deliberately requiring "'s" or (whitespace+)"is" immediately after "what" (only
-- whitespace allowed in between) so it can never accidentally swallow a different template's own
-- shape that merely starts with "what" followed by other words first (e.g. "what signal type is
-- X", "what trend does X need") - those fail this branch outright (the literal "is"/"'s" isn't
-- the very next token after "what") and correctly fall through to their own, more specific
-- templates later in iteration order (both have a higher id than pattern_description, so this
-- was already true before this change too - this new branch doesn't alter that ordering
-- guarantee, just confirmed it holds for the new phrasing as well).
--
-- Its answer_template is also made considerably richer - previously a single terse sentence
-- (complexity/signal/bias only), now also states trend context, gap requirement, and the mirror
-- pattern, using placeholders that already existed in candlestickQuestionTemplate.service.ts's
-- buildPlaceholders() - no backend code change needed. example_phrasing updated to "What is
-- Hammer?" (the exact shape that was missing) so the "(i)" info popover leads with it instead of
-- the less natural "What does Hammer mean?".
UPDATE m_question_template SET
  regex_pattern = $re$(?:what does (.+?) mean|describe (.+?)|tell me about (.+?)|what(?:'s|\s+is)\s+(?:a\s+|an\s+|the\s+)?(.+?))\??$$re$,
  filter_mapping = '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym", "2": "patternNameOrSynonym", "3": "patternNameOrSynonym", "4": "patternNameOrSynonym"}}',
  answer_template = $${patternName} is a {complexityTier}-candle {signalType} pattern with a {directionalBias} directional bias. It typically forms after {trendContext}, and {requiresGapText} require a gap to qualify. Its mirror pattern is {mirrorPatternName}.$$,
  example_phrasing = 'What is Hammer?',
  updated_at = now()
WHERE template_key = 'pattern_description';

-- 3 new templates: a single-pattern candle-count/complexity lookup, and two fixed-filter list
-- templates for the two directional trend_context values ('prior-uptrend'/'prior-downtrend') -
-- the other two trend_context values ('either'/'none') aren't natural things a user would ask
-- "which patterns need either/none", so deliberately not added as list templates.
--
-- Complexity-tier LIST templates (e.g. "which patterns are simple patterns?") were considered and
-- deliberately NOT added: filterPatternsByMetadata()'s complexityTier filter is an exact equality
-- match against the DB's capitalized enum values ('Simple'/'Composite'/'Advanced'/'Complex'), but
-- a regex capture group preserves the user's own original casing (typically lowercase, e.g.
-- "simple") - an exact-match filter against that would silently return zero rows every time.
-- Fixing it would need either 4 near-duplicate fixedFilters templates (one per tier) or a
-- case-normalization step matchTemplate() doesn't have today - skipped rather than shipping a
-- template that looks like it should work but never actually matches anything.
INSERT INTO m_question_template (template_key, regex_pattern, response_mode, filter_mapping, answer_template, example_phrasing) VALUES
  ('complexity_tier_lookup',
   $re$(?:what (?:complexity|tier) is (.+?)|how many candles does (.+?) (?:need|take|require))\??$$re$,
   'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym", "2": "patternNameOrSynonym"}}',
   $${patternName} is a {complexityTier} pattern.$$,
   'How many candles does Hammer need?'),
  ('trend_uptrend_list',
   $re$which patterns? (?:need|require) (?:a |an )?(?:prior[- ]?)?uptrend\??$$re$,
   'list',
   '{"fixedFilters": {"trendContext": "prior-uptrend"}, "groupFilters": {}}',
   $$These patterns typically need a prior uptrend: {patternNameList}.$$,
   'Which patterns need a prior uptrend?'),
  ('trend_downtrend_list',
   $re$which patterns? (?:need|require) (?:a |an )?(?:prior[- ]?)?downtrend\??$$re$,
   'list',
   '{"fixedFilters": {"trendContext": "prior-downtrend"}, "groupFilters": {}}',
   $$These patterns typically need a prior downtrend: {patternNameList}.$$,
   'Which patterns need a prior downtrend?');
