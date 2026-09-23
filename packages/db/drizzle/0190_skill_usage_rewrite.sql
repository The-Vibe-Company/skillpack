-- Checkpoint the historical archive retrofit separately from schema migration completion.
-- Only the release process, using the migration owner, performs this resumable maintenance.
ALTER TABLE skill_versions ADD COLUMN usage_reporting_revision integer NOT NULL DEFAULT 0;
