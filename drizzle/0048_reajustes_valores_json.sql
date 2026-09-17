ALTER TABLE `long_term_contracts` DROP COLUMN `valorReajuste1`;
--> statement-breakpoint
ALTER TABLE `long_term_contracts` DROP COLUMN `valorReajuste2`;
--> statement-breakpoint
ALTER TABLE `long_term_contracts` ADD COLUMN `reajustesValores` json;
