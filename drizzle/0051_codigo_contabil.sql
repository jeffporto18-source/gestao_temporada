ALTER TABLE `chart_accounts` ADD COLUMN `codigoContabil` varchar(50);
--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD COLUMN `codigoContabil` varchar(50);
--> statement-breakpoint
ALTER TABLE `ledger_charges` ADD COLUMN `codigoContabil` varchar(50);
