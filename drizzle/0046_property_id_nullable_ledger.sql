ALTER TABLE `ledger_entries` MODIFY COLUMN `propertyId` int;
--> statement-breakpoint
ALTER TABLE `ledger_charges` MODIFY COLUMN `propertyId` int;
