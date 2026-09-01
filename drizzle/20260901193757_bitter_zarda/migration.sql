CREATE TABLE `ai_inferences` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`claim` text NOT NULL,
	`based_on` text NOT NULL,
	`confidence` real NOT NULL,
	`classification` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_ai_inferences_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `aliases` (
	`id` text PRIMARY KEY,
	`entity_id` text NOT NULL,
	`alias_value` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_aliases_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`)
);
--> statement-breakpoint
CREATE TABLE `analytical_signals` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`graph_version` text NOT NULL,
	`target_entity_id` text,
	`signal_type` text NOT NULL,
	`value` text NOT NULL,
	`method` text NOT NULL,
	`explanation` text NOT NULL,
	`classification` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_analytical_signals_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`),
	CONSTRAINT `fk_analytical_signals_target_entity_id_entities_id_fk` FOREIGN KEY (`target_entity_id`) REFERENCES `entities`(`id`)
);
--> statement-breakpoint
CREATE TABLE `communication_events` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`caller_phone` text NOT NULL,
	`callee_phone` text NOT NULL,
	`caller_entity_id` text,
	`callee_entity_id` text,
	`occurred_at` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`cell_location_id` text,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_communication_events_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`),
	CONSTRAINT `fk_communication_events_caller_entity_id_entities_id_fk` FOREIGN KEY (`caller_entity_id`) REFERENCES `entities`(`id`),
	CONSTRAINT `fk_communication_events_callee_entity_id_entities_id_fk` FOREIGN KEY (`callee_entity_id`) REFERENCES `entities`(`id`),
	CONSTRAINT `fk_communication_events_cell_location_id_locations_id_fk` FOREIGN KEY (`cell_location_id`) REFERENCES `locations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`kind` text NOT NULL,
	`canonical_label` text NOT NULL,
	`attributes` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_entities_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `evidence_items` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`evidence_source_id` text NOT NULL,
	`item_type` text NOT NULL,
	`content` text NOT NULL,
	`ingested_at` text NOT NULL,
	`validation_status` text NOT NULL,
	`rejection_reason` text,
	`errors` text NOT NULL,
	`warnings` text NOT NULL,
	`confidence` real NOT NULL,
	CONSTRAINT `fk_evidence_items_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`),
	CONSTRAINT `fk_evidence_items_evidence_source_id_evidence_sources_id_fk` FOREIGN KEY (`evidence_source_id`) REFERENCES `evidence_sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE `evidence_sources` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`source_type` text NOT NULL,
	`label` text NOT NULL,
	`ingested_at` text NOT NULL,
	CONSTRAINT `fk_evidence_sources_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `extracted_records` (
	`id` text PRIMARY KEY,
	`evidence_item_id` text NOT NULL,
	`record_type` text NOT NULL,
	`data` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_extracted_records_evidence_item_id_evidence_items_id_fk` FOREIGN KEY (`evidence_item_id`) REFERENCES `evidence_items`(`id`)
);
--> statement-breakpoint
CREATE TABLE `financial_transactions` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`from_account_entity_id` text,
	`to_account_entity_id` text,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`occurred_at` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_financial_transactions_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`),
	CONSTRAINT `fk_financial_transactions_from_account_entity_id_entities_id_fk` FOREIGN KEY (`from_account_entity_id`) REFERENCES `entities`(`id`),
	CONSTRAINT `fk_financial_transactions_to_account_entity_id_entities_id_fk` FOREIGN KEY (`to_account_entity_id`) REFERENCES `entities`(`id`)
);
--> statement-breakpoint
CREATE TABLE `investigations` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investigative_leads` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`suggestion` text NOT NULL,
	`related_entity_ids` text NOT NULL,
	`classification` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_investigative_leads_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`label` text NOT NULL,
	`location_type` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_locations_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`source_entity_id` text NOT NULL,
	`target_entity_id` text NOT NULL,
	`relationship_type` text NOT NULL,
	`classification` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_relationships_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`),
	CONSTRAINT `fk_relationships_source_entity_id_entities_id_fk` FOREIGN KEY (`source_entity_id`) REFERENCES `entities`(`id`),
	CONSTRAINT `fk_relationships_target_entity_id_entities_id_fk` FOREIGN KEY (`target_entity_id`) REFERENCES `entities`(`id`)
);
