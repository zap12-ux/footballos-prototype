ALTER TABLE `plan_versions` ADD `override_reason` text;--> statement-breakpoint
ALTER TABLE `plan_versions` ADD `superseded_at` text;--> statement-breakpoint
ALTER TABLE `plan_versions` ADD `superseded_by_version_id` text;
