-- Candlestick Pattern Q&A - loosens grammar rigidity in 4 of the 10 question templates
-- (2026-10-08), found live by the user asking real variants of mirror_lookup's own example
-- phrasing ("What is opposite of Bullish Kicking?" / "What are opposite of Bullish Kicking?" -
-- neither matched; only the canonical "What is THE opposite of..." did). Data only, no DDL -
-- corrective UPDATEs to existing regex_pattern values, same precedent as migration 060's own
-- live dollar-quoting fix.
--
-- Deliberately NOT a general "strip common words before matching" preprocessor - for a
-- regex-based deterministic matcher, blindly stripping words is dangerous (e.g. stripping "not"
-- would flip "is Hammer NOT bullish" into a false match). Instead, loosened just the specific
-- templates whose regex hard-required an exact article ("the"/"a") or only one verb form
-- (is/are) - the other 6 templates already tolerate this (e.g. signal_type_list/bias_list's own
-- "(?:are|is)" + "patterns?").
--
-- mirror_lookup: "the" is now optional ("the "? instead of a mandatory literal), and "are" is
-- accepted alongside "'s"/"is". bias_lookup: "are" accepted alongside "is". gap_requirement_lookup/
-- gap_required_list: the article "a" before "gap" is now optional.
UPDATE m_question_template SET regex_pattern = $re$(?:is|are) (.+?) bullish or bearish\??$$re$, updated_at = now()
  WHERE template_key = 'bias_lookup';

UPDATE m_question_template SET regex_pattern = $re$what(?:'s| is| are)? ?(?:the )?(?:opposite|mirror) of (.+?)\??$$re$, updated_at = now()
  WHERE template_key = 'mirror_lookup';

UPDATE m_question_template SET regex_pattern = $re$does (.+?) (?:require|need) a? ?gap\??$$re$, updated_at = now()
  WHERE template_key = 'gap_requirement_lookup';

UPDATE m_question_template SET regex_pattern = $re$which patterns? (?:require|need) a? ?gap\??$$re$, updated_at = now()
  WHERE template_key = 'gap_required_list';
