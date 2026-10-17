CREATE INDEX `incoming_inspections_createdById_idx` ON `incoming_inspections`(`createdById`);
CREATE INDEX `incoming_inspections_completedById_idx` ON `incoming_inspections`(`completedById`);
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_completedById_fkey` FOREIGN KEY (`completedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
