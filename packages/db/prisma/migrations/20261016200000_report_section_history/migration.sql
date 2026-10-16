ALTER TABLE `ncr_report_sections` ADD COLUMN `archivedAt` DATETIME(3) NULL;
ALTER TABLE `record_attachments` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `nonconformances` ADD COLUMN `purchaseOrder` VARCHAR(200) NULL;
