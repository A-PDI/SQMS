-- AlterTable
ALTER TABLE `notification_deliveries` ADD COLUMN `body` TEXT NULL,
    ADD COLUMN `kind` ENUM('NOTIFICATION', 'DIRECT') NOT NULL DEFAULT 'NOTIFICATION',
    ADD COLUMN `subject` VARCHAR(300) NULL,
    MODIFY `notificationId` CHAR(36) NULL;
