CREATE TABLE `statements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`ano` int NOT NULL,
	`mes` int NOT NULL,
	`arquivoUrl` varchar(500),
	`arquivoKey` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `statements_id` PRIMARY KEY(`id`),
	CONSTRAINT `statements_owner_ano_mes` UNIQUE(`ownerId`,`ano`,`mes`)
);
