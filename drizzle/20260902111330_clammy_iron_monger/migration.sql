ALTER TABLE `relationships` ADD `directed` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `evidence_item_ids` text NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `extracted_record_ids` text NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `conflicts` text NOT NULL;--> statement-breakpoint
ALTER TABLE `relationships` ADD `attributes` text NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_relationships` (
	`id` text PRIMARY KEY,
	`investigation_id` text NOT NULL,
	`source_entity_id` text NOT NULL,
	`target_entity_id` text NOT NULL,
	`relationship_type` text NOT NULL,
	`directed` integer NOT NULL,
	`evidence_item_ids` text NOT NULL,
	`extracted_record_ids` text NOT NULL,
	`conflicts` text NOT NULL,
	`attributes` text NOT NULL,
	`classification` text NOT NULL,
	`provenance_source` text NOT NULL,
	`provenance_location` text NOT NULL,
	`provenance_method` text NOT NULL,
	`provenance_confidence` real NOT NULL,
	`provenance_processing_history` text NOT NULL,
	`provenance_timestamp` text NOT NULL,
	CONSTRAINT `fk_relationships_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_relationships`(`id`, `investigation_id`, `source_entity_id`, `target_entity_id`, `relationship_type`, `classification`, `provenance_source`, `provenance_location`, `provenance_method`, `provenance_confidence`, `provenance_processing_history`, `provenance_timestamp`) SELECT `id`, `investigation_id`, `source_entity_id`, `target_entity_id`, `relationship_type`, `classification`, `provenance_source`, `provenance_location`, `provenance_method`, `provenance_confidence`, `provenance_processing_history`, `provenance_timestamp` FROM `relationships`;--> statement-breakpoint
DROP TABLE `relationships`;--> statement-breakpoint
ALTER TABLE `__new_relationships` RENAME TO `relationships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;