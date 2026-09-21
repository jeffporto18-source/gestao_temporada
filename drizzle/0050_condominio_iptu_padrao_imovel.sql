ALTER TABLE `properties` ADD COLUMN `condominioPorPadrao` enum('proprietario','inquilino_direto') NOT NULL DEFAULT 'proprietario';
--> statement-breakpoint
ALTER TABLE `properties` ADD COLUMN `iptuPorPadrao` enum('proprietario','inquilino_direto') NOT NULL DEFAULT 'proprietario';
--> statement-breakpoint
ALTER TABLE `ledger_charges` ADD COLUMN `propertyCostId` int;
--> statement-breakpoint
ALTER TABLE `ledger_charges` MODIFY COLUMN `ledgerEntryId` int;
