-- Admin-switchable LLM provider for the Candlestick Q&A free-text ask path (2026-10-08). Same
-- "Candlestick Q&A" m_config_group as migration 047's model/rate-limit properties. Default
-- 'anthropic' so this migration ships with zero behavior change on apply - switching providers
-- is a deliberate admin action via the Config Properties admin page, not a side effect of
-- applying this migration.
--
-- Pairs with the existing candlestick_question_answer_llm_model property: this one picks which
-- platform (anthropic/openai), that one picks which model ID on that platform. There's no
-- DB-level cross-validation between the two - an admin who flips provider without also updating
-- model to a valid ID for that platform will get an upstream "unknown model" error from the
-- provider's own API on the next real ask call, not a friendly validation message.
INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'candlestick_question_answer_llm_provider', 'LLM Provider',
       'Which LLM provider the free-text ask path calls: "anthropic" or "openai". The LLM Model property must hold a model ID valid for whichever provider is selected here - there is no automatic cross-check.',
       'string', NULL, NULL, 'active'
FROM m_config_group WHERE name = 'Candlestick Q&A';

INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
SELECT id, 'anthropic', 1, true, NULL
FROM m_config_property WHERE property_key = 'candlestick_question_answer_llm_provider';
