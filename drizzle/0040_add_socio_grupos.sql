CREATE TABLE `socio_grupos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`nome` varchar(150) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `socio_grupos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `socios` ADD `grupoId` int;
