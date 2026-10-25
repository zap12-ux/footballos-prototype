CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`version_id` text NOT NULL,
	`document_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`installed` integer DEFAULT false NOT NULL,
	`sources` text NOT NULL,
	`status` text NOT NULL,
	`basis` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `playbook_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `concepts_version_idx` ON `concepts` (`version_id`);--> statement-breakpoint
CREATE INDEX `concepts_document_idx` ON `concepts` (`document_id`);--> statement-breakpoint
CREATE TABLE `depth_charts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`season_id` text NOT NULL,
	`unit` text NOT NULL,
	`slots` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `depth_charts_team_season_unit_unique` ON `depth_charts` (`team_id`,`season_id`,`unit`);--> statement-breakpoint
CREATE TABLE `game_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text NOT NULL,
	`unit` text NOT NULL,
	`current_version_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `scheduled_games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_plans_game_unit_unique` ON `game_plans` (`game_id`,`unit`);--> statement-breakpoint
CREATE TABLE `personnel_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`season_id` text NOT NULL,
	`unit` text NOT NULL,
	`name` text NOT NULL,
	`player_ids` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `personnel_packages_team_season_idx` ON `personnel_packages` (`team_id`,`season_id`);--> statement-breakpoint
CREATE TABLE `plan_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`version_id` text NOT NULL,
	`section_key` text,
	`item_id` text,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `plan_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plan_comments_version_idx` ON `plan_comments` (`version_id`);--> statement-breakpoint
CREATE TABLE `plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text NOT NULL,
	`based_on` text,
	`sections` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`submitted_at` text,
	`approved_by` text,
	`approved_at` text,
	`override` integer DEFAULT false NOT NULL,
	`baseline_hashes` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `game_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plan_versions_plan_idx` ON `plan_versions` (`plan_id`);--> statement-breakpoint
CREATE TABLE `playbook_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`unit` text NOT NULL,
	`title` text NOT NULL,
	`asset_id` text NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`extraction` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `playbook_documents_team_unit_idx` ON `playbook_documents` (`team_id`,`unit`);--> statement-breakpoint
CREATE UNIQUE INDEX `playbook_documents_asset_unique` ON `playbook_documents` (`asset_id`);--> statement-breakpoint
CREATE TABLE `playbook_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`image_key` text,
	`ocr_text` text,
	`ocr_confidence` real,
	`text_source` text NOT NULL,
	`width` integer,
	`height` integer,
	FOREIGN KEY (`document_id`) REFERENCES `playbook_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playbook_pages_document_page_unique` ON `playbook_pages` (`document_id`,`page_number`);--> statement-breakpoint
CREATE TABLE `playbook_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`unit` text NOT NULL,
	`season_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`supersedes` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `playbook_versions_team_unit_idx` ON `playbook_versions` (`team_id`,`unit`,`season_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`season_id` text NOT NULL,
	`jersey` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`positions` text NOT NULL,
	`class_year` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`strengths` text NOT NULL,
	`development_priorities` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`availability` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `players_team_season_idx` ON `players` (`team_id`,`season_id`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text NOT NULL,
	`unit` text NOT NULL,
	`statement` text NOT NULL,
	`supporting_findings` text NOT NULL,
	`supporting_evidence` text NOT NULL,
	`counts` text NOT NULL,
	`limitations` text NOT NULL,
	`contrary_evidence` text NOT NULL,
	`playbook_concept_ids` text NOT NULL,
	`personnel_package_ids` text NOT NULL,
	`status` text NOT NULL,
	`stale_reason` text,
	`decided_by` text,
	`decided_at` text,
	`edited_statement` text,
	`decision_note` text,
	`plan_item_id` text,
	`inputs_hash` text NOT NULL,
	`input_hashes` text NOT NULL,
	`generation_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `scheduled_games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recommendations_game_unit_idx` ON `recommendations` (`game_id`,`unit`);--> statement-breakpoint
CREATE INDEX `recommendations_team_idx` ON `recommendations` (`team_id`);--> statement-breakpoint
CREATE TABLE `roster_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`season_id` text NOT NULL,
	`filename` text NOT NULL,
	`status` text NOT NULL,
	`mapping` text NOT NULL,
	`row_count` integer NOT NULL,
	`rows` text NOT NULL,
	`errors` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `roster_imports_team_idx` ON `roster_imports` (`team_id`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `share_links_team_idx` ON `share_links` (`team_id`);--> statement-breakpoint
CREATE INDEX `share_links_target_idx` ON `share_links` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `terms` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`version_id` text NOT NULL,
	`document_id` text,
	`term` text NOT NULL,
	`definition` text DEFAULT '' NOT NULL,
	`sources` text NOT NULL,
	`status` text NOT NULL,
	`basis` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `playbook_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `terms_version_idx` ON `terms` (`version_id`);--> statement-breakpoint
CREATE INDEX `terms_document_idx` ON `terms` (`document_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text,
	`uploaded_by` text NOT NULL,
	`kind` text NOT NULL,
	`original_filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text,
	`mime_type` text NOT NULL,
	`duration_sec` real,
	`width` integer,
	`height` integer,
	`fps` real,
	`container` text,
	`status` text NOT NULL,
	`rejection_reason` text,
	`context` text NOT NULL,
	`quality` text,
	`storage_key` text NOT NULL,
	`proxy_storage_key` text,
	`thumbnail_sheet_key` text,
	`retention_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `scheduled_games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_media_assets`("id", "team_id", "game_id", "uploaded_by", "kind", "original_filename", "byte_size", "sha256", "mime_type", "duration_sec", "width", "height", "fps", "container", "status", "rejection_reason", "context", "quality", "storage_key", "proxy_storage_key", "thumbnail_sheet_key", "retention_until", "created_at", "updated_at") SELECT "id", "team_id", "game_id", "uploaded_by", "kind", "original_filename", "byte_size", "sha256", "mime_type", "duration_sec", "width", "height", "fps", "container", "status", "rejection_reason", "context", "quality", "storage_key", "proxy_storage_key", "thumbnail_sheet_key", "retention_until", "created_at", "updated_at" FROM `media_assets`;--> statement-breakpoint
DROP TABLE `media_assets`;--> statement-breakpoint
ALTER TABLE `__new_media_assets` RENAME TO `media_assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `media_assets_team_game_idx` ON `media_assets` (`team_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `media_assets_team_sha_idx` ON `media_assets` (`team_id`,`sha256`);