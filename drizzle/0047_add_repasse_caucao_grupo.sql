ALTER TABLE `chart_accounts` MODIFY COLUMN `grupo` enum('conta_principal','despesa_fixa','despesa_variavel','receita','aporte_capital','repasse_caucao') NOT NULL;
--> statement-breakpoint
ALTER TABLE `ledger_entries` MODIFY COLUMN `grupo` enum('despesa_fixa','despesa_variavel','receita','aporte_capital','repasse_caucao') NOT NULL;
--> statement-breakpoint
ALTER TABLE `ledger_charges` MODIFY COLUMN `grupo` enum('despesa_fixa','despesa_variavel','receita','aporte_capital','repasse_caucao') NOT NULL;
