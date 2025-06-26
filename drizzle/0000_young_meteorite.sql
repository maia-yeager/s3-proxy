CREATE TABLE `users_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`name` text NOT NULL,
	`accessKeyId` text NOT NULL,
	`secretAccessKey` text NOT NULL,
	`region` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_table_name_unique` ON `users_table` (`name`);