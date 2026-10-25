CREATE TABLE `label_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`label_id` text NOT NULL,
	`previous_value` text,
	`new_value` text,
	`previous_status` text NOT NULL,
	`new_status` text NOT NULL,
	`by_user_id` text NOT NULL,
	`at` text NOT NULL,
	`reason` text,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `label_revisions_label_idx` ON `label_revisions` (`label_id`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`key` text NOT NULL,
	`inferred` text,
	`accepted` text NOT NULL,
	`provenance_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `play_segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_segment_key_unique` ON `labels` (`segment_id`,`key`);--> statement-breakpoint
CREATE INDEX `labels_team_idx` ON `labels` (`team_id`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`game_id` text NOT NULL,
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
CREATE INDEX `media_assets_team_game_idx` ON `media_assets` (`team_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `media_assets_team_sha_idx` ON `media_assets` (`team_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `model_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`asset_id` text,
	`segment_id` text,
	`job_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`model_revision` text,
	`prompt_id` text NOT NULL,
	`prompt_hash` text NOT NULL,
	`preprocessing` text NOT NULL,
	`inspected` text NOT NULL,
	`analysis_version` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_usd` real NOT NULL,
	`latency_ms` integer NOT NULL,
	`requested_at` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `model_provenance_team_completed_idx` ON `model_provenance` (`team_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `model_provenance_asset_idx` ON `model_provenance` (`asset_id`);--> statement-breakpoint
CREATE TABLE `play_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`game_id` text NOT NULL,
	`index` integer NOT NULL,
	`start_sec` real NOT NULL,
	`end_sec` real NOT NULL,
	`origin` text NOT NULL,
	`review_status` text NOT NULL,
	`superseded_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `scheduled_games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `play_segments_asset_idx` ON `play_segments` (`asset_id`);--> statement-breakpoint
CREATE INDEX `play_segments_team_game_idx` ON `play_segments` (`team_id`,`game_id`);--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`asset_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`progress` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`lease_expires_at` text,
	`worker_id` text,
	`idempotency_key` text NOT NULL,
	`config_version` text NOT NULL,
	`error` text,
	`requested_by` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`canceled_at` text,
	`input` text,
	`result` text,
	`not_before_at` text,
	`cancel_requested_at` text,
	`depends_on_job_id` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `processing_jobs_idempotency_unique` ON `processing_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `processing_jobs_team_created_idx` ON `processing_jobs` (`team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `processing_jobs_status_idx` ON `processing_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `processing_jobs_asset_idx` ON `processing_jobs` (`asset_id`);--> statement-breakpoint
CREATE TABLE `report_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`opponent_id` text NOT NULL,
	`title` text NOT NULL,
	`findings` text NOT NULL,
	`generated_by` text NOT NULL,
	`generated_at` text NOT NULL,
	`inputs_hash` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opponent_id`) REFERENCES `opponents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `report_snapshots_team_opponent_idx` ON `report_snapshots` (`team_id`,`opponent_id`);--> statement-breakpoint
CREATE TABLE `team_settings` (
	`team_id` text PRIMARY KEY NOT NULL,
	`retention_days` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`team_id` text NOT NULL,
	`chunk_size_bytes` integer NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer NOT NULL,
	`expected_sha256` text,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uploads_team_idx` ON `uploads` (`team_id`);--> statement-breakpoint
CREATE INDEX `uploads_expires_idx` ON `uploads` (`expires_at`);