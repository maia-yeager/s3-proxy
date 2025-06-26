ALTER TABLE `users_table` RENAME TO `buckets`;--> statement-breakpoint
DROP INDEX `users_table_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `buckets_name_unique` ON `buckets` (`name`);