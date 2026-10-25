-- Fields adopted from the UI engineer's assumptions: last status message per agent, the
-- verification that closed a task, and who recorded a verification.
ALTER TABLE agents ADD COLUMN last_message TEXT;
ALTER TABLE tasks ADD COLUMN verification_id TEXT;
ALTER TABLE verifications ADD COLUMN recorded_by TEXT NOT NULL DEFAULT 'lead';
