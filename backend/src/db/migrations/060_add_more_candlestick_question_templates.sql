-- Candlestick Pattern Q&A - 7 more question templates (2026-10-08), closing a real usability
-- gap: the original 3 templates (migration 057) only matched 3 very specific phrasings, so a
-- role without candlestick_question_answer:llm_calling got 'unable_to_answer' for almost any
-- real question. These broaden coverage of plausible phrasings without touching the original 3.
--
-- Same regex_pattern conventions as migration 057: case-insensitive match against the raw
-- question text, every pattern ends in \??$ (the lazy-capture-needs-an-end-anchor bug class
-- documented there), tagged $re$...$re$ dollar-quoting for any pattern ending in a literal $.
--
-- Three of these (pattern_description, signal_type_lookup, gap_requirement_lookup,
-- trend_context_lookup) are single-pattern lookups that reuse several of
-- filterPatternsByMetadata()'s structural fields the original 3 templates never exposed
-- (requiresGap, trendContext, and the generic "describe this pattern" case covering
-- complexityTier/signalType/directionalBias together). bias_list/gap_required_list mirror
-- signal_type_list's own list-mode shape for two more axes (directionalBias, requiresGap).
-- bias_lookup_relaxed drops bias_lookup's required "is"/"?" for a terser phrasing.
INSERT INTO m_question_template (template_key, regex_pattern, response_mode, filter_mapping, answer_template) VALUES
  ('pattern_description',
   $re$(?:what does (.+?) mean|describe (.+?)|tell me about (.+?))\??$$re$,
   'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym", "2": "patternNameOrSynonym", "3": "patternNameOrSynonym"}}',
   $${patternName} is a {complexityTier}-candle {signalType} pattern with a {directionalBias} bias.$$),
  ('signal_type_lookup',
   $re$what (?:signal type is|type of signal is) (.+?)\??$$re$,
   'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym"}}',
   $${patternName} is a {signalType} signal.$$),
  ('gap_requirement_lookup',
   $re$does (.+?) (?:require|need) a gap\??$$re$,
   'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym"}}',
   $${patternName} {requiresGapText} require a gap.$$),
  ('trend_context_lookup',
   $re$what trend(?: context)? does (.+?) (?:need|require)\??$$re$,
   'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym"}}',
   $${patternName} typically needs {trendContext}.$$),
  ('bias_lookup_relaxed',
   $re$(.+?) bullish or bearish\??$$re$,
   'single',
   '{"fixedFilters": {}, "groupFilters": {"1": "patternNameOrSynonym"}}',
   $${patternName} is {directionalBias}.$$),
  ('bias_list',
   $re$which patterns? (?:are|is) (bullish|bearish|neutral)\??$$re$,
   'list',
   '{"fixedFilters": {}, "groupFilters": {"1": "directionalBias"}}',
   $$The {directionalBias} patterns are: {patternNameList}.$$),
  ('gap_required_list',
   $re$which patterns? (?:require|need) a gap\??$$re$,
   'list',
   '{"fixedFilters": {"requiresGap": true}, "groupFilters": {}}',
   $$These patterns require a gap: {patternNameList}.$$);
