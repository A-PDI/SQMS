ALTER TABLE `inspection_results` ADD COLUMN `specificationSnapshot` JSON NULL;
ALTER TABLE `incoming_inspections` ADD COLUMN `receivedDate` DATE NULL;
ALTER TABLE `ncr_defect_lines` ADD COLUMN `firstArticleResultId` CHAR(36) NULL;
ALTER TABLE `ncr_defect_lines` ADD CONSTRAINT `ncr_defect_lines_firstArticleResultId_fkey` FOREIGN KEY (`firstArticleResultId`) REFERENCES `inspection_results` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
