PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_analytical_signals` (
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
	CONSTRAINT `fk_analytical_signals_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_analytical_signals`(`id`, `investigation_id`, `graph_version`, `target_entity_id`, `signal_type`, `value`, `method`, `explanation`, `classification`, `provenance_source`, `provenance_location`, `provenance_method`, `provenance_confidence`, `provenance_processing_history`, `provenance_timestamp`) SELECT `id`, `investigation_id`, `graph_version`, `target_entity_id`, `signal_type`, `value`, `method`, `explanation`, `classification`, `provenance_source`, `provenance_location`, `provenance_method`, `provenance_confidence`, `provenance_processing_history`, `provenance_timestamp` FROM `analytical_signals`;--> statement-breakpoint
DROP TABLE `analytical_signals`;--> statement-breakpoint
ALTER TABLE `__new_analytical_signals` RENAME TO `analytical_signals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;