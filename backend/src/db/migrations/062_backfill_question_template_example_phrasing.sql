-- Backfill for migration 061's example_phrasing column. Data only, no DDL - see migration 061's
-- own header (and 048's) for why the schema change and its backfill are split across files.
--
-- One hand-written, plain-English example per existing template (migrations 057/060) that would
-- actually match that template's own regex_pattern - confirmed by reading each regex, not guessed.
UPDATE m_question_template SET example_phrasing = 'Is Hammer bullish or bearish?' WHERE template_key = 'bias_lookup';
UPDATE m_question_template SET example_phrasing = 'What is the opposite of Hammer?' WHERE template_key = 'mirror_lookup';
UPDATE m_question_template SET example_phrasing = 'Which patterns are reversal signals?' WHERE template_key = 'signal_type_list';
UPDATE m_question_template SET example_phrasing = 'What does Hammer mean?' WHERE template_key = 'pattern_description';
UPDATE m_question_template SET example_phrasing = 'What signal type is Hammer?' WHERE template_key = 'signal_type_lookup';
UPDATE m_question_template SET example_phrasing = 'Does Piercing Line require a gap?' WHERE template_key = 'gap_requirement_lookup';
UPDATE m_question_template SET example_phrasing = 'What trend does Hammer need?' WHERE template_key = 'trend_context_lookup';
UPDATE m_question_template SET example_phrasing = 'Hammer bullish or bearish' WHERE template_key = 'bias_lookup_relaxed';
UPDATE m_question_template SET example_phrasing = 'Which patterns are bullish?' WHERE template_key = 'bias_list';
UPDATE m_question_template SET example_phrasing = 'Which patterns need a gap?' WHERE template_key = 'gap_required_list';
