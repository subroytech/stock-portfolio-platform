-- API Key Fallback: config-driven eligible roles list. Converts
-- userSubscription.service.ts's hardcoded FALLBACK_ELIGIBLE_ROLES array into the Config
-- Properties framework's second real consumer (the first being contrarianFinder.service.ts's
-- admin-tier retention count) - so admin-master can change which roles fall back to the
-- admin-master account's own FMP/Finnhub key without a code deploy. Surfaced live: a new
-- custom role (user-premium) had no key of its own and wasn't in the hardcoded list, so every
-- FMP-dependent feature hard-503'd for it with no way to fix that short of a code change.
--
-- Value is a comma-separated string (the framework has no list/array type) - parsed at read
-- time by configProperty.service.ts's getConfigStringList(). Seeded with today's original three
-- roles plus user-premium (added, not replacing - dropping 'admin'/'user-contra-wokey' would
-- silently break user-contra-wokey's entire documented purpose, a role designed to never need
-- its own key). min_value/max_value stay NULL - range validation is numeric-only.
INSERT INTO m_config_group (name, description)
VALUES ('API Key Access Policies', 'Which roles fall back to the admin-master account''s own FMP/Finnhub key when they have none of their own on file.');

INSERT INTO m_config_property (group_id, property_key, name, description, value_type, min_value, max_value, status)
SELECT id, 'api_key_fallback_eligible_roles', 'API Key Fallback Eligible Roles',
       'Comma-separated role names that fall back to the admin-master account''s own FMP/Finnhub key when they have none of their own on file. Read by userSubscription.service.ts''s getDecryptedKey(). Role names are validated against m_roles when this value is changed.',
       'string', NULL, NULL, 'active'
FROM m_config_group WHERE name = 'API Key Access Policies';

INSERT INTO m_config_property_value (property_id, value, version, is_active, changed_by)
SELECT id, 'user,admin,user-contra-wokey,user-premium', 1, true, NULL
FROM m_config_property WHERE property_key = 'api_key_fallback_eligible_roles';
