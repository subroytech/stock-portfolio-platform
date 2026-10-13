-- Self-registration (CLAUDE.md's "Self-Registration & Password Policy" section) needs a real
-- first/last name on file - not just for display, but because the password policy itself
-- rejects a password containing either name (passwordPolicy.ts). Nullable: existing rows and
-- admin-created accounts (users.service.ts's createUserAccount, which doesn't collect a name)
-- are unaffected - the name-substring password rule just silently doesn't apply when these are
-- null, same graceful-degradation precedent as configProperty.service.ts's getConfigInt().
ALTER TABLE users ADD COLUMN first_name VARCHAR(50);
ALTER TABLE users ADD COLUMN last_name VARCHAR(50);
