ALTER TABLE `nonconformances` ADD COLUMN `qmsFields` JSON NULL, ADD COLUMN `archivedAt` DATETIME(3) NULL;
ALTER TABLE `users` ADD COLUMN `legacyPermissions` JSON NULL;
CREATE TABLE `operational_templates` (
  `id` CHAR(36) NOT NULL,
  `currentRevisionId` CHAR(36) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `operational_templates_currentRevisionId_key` (`currentRevisionId`),
  CONSTRAINT `operational_templates_currentRevisionId_fkey` FOREIGN KEY (`currentRevisionId`) REFERENCES `inspection_plan_revisions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
