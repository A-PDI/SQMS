-- DropForeignKey
ALTER TABLE `nonconformances` DROP FOREIGN KEY `nonconformances_supplierId_fkey`;

-- DropForeignKey
ALTER TABLE `nonconformances` DROP FOREIGN KEY `nonconformances_internalPartId_fkey`;

-- AlterTable
ALTER TABLE `document_links` MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL;

-- AlterTable
ALTER TABLE `record_attachments` ADD COLUMN `context` JSON NULL,
    MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NULL;

-- AlterTable
ALTER TABLE `activity_events` MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL;

-- AlterTable
ALTER TABLE `audit_events` MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NULL;

-- AlterTable
ALTER TABLE `outbox_events` MODIFY `aggregateType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL;

-- AlterTable
ALTER TABLE `external_references` MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL;

-- AlterTable
ALTER TABLE `critical_characteristics` ADD COLUMN `featureId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `nonconformances` ADD COLUMN `firstArticleId` CHAR(36) NULL,
    ADD COLUMN `incomingInspectionId` CHAR(36) NULL,
    ADD COLUMN `legacyException` JSON NULL,
    ADD COLUMN `testRecordId` CHAR(36) NULL,
    MODIFY `source` ENUM('FIRST_ARTICLE', 'ENGINEERING_VALIDATION', 'INTERNAL', 'INCOMING_INSPECTION', 'IN_PROCESS', 'FINAL_INSPECTION', 'CUSTOMER_RETURN', 'FIELD_FAILURE', 'QUALIFICATION', 'AUDIT', 'OTHER') NOT NULL,
    MODIFY `supplierId` CHAR(36) NULL,
    MODIFY `internalPartId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `tasks` MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NULL;

-- AlterTable
ALTER TABLE `comments` MODIFY `entityType` ENUM('INCOMING_INSPECTION', 'INSPECTION_PLAN', 'INJECTOR_TEST', 'INJECTOR_REPAIR', 'ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL;

-- CreateTable
CREATE TABLE `inspection_plans` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `inspection_plans_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspection_plan_revisions` (
    `id` CHAR(36) NOT NULL,
    `planId` CHAR(36) NOT NULL,
    `revision` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'RELEASED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `definition` JSON NOT NULL,
    `definitionHash` CHAR(64) NULL,
    `releasedById` CHAR(36) NULL,
    `releasedAt` DATETIME(3) NULL,
    `legacyVersionUnknown` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `inspection_plan_revisions_planId_revision_key`(`planId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `part_inspection_specifications` (
    `id` CHAR(36) NOT NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `planRevisionId` CHAR(36) NOT NULL,
    `data` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `part_inspection_specifications_internalPartId_planRevisionId_key`(`internalPartId`, `planRevisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_identities` (
    `id` CHAR(36) NOT NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `name` VARCHAR(250) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `feature_identities_internalPartId_key_key`(`internalPartId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_revision_mappings` (
    `id` CHAR(36) NOT NULL,
    `featureId` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `balloonAlias` VARCHAR(80) NULL,
    `compatibility` VARCHAR(20) NOT NULL,
    `reason` TEXT NOT NULL,
    `reviewedById` CHAR(36) NOT NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `feature_revision_mappings_featureId_configurationRevisionId_key`(`featureId`, `configurationRevisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incoming_inspections` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(80) NOT NULL,
    `planRevisionId` CHAR(36) NOT NULL,
    `planSnapshot` JSON NOT NULL,
    `specificationSnapshot` JSON NULL,
    `internalPartId` CHAR(36) NULL,
    `supplierId` CHAR(36) NULL,
    `siteId` CHAR(36) NULL,
    `supplierProductId` CHAR(36) NULL,
    `configurationRevisionId` CHAR(36) NULL,
    `productApprovalId` CHAR(36) NULL,
    `originalPartNumber` VARCHAR(200) NULL,
    `originalSupplier` VARCHAR(250) NULL,
    `resolutionNotes` TEXT NULL,
    `header` JSON NOT NULL,
    `sectionData` JSON NOT NULL,
    `status` ENUM('DRAFT', 'IN_PROGRESS', 'COMPLETE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `disposition` VARCHAR(80) NULL,
    `itemCount` INTEGER NOT NULL DEFAULT 1,
    `assignedToId` CHAR(36) NULL,
    `dueAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `completedById` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `incoming_inspections_number_key`(`number`),
    INDEX `incoming_inspections_supplierId_internalPartId_status_idx`(`supplierId`, `internalPartId`, `status`),
    INDEX `incoming_inspections_assignedToId_status_dueAt_idx`(`assignedToId`, `status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incoming_items` (
    `id` CHAR(36) NOT NULL,
    `inspectionId` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `serialNumber` VARCHAR(200) NULL,
    `results` JSON NOT NULL,

    UNIQUE INDEX `incoming_items_inspectionId_position_key`(`inspectionId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incoming_measurements` (
    `id` CHAR(36) NOT NULL,
    `inspectionId` CHAR(36) NOT NULL,
    `itemId` CHAR(36) NULL,
    `featureId` CHAR(36) NULL,
    `sectionKey` VARCHAR(100) NOT NULL,
    `characteristicKey` VARCHAR(100) NOT NULL,
    `value` DECIMAL(24, 9) NULL,
    `textValue` VARCHAR(1000) NULL,
    `outcome` ENUM('PASS', 'FAIL', 'CONDITIONAL', 'NOT_INSPECTED') NOT NULL,
    `specification` JSON NOT NULL,
    `recordVersion` INTEGER NOT NULL DEFAULT 0,
    `supersededAt` DATETIME(3) NULL,

    INDEX `incoming_measurements_inspectionId_itemId_idx`(`inspectionId`, `itemId`),
    INDEX `incoming_measurements_featureId_idx`(`featureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `operational_alerts` (
    `id` CHAR(36) NOT NULL,
    `inspectionId` CHAR(36) NOT NULL,
    `completionVersion` INTEGER NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `notes` TEXT NULL,
    `acknowledgedById` CHAR(36) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `operational_alerts_inspectionId_completionVersion_key`(`inspectionId`, `completionVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legacy_records` (
    `id` CHAR(36) NOT NULL,
    `sourceSystem` VARCHAR(50) NOT NULL,
    `entity` VARCHAR(80) NOT NULL,
    `sourceId` VARCHAR(200) NOT NULL,
    `sourceHash` CHAR(64) NOT NULL,
    `snapshot` JSON NOT NULL,
    `targetType` VARCHAR(80) NULL,
    `targetId` CHAR(36) NULL,
    `targetHash` CHAR(64) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'UNRESOLVED',
    `reason` TEXT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `legacy_records_targetType_targetId_idx`(`targetType`, `targetId`),
    UNIQUE INDEX `legacy_records_sourceSystem_entity_sourceId_key`(`sourceSystem`, `entity`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `migration_runs` (
    `id` CHAR(36) NOT NULL,
    `datasetId` VARCHAR(100) NOT NULL,
    `sourceHash` CHAR(64) NOT NULL,
    `mode` VARCHAR(30) NOT NULL,
    `report` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ncr_defect_lines` (
    `id` CHAR(36) NOT NULL,
    `ncrId` CHAR(36) NOT NULL,
    `featureId` CHAR(36) NULL,
    `measurementId` CHAR(36) NULL,
    `defectCode` VARCHAR(80) NOT NULL,
    `deviationDirection` VARCHAR(30) NOT NULL,
    `severity` ENUM('MINOR', 'MAJOR', 'CRITICAL') NOT NULL,
    `specification` JSON NOT NULL,
    `actualCondition` TEXT NOT NULL,
    `quantityAffected` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ncr_defect_lines_featureId_defectCode_deviationDirection_idx`(`featureId`, `defectCode`, `deviationDirection`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ncr_report_sections` (
    `id` CHAR(36) NOT NULL,
    `ncrId` CHAR(36) NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `ncr_report_sections_ncrId_sortOrder_idx`(`ncrId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ncr_scar_links` (
    `ncrId` CHAR(36) NOT NULL,
    `scarId` CHAR(36) NOT NULL,
    `reason` TEXT NOT NULL,
    `linkedById` CHAR(36) NOT NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ncr_scar_links_scarId_idx`(`scarId`),
    PRIMARY KEY (`ncrId`, `scarId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recurrence_reviews` (
    `id` CHAR(36) NOT NULL,
    `currentNcrId` CHAR(36) NOT NULL,
    `historicalNcrId` CHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'CANDIDATE',
    `explanation` JSON NOT NULL,
    `reason` TEXT NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,

    INDEX `recurrence_reviews_historicalNcrId_idx`(`historicalNcrId`),
    UNIQUE INDEX `recurrence_reviews_currentNcrId_historicalNcrId_key`(`currentNcrId`, `historicalNcrId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `injector_tests` (
    `id` CHAR(36) NOT NULL,
    `reportExternalId` VARCHAR(200) NOT NULL,
    `slotPosition` INTEGER NOT NULL,
    `partNumber` VARCHAR(200) NULL,
    `serialNumber` VARCHAR(200) NULL,
    `normalizedSerial` VARCHAR(200) NULL,
    `jobNumber` VARCHAR(200) NULL,
    `testAt` DATETIME(3) NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `stepsTotal` INTEGER NOT NULL DEFAULT 0,
    `stepsPassed` INTEGER NOT NULL DEFAULT 0,
    `stepsFailed` INTEGER NOT NULL DEFAULT 0,
    `report` JSON NOT NULL,
    `sourceHash` CHAR(64) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `injector_tests_partNumber_normalizedSerial_testAt_idx`(`partNumber`, `normalizedSerial`, `testAt`),
    INDEX `injector_tests_jobNumber_testAt_idx`(`jobNumber`, `testAt`),
    UNIQUE INDEX `injector_tests_reportExternalId_slotPosition_key`(`reportExternalId`, `slotPosition`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `injector_repair_cases` (
    `id` CHAR(36) NOT NULL,
    `partNumber` VARCHAR(200) NOT NULL,
    `serialNumber` VARCHAR(200) NOT NULL,
    `normalizedSerial` VARCHAR(200) NOT NULL,
    `activeKey` CHAR(64) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    `initialTestSnapshot` JSON NOT NULL,
    `finalTestSnapshot` JSON NULL,
    `failureCategories` JSON NOT NULL,
    `openedById` CHAR(36) NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedById` CHAR(36) NULL,
    `closedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `injector_repair_cases_activeKey_key`(`activeKey`),
    INDEX `injector_repair_cases_partNumber_normalizedSerial_idx`(`partNumber`, `normalizedSerial`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `injector_repair_attempts` (
    `id` CHAR(36) NOT NULL,
    `repairCaseId` CHAR(36) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `beforeSnapshot` JSON NOT NULL,
    `afterSnapshot` JSON NULL,
    `repairDate` DATETIME(3) NOT NULL,
    `technicianId` CHAR(36) NULL,
    `technician` VARCHAR(200) NOT NULL,
    `diagnosis` TEXT NOT NULL,
    `hypothesis` TEXT NULL,
    `expectedOutcome` TEXT NULL,
    `observedOutcome` TEXT NULL,
    `notes` TEXT NULL,
    `changes` JSON NOT NULL,
    `deltas` JSON NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'WAITING_RETEST',
    `outcome` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `injector_repair_attempts_repairCaseId_attemptNumber_key`(`repairCaseId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inspection_plan_revisions` ADD CONSTRAINT `inspection_plan_revisions_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `inspection_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `part_inspection_specifications` ADD CONSTRAINT `part_inspection_specifications_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `part_inspection_specifications` ADD CONSTRAINT `part_inspection_specifications_planRevisionId_fkey` FOREIGN KEY (`planRevisionId`) REFERENCES `inspection_plan_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_identities` ADD CONSTRAINT `feature_identities_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_revision_mappings` ADD CONSTRAINT `feature_revision_mappings_featureId_fkey` FOREIGN KEY (`featureId`) REFERENCES `feature_identities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feature_revision_mappings` ADD CONSTRAINT `feature_revision_mappings_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_planRevisionId_fkey` FOREIGN KEY (`planRevisionId`) REFERENCES `inspection_plan_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_inspections_productApprovalId_fkey` FOREIGN KEY (`productApprovalId`) REFERENCES `product_approvals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_items` ADD CONSTRAINT `incoming_items_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `incoming_inspections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_measurements` ADD CONSTRAINT `incoming_measurements_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `incoming_inspections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_measurements` ADD CONSTRAINT `incoming_measurements_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `incoming_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incoming_measurements` ADD CONSTRAINT `incoming_measurements_featureId_fkey` FOREIGN KEY (`featureId`) REFERENCES `feature_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `operational_alerts` ADD CONSTRAINT `operational_alerts_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `incoming_inspections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ncr_defect_lines` ADD CONSTRAINT `ncr_defect_lines_ncrId_fkey` FOREIGN KEY (`ncrId`) REFERENCES `nonconformances`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ncr_defect_lines` ADD CONSTRAINT `ncr_defect_lines_featureId_fkey` FOREIGN KEY (`featureId`) REFERENCES `feature_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ncr_defect_lines` ADD CONSTRAINT `ncr_defect_lines_measurementId_fkey` FOREIGN KEY (`measurementId`) REFERENCES `incoming_measurements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ncr_report_sections` ADD CONSTRAINT `ncr_report_sections_ncrId_fkey` FOREIGN KEY (`ncrId`) REFERENCES `nonconformances`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ncr_scar_links` ADD CONSTRAINT `ncr_scar_links_ncrId_fkey` FOREIGN KEY (`ncrId`) REFERENCES `nonconformances`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ncr_scar_links` ADD CONSTRAINT `ncr_scar_links_scarId_fkey` FOREIGN KEY (`scarId`) REFERENCES `corrective_actions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recurrence_reviews` ADD CONSTRAINT `recurrence_reviews_currentNcrId_fkey` FOREIGN KEY (`currentNcrId`) REFERENCES `nonconformances`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `recurrence_reviews` ADD CONSTRAINT `recurrence_reviews_historicalNcrId_fkey` FOREIGN KEY (`historicalNcrId`) REFERENCES `nonconformances`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `injector_repair_attempts` ADD CONSTRAINT `injector_repair_attempts_repairCaseId_fkey` FOREIGN KEY (`repairCaseId`) REFERENCES `injector_repair_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `critical_characteristics` ADD CONSTRAINT `critical_characteristics_featureId_fkey` FOREIGN KEY (`featureId`) REFERENCES `feature_identities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_incomingInspectionId_fkey` FOREIGN KEY (`incomingInspectionId`) REFERENCES `incoming_inspections`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_firstArticleId_fkey` FOREIGN KEY (`firstArticleId`) REFERENCES `first_article_inspections`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_testRecordId_fkey` FOREIGN KEY (`testRecordId`) REFERENCES `test_records`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE `nonconformances` MODIFY `ownerId` CHAR(36) NULL, MODIFY `createdById` CHAR(36) NULL, MODIFY `quantityAffected` INTEGER NULL;

-- Existing SQMS NCRs without relational origins predate this schema. Keep the exception explicit.
UPDATE `nonconformances` SET `legacyException` = JSON_OBJECT('reason', 'Pre-unification SQMS record has no source relationship', 'missingOrigin', true)
WHERE `source` IN ('INCOMING_INSPECTION', 'FIRST_ARTICLE', 'ENGINEERING_VALIDATION') AND `incomingInspectionId` IS NULL AND `firstArticleId` IS NULL AND `testRecordId` IS NULL;
ALTER TABLE `nonconformances` ADD CONSTRAINT `ncr_origin_relationship` CHECK (
  (`legacyException` IS NOT NULL OR
    (`source` <> 'INCOMING_INSPECTION' OR `incomingInspectionId` IS NOT NULL) AND
    (`source` <> 'FIRST_ARTICLE' OR `firstArticleId` IS NOT NULL) AND
    (`source` <> 'ENGINEERING_VALIDATION' OR `testRecordId` IS NOT NULL)) AND
  (`incomingInspectionId` IS NULL OR `source` = 'INCOMING_INSPECTION') AND
  (`firstArticleId` IS NULL OR `source` = 'FIRST_ARTICLE') AND
  (`testRecordId` IS NULL OR `source` = 'ENGINEERING_VALIDATION')
);
ALTER TABLE `feature_revision_mappings` ADD CONSTRAINT `feature_compatibility_values` CHECK (`compatibility` IN ('COMPATIBLE', 'INCOMPATIBLE', 'UNCERTAIN'));
ALTER TABLE `incoming_inspections` ADD CONSTRAINT `incoming_item_count_range` CHECK (`itemCount` BETWEEN 1 AND 500);
ALTER TABLE `ncr_defect_lines` ADD CONSTRAINT `defect_positive_quantity` CHECK (`quantityAffected` > 0);
ALTER TABLE `recurrence_reviews` ADD CONSTRAINT `recurrence_review_values` CHECK (`status` IN ('CANDIDATE', 'CONFIRMED', 'DISMISSED') AND `currentNcrId` <> `historicalNcrId`);
ALTER TABLE `injector_repair_cases` ADD CONSTRAINT `repair_case_status_values` CHECK (`status` IN ('OPEN', 'HOLD', 'ENGINEERING_REVIEW', 'PASSED', 'SCRAPPED'));
ALTER TABLE `injector_repair_attempts` ADD CONSTRAINT `repair_attempt_status_values` CHECK (`status` IN ('WAITING_RETEST', 'COMPLETED') AND `outcome` IN ('PENDING', 'PASS', 'FAIL', 'DNF', 'UNKNOWN'));
CREATE TRIGGER `released_inspection_plan_immutable` BEFORE UPDATE ON `inspection_plan_revisions`
FOR EACH ROW
BEGIN
  IF OLD.status <> 'DRAFT' AND (
    NOT (CAST(NEW.definition AS CHAR) <=> CAST(OLD.definition AS CHAR)) OR
    NOT (NEW.definitionHash <=> OLD.definitionHash) OR NEW.planId <> OLD.planId OR NEW.revision <> OLD.revision OR
    NOT (NEW.releasedAt <=> OLD.releasedAt) OR NOT (NEW.releasedById <=> OLD.releasedById) OR NEW.status = 'DRAFT'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released inspection definitions are immutable; create a revision';
  END IF;
END;
CREATE TRIGGER `released_inspection_plan_no_delete` BEFORE DELETE ON `inspection_plan_revisions`
FOR EACH ROW
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released inspection plan history cannot be deleted';
  END IF;
END;
