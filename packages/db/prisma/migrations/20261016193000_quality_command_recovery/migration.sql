CREATE TABLE `quality_commands` (
  `key` VARCHAR(100) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `actorId` CHAR(36) NOT NULL,
  `sourceId` CHAR(36) NOT NULL,
  `ncrId` CHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`),
  UNIQUE INDEX `quality_commands_ncrId_key` (`ncrId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `quality_commands` ADD CONSTRAINT `quality_commands_ncrId_fkey` FOREIGN KEY (`ncrId`) REFERENCES `nonconformances` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
