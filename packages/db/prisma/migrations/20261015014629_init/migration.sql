-- CreateTable
CREATE TABLE `retention_policies` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `trigger` ENUM('FROM_CREATION', 'FROM_RELEASE', 'FROM_SUPERSESSION', 'FROM_CLOSURE', 'UNDEFINED') NOT NULL DEFAULT 'UNDEFINED',
    `retentionMonths` INTEGER NULL,
    `dispositionAction` VARCHAR(120) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `retention_policies_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_types` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `acronym` VARCHAR(30) NULL,
    `category` ENUM('INTAKE', 'SUPPLIER_ONBOARDING', 'ENGINEERING', 'VALIDATION', 'OPERATIONS', 'GOVERNANCE') NOT NULL,
    `origin` ENUM('COMPANY_DEFINED', 'EXTERNAL_STANDARD', 'COMPANY_DEFINED_STANDARD_ALIGNED') NOT NULL DEFAULT 'COMPANY_DEFINED',
    `externalStandardRef` VARCHAR(300) NULL,
    `description` TEXT NOT NULL,
    `purpose` TEXT NULL,
    `responsibleDepartment` VARCHAR(120) NOT NULL,
    `typicalPreparer` VARCHAR(160) NOT NULL,
    `workflowKey` VARCHAR(80) NULL,
    `applicablePathways` JSON NOT NULL,
    `applicabilityConditions` TEXT NULL,
    `riskRuleSummary` TEXT NULL,
    `ownerRoleKey` VARCHAR(60) NULL,
    `ownerUserId` CHAR(36) NULL,
    `approvalRequirements` TEXT NULL,
    `approverRoleKeys` JSON NOT NULL,
    `retentionPolicyId` CHAR(36) NULL,
    `supplierVisibility` ENUM('INTERNAL_ONLY', 'SUPPLIER_VIEW_RELEASED', 'SUPPLIER_CONTRIBUTE') NOT NULL DEFAULT 'INTERNAL_ONLY',
    `status` ENUM('ACTIVE', 'OBSOLETE', 'SUPERSEDED') NOT NULL DEFAULT 'ACTIVE',
    `supersededByTypeId` CHAR(36) NULL,
    `instructions` TEXT NULL,
    `allowUpload` BOOLEAN NOT NULL DEFAULT true,
    `nativeFormKey` VARCHAR(60) NULL,
    `nativeModule` VARCHAR(60) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `document_types_code_key`(`code`),
    INDEX `document_types_category_sortOrder_idx`(`category`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_templates` (
    `id` CHAR(36) NOT NULL,
    `documentTypeId` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('ACTIVE', 'OBSOLETE', 'SUPERSEDED') NOT NULL DEFAULT 'ACTIVE',
    `ownerUserId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `document_templates_documentTypeId_idx`(`documentTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template_revisions` (
    `id` CHAR(36) NOT NULL,
    `templateId` CHAR(36) NOT NULL,
    `revisionNumber` INTEGER NOT NULL,
    `revisionLabel` VARCHAR(10) NOT NULL,
    `status` ENUM('DRAFT', 'EFFECTIVE', 'SUPERSEDED', 'OBSOLETE') NOT NULL DEFAULT 'DRAFT',
    `effectiveDate` DATE NULL,
    `fileObjectId` CHAR(36) NULL,
    `formDefinitionVersionId` CHAR(36) NULL,
    `changeSummary` TEXT NULL,
    `instructions` TEXT NULL,
    `approvedById` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `template_revisions_templateId_revisionNumber_key`(`templateId`, `revisionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `form_definitions` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `documentTypeId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `form_definitions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `form_definition_versions` (
    `id` CHAR(36) NOT NULL,
    `formDefinitionId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `schema` JSON NOT NULL,
    `changeSummary` TEXT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `form_definition_versions_formDefinitionId_version_key`(`formDefinitionId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_records` (
    `id` CHAR(36) NOT NULL,
    `docNumber` VARCHAR(40) NOT NULL,
    `documentTypeId` CHAR(36) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'RELEASED', 'SUPERSEDED', 'OBSOLETE', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `ownerOrganizationId` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NULL,
    `latestRevisionId` CHAR(36) NULL,
    `releasedRevisionId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `document_records_docNumber_key`(`docNumber`),
    UNIQUE INDEX `document_records_latestRevisionId_key`(`latestRevisionId`),
    UNIQUE INDEX `document_records_releasedRevisionId_key`(`releasedRevisionId`),
    INDEX `document_records_documentTypeId_status_idx`(`documentTypeId`, `status`),
    INDEX `document_records_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `document_records_ownerOrganizationId_idx`(`ownerOrganizationId`),
    INDEX `document_records_updatedAt_idx`(`updatedAt`),
    FULLTEXT INDEX `document_records_docNumber_title_idx`(`docNumber`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_revisions` (
    `id` CHAR(36) NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `revisionNumber` INTEGER NOT NULL,
    `revisionLabel` VARCHAR(10) NOT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'RELEASED', 'SUPERSEDED', 'OBSOLETE', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `submissionMethod` ENUM('NATIVE_FORM', 'UPLOAD') NOT NULL,
    `templateRevisionId` CHAR(36) NULL,
    `formDefinitionVersionId` CHAR(36) NULL,
    `formData` JSON NULL,
    `changeSummary` TEXT NULL,
    `contentHash` CHAR(64) NULL,
    `submittedById` CHAR(36) NULL,
    `submittedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releasedById` CHAR(36) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectionReason` TEXT NULL,
    `supersededAt` DATETIME(3) NULL,
    `supersededByRevisionId` CHAR(36) NULL,
    `obsoletedAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `document_revisions_supersededByRevisionId_key`(`supersededByRevisionId`),
    INDEX `document_revisions_status_idx`(`status`),
    UNIQUE INDEX `document_revisions_documentId_revisionNumber_key`(`documentId`, `revisionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_revision_files` (
    `id` CHAR(36) NOT NULL,
    `revisionId` CHAR(36) NOT NULL,
    `fileObjectId` CHAR(36) NOT NULL,
    `role` ENUM('PRIMARY', 'SUPPORTING') NOT NULL DEFAULT 'SUPPORTING',
    `description` VARCHAR(500) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `addedById` CHAR(36) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_revision_files_fileObjectId_idx`(`fileObjectId`),
    UNIQUE INDEX `document_revision_files_revisionId_fileObjectId_key`(`revisionId`, `fileObjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `file_objects` (
    `id` CHAR(36) NOT NULL,
    `bucket` VARCHAR(80) NOT NULL,
    `storageKey` VARCHAR(300) NOT NULL,
    `originalFilename` VARCHAR(255) NOT NULL,
    `safeFilename` VARCHAR(255) NOT NULL,
    `extension` VARCHAR(20) NOT NULL,
    `declaredContentType` VARCHAR(160) NULL,
    `contentType` VARCHAR(160) NOT NULL,
    `category` ENUM('DOCUMENT', 'SPREADSHEET', 'DATA', 'IMAGE', 'CAD', 'ARCHIVE', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `sizeBytes` BIGINT NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `status` ENUM('UPLOADING', 'QUARANTINED', 'CLEAN', 'INFECTED', 'SCAN_FAILED', 'REJECTED', 'DELETED') NOT NULL DEFAULT 'UPLOADING',
    `scanEngine` VARCHAR(80) NULL,
    `scanSignature` VARCHAR(255) NULL,
    `scanAttempts` INTEGER NOT NULL DEFAULT 0,
    `scannedAt` DATETIME(3) NULL,
    `description` VARCHAR(500) NULL,
    `uploadedById` CHAR(36) NOT NULL,
    `ownerOrganizationId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `file_objects_storageKey_key`(`storageKey`),
    INDEX `file_objects_status_idx`(`status`),
    INDEX `file_objects_sha256_idx`(`sha256`),
    INDEX `file_objects_uploadedById_idx`(`uploadedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `allowed_file_types` (
    `id` CHAR(36) NOT NULL,
    `extension` VARCHAR(20) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `category` ENUM('DOCUMENT', 'SPREADSHEET', 'DATA', 'IMAGE', 'CAD', 'ARCHIVE', 'OTHER') NOT NULL,
    `mimeTypes` JSON NOT NULL,
    `maxSizeMb` INTEGER NULL,
    `previewable` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `allowed_file_types_extension_key`(`extension`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_links` (
    `id` CHAR(36) NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `revisionId` CHAR(36) NULL,
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `linkRole` VARCHAR(40) NOT NULL DEFAULT 'REFERENCE',
    `note` VARCHAR(500) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_links_entityType_entityId_idx`(`entityType`, `entityId`),
    UNIQUE INDEX `document_links_documentId_entityType_entityId_linkRole_key`(`documentId`, `entityType`, `entityId`, `linkRole`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_shares` (
    `id` CHAR(36) NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `grantedById` CHAR(36) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,

    INDEX `document_shares_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `document_shares_documentId_organizationId_key`(`documentId`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_acknowledgments` (
    `id` CHAR(36) NOT NULL,
    `revisionId` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `acknowledgedByName` VARCHAR(160) NOT NULL,
    `acknowledgedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `comment` TEXT NULL,

    INDEX `document_acknowledgments_revisionId_idx`(`revisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_releases` (
    `id` CHAR(36) NOT NULL,
    `releaseNumber` VARCHAR(40) NOT NULL,
    `revisionId` CHAR(36) NOT NULL,
    `releasedById` CHAR(36) NOT NULL,
    `releasedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveDate` DATE NOT NULL,
    `releaseNotes` TEXT NULL,

    UNIQUE INDEX `document_releases_releaseNumber_key`(`releaseNumber`),
    UNIQUE INDEX `document_releases_revisionId_key`(`revisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_supersessions` (
    `id` CHAR(36) NOT NULL,
    `supersededDocumentId` CHAR(36) NOT NULL,
    `supersedingDocumentId` CHAR(36) NOT NULL,
    `reason` TEXT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `document_supersessions_supersededDocumentId_supersedingDocum_key`(`supersededDocumentId`, `supersedingDocumentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `record_attachments` (
    `id` CHAR(36) NOT NULL,
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `fileObjectId` CHAR(36) NOT NULL,
    `description` VARCHAR(500) NULL,
    `visibility` ENUM('INTERNAL', 'SUPPLIER') NOT NULL DEFAULT 'INTERNAL',
    `addedById` CHAR(36) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `removedAt` DATETIME(3) NULL,
    `removedById` CHAR(36) NULL,

    INDEX `record_attachments_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `record_attachments_fileObjectId_idx`(`fileObjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organizations` (
    `id` CHAR(36) NOT NULL,
    `type` ENUM('INTERNAL', 'SUPPLIER') NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    UNIQUE INDEX `organizations_code_key`(`code`),
    INDEX `organizations_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `displayName` VARCHAR(160) NOT NULL,
    `userType` ENUM('INTERNAL', 'EXTERNAL') NOT NULL,
    `status` ENUM('INVITED', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `passwordHash` VARCHAR(255) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
    `jobTitle` VARCHAR(120) NULL,
    `department` VARCHAR(120) NULL,
    `phone` VARCHAR(40) NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `mfaRequired` BOOLEAN NOT NULL DEFAULT false,
    `disabledAt` DATETIME(3) NULL,
    `disabledReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_identities` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `provider` VARCHAR(60) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    INDEX `user_identities_userId_idx`(`userId`),
    UNIQUE INDEX `user_identities_provider_subject_key`(`provider`, `subject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_mfa_factors` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `type` ENUM('TOTP', 'WEBAUTHN') NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `encryptedSecret` TEXT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_mfa_factors_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization_memberships` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `organization_memberships_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `organization_memberships_userId_organizationId_key`(`userId`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `scope` ENUM('INTERNAL', 'EXTERNAL') NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `externalAllowed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` CHAR(36) NOT NULL,
    `permissionId` CHAR(36) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_roles` (
    `membershipId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `grantedById` CHAR(36) NULL,

    INDEX `membership_roles_roleId_idx`(`roleId`),
    PRIMARY KEY (`membershipId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitations` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `displayName` VARCHAR(160) NULL,
    `organizationId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `expiresAt` DATETIME(3) NOT NULL,
    `invitedById` CHAR(36) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `acceptedUserId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invitations_tokenHash_key`(`tokenHash`),
    INDEX `invitations_email_idx`(`email`),
    INDEX `invitations_organizationId_status_idx`(`organizationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitation_roles` (
    `invitationId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,

    INDEX `invitation_roles_roleId_idx`(`roleId`),
    PRIMARY KEY (`invitationId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idleExpiresAt` DATETIME(3) NOT NULL,
    `absoluteExpiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(120) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(400) NULL,
    `mfaVerifiedAt` DATETIME(3) NULL,

    UNIQUE INDEX `auth_sessions_tokenHash_key`(`tokenHash`),
    INDEX `auth_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestIp` VARCHAR(64) NULL,

    UNIQUE INDEX `password_reset_tokens_tokenHash_key`(`tokenHash`),
    INDEX `password_reset_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `eventType` VARCHAR(80) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `body` TEXT NULL,
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NULL,
    `entityId` CHAR(36) NULL,
    `link` VARCHAR(500) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_deliveries` (
    `id` CHAR(36) NOT NULL,
    `notificationId` CHAR(36) NOT NULL,
    `channel` ENUM('IN_APP', 'EMAIL') NOT NULL,
    `status` ENUM('PENDING', 'QUEUED', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `recipient` VARCHAR(254) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `providerMessageId` VARCHAR(255) NULL,
    `queuedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `notification_deliveries_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `eventType` VARCHAR(80) NOT NULL,
    `channel` ENUM('IN_APP', 'EMAIL') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_preferences_userId_eventType_channel_key`(`userId`, `eventType`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_events` (
    `id` CHAR(36) NOT NULL,
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `entityLabel` VARCHAR(200) NULL,
    `actorId` CHAR(36) NULL,
    `actorName` VARCHAR(160) NULL,
    `verb` VARCHAR(60) NOT NULL,
    `summary` VARCHAR(1000) NOT NULL,
    `data` JSON NULL,
    `visibility` ENUM('INTERNAL', 'SUPPLIER') NOT NULL DEFAULT 'INTERNAL',
    `supplierId` CHAR(36) NULL,
    `internalPartId` CHAR(36) NULL,
    `projectId` CHAR(36) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_events_entityType_entityId_occurredAt_idx`(`entityType`, `entityId`, `occurredAt`),
    INDEX `activity_events_supplierId_occurredAt_idx`(`supplierId`, `occurredAt`),
    INDEX `activity_events_internalPartId_occurredAt_idx`(`internalPartId`, `occurredAt`),
    INDEX `activity_events_projectId_occurredAt_idx`(`projectId`, `occurredAt`),
    INDEX `activity_events_occurredAt_idx`(`occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` CHAR(36) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorType` ENUM('USER', 'SYSTEM') NOT NULL,
    `actorUserId` CHAR(36) NULL,
    `actorEmail` VARCHAR(254) NULL,
    `actorOrganizationId` CHAR(36) NULL,
    `eventType` VARCHAR(100) NOT NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE', 'DENIED') NOT NULL DEFAULT 'SUCCESS',
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NULL,
    `entityId` CHAR(36) NULL,
    `entityLabel` VARCHAR(200) NULL,
    `changes` JSON NULL,
    `metadata` JSON NULL,
    `reason` TEXT NULL,
    `correlationId` VARCHAR(64) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(400) NULL,

    INDEX `audit_events_entityType_entityId_occurredAt_idx`(`entityType`, `entityId`, `occurredAt`),
    INDEX `audit_events_actorUserId_occurredAt_idx`(`actorUserId`, `occurredAt`),
    INDEX `audit_events_eventType_occurredAt_idx`(`eventType`, `occurredAt`),
    INDEX `audit_events_occurredAt_idx`(`occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_views` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `module` VARCHAR(60) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `filters` JSON NOT NULL,
    `sort` VARCHAR(120) NULL,
    `isShared` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `saved_views_userId_module_name_key`(`userId`, `module`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(500) NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `system_settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `numbering_sequences` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `prefix` VARCHAR(20) NOT NULL,
    `pattern` VARCHAR(80) NOT NULL DEFAULT '{prefix}-{yyyy}-{seq}',
    `padding` INTEGER NOT NULL DEFAULT 4,
    `nextValue` INTEGER NOT NULL DEFAULT 1,
    `resetPolicy` ENUM('NEVER', 'YEARLY') NOT NULL DEFAULT 'YEARLY',
    `currentPeriod` VARCHAR(10) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `numbering_sequences_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` CHAR(36) NOT NULL,
    `eventType` VARCHAR(100) NOT NULL,
    `aggregateType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL,
    `aggregateId` CHAR(36) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'DISPATCHED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dispatchedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `outbox_events_status_availableAt_idx`(`status`, `availableAt`),
    INDEX `outbox_events_aggregateType_aggregateId_idx`(`aggregateType`, `aggregateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_references` (
    `id` CHAR(36) NOT NULL,
    `system` VARCHAR(60) NOT NULL,
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `externalId` VARCHAR(200) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `external_references_entityType_entityId_idx`(`entityType`, `entityId`),
    UNIQUE INDEX `external_references_system_entityType_externalId_key`(`system`, `entityType`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_categories` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `parentId` CHAR(36) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_categories_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `internal_parts` (
    `id` CHAR(36) NOT NULL,
    `partNumber` VARCHAR(60) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `categoryId` CHAR(36) NULL,
    `application` TEXT NULL,
    `unitOfMeasure` VARCHAR(12) NOT NULL DEFAULT 'EA',
    `criticality` ENUM('LOW', 'MEDIUM', 'HIGH', 'SAFETY_CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('DEVELOPMENT', 'ACTIVE', 'ON_HOLD', 'OBSOLETE') NOT NULL DEFAULT 'DEVELOPMENT',
    `designOwnership` ENUM('COMPANY', 'SUPPLIER', 'SHARED') NOT NULL DEFAULT 'SUPPLIER',
    `engineeringRevision` VARCHAR(20) NULL,
    `notes` TEXT NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `internal_parts_partNumber_key`(`partNumber`),
    INDEX `internal_parts_status_idx`(`status`),
    INDEX `internal_parts_categoryId_idx`(`categoryId`),
    FULLTEXT INDEX `internal_parts_partNumber_description_idx`(`partNumber`, `description`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oem_cross_references` (
    `id` CHAR(36) NOT NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `oemName` VARCHAR(120) NOT NULL,
    `oemPartNumber` VARCHAR(80) NOT NULL,
    `notes` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `oem_cross_references_oemPartNumber_idx`(`oemPartNumber`),
    UNIQUE INDEX `oem_cross_references_internalPartId_oemName_oemPartNumber_key`(`internalPartId`, `oemName`, `oemPartNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_parts` (
    `id` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierPartNumber` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `supplierRevision` VARCHAR(20) NULL,
    `designOwnership` ENUM('COMPANY', 'SUPPLIER', 'SHARED') NOT NULL DEFAULT 'SUPPLIER',
    `isCustom` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'INACTIVE', 'OBSOLETE') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    INDEX `supplier_parts_supplierPartNumber_idx`(`supplierPartNumber`),
    UNIQUE INDEX `supplier_parts_supplierId_supplierPartNumber_key`(`supplierId`, `supplierPartNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `part_cross_references` (
    `id` CHAR(36) NOT NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `supplierPartId` CHAR(36) NOT NULL,
    `type` ENUM('EQUIVALENT', 'CUSTOM_CONFIGURATION', 'ALTERNATE') NOT NULL DEFAULT 'EQUIVALENT',
    `notes` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` CHAR(36) NULL,

    INDEX `part_cross_references_supplierPartId_idx`(`supplierPartId`),
    UNIQUE INDEX `part_cross_references_internalPartId_supplierPartId_key`(`internalPartId`, `supplierPartId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_products` (
    `id` CHAR(36) NOT NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierPartId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NOT NULL,
    `status` ENUM('PROPOSED', 'IN_QUALIFICATION', 'APPROVED', 'CONDITIONALLY_APPROVED', 'SUSPENDED', 'DISQUALIFIED', 'INACTIVE') NOT NULL DEFAULT 'PROPOSED',
    `statusReason` VARCHAR(1000) NULL,
    `isPreferred` BOOLEAN NOT NULL DEFAULT false,
    `originProjectId` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `supplier_products_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `supplier_products_siteId_idx`(`siteId`),
    UNIQUE INDEX `supplier_products_internalPartId_supplierPartId_siteId_key`(`internalPartId`, `supplierPartId`, `siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_configurations` (
    `id` CHAR(36) NOT NULL,
    `configCode` VARCHAR(40) NOT NULL,
    `supplierProductId` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `configurationType` ENUM('CUSTOMER_DESIGN', 'SUPPLIER_STANDARD', 'SUPPLIER_MODIFIED') NOT NULL,
    `baseConfigurationId` CHAR(36) NULL,
    `customPartNumber` VARCHAR(80) NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `currentApprovedRevisionId` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_configurations_configCode_key`(`configCode`),
    UNIQUE INDEX `product_configurations_currentApprovedRevisionId_key`(`currentApprovedRevisionId`),
    INDEX `product_configurations_supplierProductId_idx`(`supplierProductId`),
    INDEX `product_configurations_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuration_revisions` (
    `id` CHAR(36) NOT NULL,
    `configurationId` CHAR(36) NOT NULL,
    `revisionNumber` INTEGER NOT NULL,
    `revisionLabel` VARCHAR(10) NOT NULL,
    `status` ENUM('DRAFT', 'PROPOSED', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
    `description` TEXT NULL,
    `changeSummary` TEXT NULL,
    `supplierProductRevision` VARCHAR(40) NULL,
    `derivedFromRevisionId` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` CHAR(36) NULL,
    `supersededAt` DATETIME(3) NULL,
    `supersededByRevisionId` CHAR(36) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `configuration_revisions_supersededByRevisionId_key`(`supersededByRevisionId`),
    INDEX `configuration_revisions_status_idx`(`status`),
    UNIQUE INDEX `configuration_revisions_configurationId_revisionNumber_key`(`configurationId`, `revisionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `engineering_baselines` (
    `id` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `baselineType` ENUM('CUSTOMER_CONTROLLED_DESIGN', 'SUPPLIER_PRODUCT_BASELINE', 'SUPPLIER_BASELINE_WITH_DELTA', 'PRELIMINARY_REVERSE_ENGINEERED') NOT NULL,
    `designOwnership` ENUM('COMPANY', 'SUPPLIER', 'SHARED') NOT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'ACCEPTED') NOT NULL DEFAULT 'DRAFT',
    `drawingNumber` VARCHAR(80) NULL,
    `drawingRevision` VARCHAR(20) NULL,
    `specificationNumber` VARCHAR(80) NULL,
    `specificationRevision` VARCHAR(20) NULL,
    `material` VARCHAR(300) NULL,
    `materialSpecification` VARCHAR(300) NULL,
    `coating` VARCHAR(300) NULL,
    `coatingSpecification` VARCHAR(300) NULL,
    `heatTreatment` VARCHAR(300) NULL,
    `surfaceFinish` VARCHAR(300) NULL,
    `generalTolerances` VARCHAR(500) NULL,
    `keyDimensions` TEXT NULL,
    `performanceRequirements` TEXT NULL,
    `operatingRequirements` TEXT NULL,
    `guaranteedCharacteristics` TEXT NULL,
    `reverseEngineeringSource` TEXT NULL,
    `notes` TEXT NULL,
    `additionalData` JSON NULL,
    `acceptedById` CHAR(36) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `engineering_baselines_configurationRevisionId_key`(`configurationRevisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_requirements` (
    `id` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `category` ENUM('DIMENSIONAL', 'MATERIAL', 'COATING', 'HEAT_TREATMENT', 'PERFORMANCE', 'PROCESS', 'INSPECTION', 'PACKAGING', 'LABELING', 'OTHER') NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `baselineValue` TEXT NULL,
    `requiredValue` TEXT NOT NULL,
    `acceptanceCriteria` TEXT NOT NULL,
    `rationale` TEXT NULL,
    `isModification` BOOLEAN NOT NULL DEFAULT true,
    `ackStatus` ENUM('PENDING', 'ACKNOWLEDGED', 'DECLINED') NOT NULL DEFAULT 'PENDING',
    `ackAt` DATETIME(3) NULL,
    `ackByName` VARCHAR(160) NULL,
    `ackByUserId` CHAR(36) NULL,
    `ackNote` TEXT NULL,
    `verificationStatus` ENUM('PENDING', 'VERIFIED', 'FAILED', 'WAIVED') NOT NULL DEFAULT 'PENDING',
    `verificationNote` TEXT NULL,
    `verifiedById` CHAR(36) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_requirements_configurationRevisionId_code_key`(`configurationRevisionId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `critical_characteristics` (
    `id` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `charNumber` VARCHAR(20) NOT NULL,
    `name` VARCHAR(250) NOT NULL,
    `classification` ENUM('CRITICAL', 'SIGNIFICANT', 'MAJOR', 'MINOR') NOT NULL,
    `source` ENUM('BASELINE', 'DELTA') NOT NULL DEFAULT 'BASELINE',
    `customerRequirementId` CHAR(36) NULL,
    `nominal` DECIMAL(18, 6) NULL,
    `tolerancePlus` DECIMAL(18, 6) NULL,
    `toleranceMinus` DECIMAL(18, 6) NULL,
    `unit` VARCHAR(20) NULL,
    `specification` VARCHAR(500) NULL,
    `measurementMethod` VARCHAR(300) NULL,
    `inspectionFrequency` VARCHAR(200) NULL,
    `acceptanceCriteria` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `critical_characteristics_configurationRevisionId_charNumber_key`(`configurationRevisionId`, `charNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_approvals` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `supplierProductId` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `qualificationId` CHAR(36) NOT NULL,
    `approvalPackageId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'SUPERSEDED', 'SUSPENDED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `restrictions` TEXT NULL,
    `approvedById` CHAR(36) NOT NULL,
    `approvedAt` DATETIME(3) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `supersededAt` DATETIME(3) NULL,
    `supersededByChangeRequestId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_approvals_number_key`(`number`),
    UNIQUE INDEX `product_approvals_configurationRevisionId_key`(`configurationRevisionId`),
    UNIQUE INDEX `product_approvals_qualificationId_key`(`qualificationId`),
    UNIQUE INDEX `product_approvals_approvalPackageId_key`(`approvalPackageId`),
    INDEX `product_approvals_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `product_approvals_internalPartId_status_idx`(`internalPartId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_qualifications` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `sourcingProjectId` CHAR(36) NULL,
    `changeRequestId` CHAR(36) NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierProductId` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `pathway` ENUM('A', 'B', 'C') NULL,
    `riskLevel` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `status` ENUM('DRAFT', 'DOCUMENTATION_PENDING', 'EVALUATION', 'VALIDATION', 'APPROVAL_REVIEW', 'APPROVED', 'REJECTED', 'ON_HOLD') NOT NULL DEFAULT 'DRAFT',
    `workflowKey` VARCHAR(80) NOT NULL,
    `requiredSampleQty` INTEGER NULL,
    `sampleNotes` TEXT NULL,
    `inspectionPlanNotes` TEXT NULL,
    `approvalRestrictions` TEXT NULL,
    `deviationsSummary` TEXT NULL,
    `decisionComment` TEXT NULL,
    `decidedById` CHAR(36) NULL,
    `decidedAt` DATETIME(3) NULL,
    `holdReason` TEXT NULL,
    `workflowInstanceId` CHAR(36) NULL,
    `supplierVisible` BOOLEAN NOT NULL DEFAULT false,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `product_qualifications_number_key`(`number`),
    UNIQUE INDEX `product_qualifications_changeRequestId_key`(`changeRequestId`),
    UNIQUE INDEX `product_qualifications_workflowInstanceId_key`(`workflowInstanceId`),
    INDEX `product_qualifications_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `product_qualifications_configurationRevisionId_idx`(`configurationRevisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspection_requirements` (
    `id` CHAR(36) NOT NULL,
    `qualificationId` CHAR(36) NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `characteristicId` CHAR(36) NULL,
    `type` ENUM('FIRST_ARTICLE', 'INCOMING', 'IN_PROCESS', 'FINAL') NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `method` VARCHAR(300) NULL,
    `sampleSize` VARCHAR(80) NULL,
    `acceptanceCriteria` TEXT NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inspection_requirements_qualificationId_idx`(`qualificationId`),
    INDEX `inspection_requirements_configurationRevisionId_idx`(`configurationRevisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inspection_results` (
    `id` CHAR(36) NOT NULL,
    `qualificationId` CHAR(36) NULL,
    `inspectionRequirementId` CHAR(36) NULL,
    `characteristicId` CHAR(36) NULL,
    `firstArticleId` CHAR(36) NULL,
    `sampleIdentifier` VARCHAR(80) NULL,
    `measuredValue` VARCHAR(200) NULL,
    `numericValue` DECIMAL(18, 6) NULL,
    `outcome` ENUM('PASS', 'FAIL', 'CONDITIONAL', 'NOT_INSPECTED') NOT NULL,
    `notes` TEXT NULL,
    `inspectedById` CHAR(36) NOT NULL,
    `inspectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inspection_results_qualificationId_idx`(`qualificationId`),
    INDEX `inspection_results_firstArticleId_idx`(`firstArticleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `test_records` (
    `id` CHAR(36) NOT NULL,
    `qualificationId` CHAR(36) NOT NULL,
    `testType` ENUM('FUNCTIONAL', 'PERFORMANCE', 'DURABILITY', 'LEAK', 'FLOW', 'MATERIAL', 'COATING', 'DIMENSIONAL', 'ENVIRONMENTAL', 'OTHER') NOT NULL,
    `name` VARCHAR(250) NOT NULL,
    `procedure` VARCHAR(500) NULL,
    `acceptanceCriteria` TEXT NOT NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('PLANNED', 'SUBMITTED', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PLANNED',
    `outcome` ENUM('PASS', 'FAIL', 'CONDITIONAL', 'NOT_INSPECTED') NULL,
    `resultSummary` TEXT NULL,
    `laboratory` VARCHAR(200) NULL,
    `testedAt` DATETIME(3) NULL,
    `documentId` CHAR(36) NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewComment` TEXT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `test_records_qualificationId_status_idx`(`qualificationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `first_article_inspections` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `qualificationId` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `serialNumbers` TEXT NULL,
    `inspectionDate` DATE NULL,
    `characteristicsInspected` INTEGER NOT NULL DEFAULT 0,
    `nonconformingCount` INTEGER NOT NULL DEFAULT 0,
    `outcome` ENUM('PASS', 'FAIL', 'CONDITIONAL', 'NOT_INSPECTED') NULL,
    `status` ENUM('PLANNED', 'SUBMITTED', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PLANNED',
    `documentId` CHAR(36) NULL,
    `summary` TEXT NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewComment` TEXT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `first_article_inspections_number_key`(`number`),
    INDEX `first_article_inspections_qualificationId_status_idx`(`qualificationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_packages` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `qualificationId` CHAR(36) NOT NULL,
    `configurationRevisionId` CHAR(36) NOT NULL,
    `snapshot` JSON NOT NULL,
    `snapshotHash` CHAR(64) NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `approval_packages_number_key`(`number`),
    UNIQUE INDEX `approval_packages_qualificationId_key`(`qualificationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_package_items` (
    `id` CHAR(36) NOT NULL,
    `packageId` CHAR(36) NOT NULL,
    `documentRevisionId` CHAR(36) NOT NULL,
    `documentTypeCode` VARCHAR(20) NOT NULL,
    `contentHash` CHAR(64) NULL,

    INDEX `approval_package_items_documentRevisionId_idx`(`documentRevisionId`),
    UNIQUE INDEX `approval_package_items_packageId_documentRevisionId_key`(`packageId`, `documentRevisionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_requests` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierProductId` CHAR(36) NOT NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `supplierPartId` CHAR(36) NOT NULL,
    `currentSiteId` CHAR(36) NOT NULL,
    `proposedSiteId` CHAR(36) NULL,
    `currentRevisionId` CHAR(36) NOT NULL,
    `proposedRevisionId` CHAR(36) NULL,
    `reason` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `affectedCharacteristics` TEXT NULL,
    `proposedImplementationDate` DATE NULL,
    `inventoryImpact` TEXT NULL,
    `wipImpact` TEXT NULL,
    `riskLevel` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
    `riskAssessment` TEXT NULL,
    `requiredValidation` TEXT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUIRED', 'VALIDATION_REQUIRED', 'APPROVED', 'REJECTED', 'IMPLEMENTATION_VERIFIED', 'CLOSED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
    `submittedByOrganizationId` CHAR(36) NOT NULL,
    `submittedById` CHAR(36) NULL,
    `submittedAt` DATETIME(3) NULL,
    `infoRequest` TEXT NULL,
    `disposition` ENUM('APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED') NULL,
    `dispositionConditions` TEXT NULL,
    `decisionComment` TEXT NULL,
    `decidedById` CHAR(36) NULL,
    `decidedAt` DATETIME(3) NULL,
    `implementationNotes` TEXT NULL,
    `implementationVerifiedById` CHAR(36) NULL,
    `implementationVerifiedAt` DATETIME(3) NULL,
    `shipmentAuthorizedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `withdrawnAt` DATETIME(3) NULL,
    `supplierVisible` BOOLEAN NOT NULL DEFAULT true,
    `workflowInstanceId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `change_requests_number_key`(`number`),
    UNIQUE INDEX `change_requests_proposedRevisionId_key`(`proposedRevisionId`),
    UNIQUE INDEX `change_requests_workflowInstanceId_key`(`workflowInstanceId`),
    INDEX `change_requests_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `change_requests_internalPartId_idx`(`internalPartId`),
    INDEX `change_requests_status_createdAt_idx`(`status`, `createdAt`),
    FULLTEXT INDEX `change_requests_number_title_idx`(`number`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_request_categories` (
    `changeRequestId` CHAR(36) NOT NULL,
    `category` ENUM('DESIGN', 'DIMENSIONAL', 'MATERIAL', 'COATING', 'HEAT_TREATMENT', 'PROCESS', 'EQUIPMENT_TOOLING', 'LOCATION', 'SUB_TIER', 'INSPECTION_METHOD', 'OTHER') NOT NULL,

    INDEX `change_request_categories_category_idx`(`category`),
    PRIMARY KEY (`changeRequestId`, `category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_impact_assessments` (
    `id` CHAR(36) NOT NULL,
    `changeRequestId` CHAR(36) NOT NULL,
    `discipline` ENUM('ENGINEERING', 'QUALITY', 'PURCHASING', 'MANUFACTURING', 'MANAGEMENT') NOT NULL,
    `assessorId` CHAR(36) NOT NULL,
    `impactSummary` TEXT NOT NULL,
    `affectsFormFitFunction` BOOLEAN NOT NULL DEFAULT false,
    `affectsInterchangeability` BOOLEAN NOT NULL DEFAULT false,
    `requiresFai` BOOLEAN NOT NULL DEFAULT false,
    `requiresPartialRequalification` BOOLEAN NOT NULL DEFAULT false,
    `requiresFunctionalTest` BOOLEAN NOT NULL DEFAULT false,
    `requiresMaterialCertificates` BOOLEAN NOT NULL DEFAULT false,
    `requiresControlPlanUpdate` BOOLEAN NOT NULL DEFAULT false,
    `requiresSpecificationRevision` BOOLEAN NOT NULL DEFAULT false,
    `requiresNewProductApproval` BOOLEAN NOT NULL DEFAULT false,
    `recommendation` ENUM('APPROVE', 'APPROVE_WITH_CONDITIONS', 'REJECT', 'NEED_INFORMATION') NOT NULL,
    `comments` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `change_impact_assessments_changeRequestId_discipline_key`(`changeRequestId`, `discipline`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deviations` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `type` ENUM('DEVIATION', 'CONCESSION') NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `supplierProductId` CHAR(36) NULL,
    `configurationRevisionId` CHAR(36) NULL,
    `qualificationId` CHAR(36) NULL,
    `ncrId` CHAR(36) NULL,
    `description` TEXT NOT NULL,
    `justification` TEXT NOT NULL,
    `riskAssessment` TEXT NULL,
    `quantityLimit` INTEGER NULL,
    `lotNumbers` TEXT NULL,
    `startDate` DATE NULL,
    `endDate` DATE NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CLOSED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
    `blocksApproval` BOOLEAN NOT NULL DEFAULT true,
    `decisionComment` TEXT NULL,
    `decidedById` CHAR(36) NULL,
    `decidedAt` DATETIME(3) NULL,
    `supplierVisible` BOOLEAN NOT NULL DEFAULT true,
    `workflowInstanceId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `deviations_number_key`(`number`),
    UNIQUE INDEX `deviations_workflowInstanceId_key`(`workflowInstanceId`),
    INDEX `deviations_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `deviations_qualificationId_idx`(`qualificationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nonconformances` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `dateIdentified` DATE NOT NULL,
    `source` ENUM('INCOMING_INSPECTION', 'IN_PROCESS', 'FINAL_INSPECTION', 'CUSTOMER_RETURN', 'FIELD_FAILURE', 'QUALIFICATION', 'AUDIT', 'OTHER') NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `supplierPartId` CHAR(36) NULL,
    `supplierProductId` CHAR(36) NULL,
    `configurationRevisionId` CHAR(36) NULL,
    `characteristicId` CHAR(36) NULL,
    `qualificationId` CHAR(36) NULL,
    `lotNumber` VARCHAR(80) NULL,
    `serialNumbers` TEXT NULL,
    `quantityAffected` INTEGER NOT NULL,
    `quantityInspected` INTEGER NULL,
    `defectDescription` TEXT NOT NULL,
    `expectedSpecification` TEXT NULL,
    `actualCondition` TEXT NULL,
    `inspectionResults` TEXT NULL,
    `severity` ENUM('MINOR', 'MAJOR', 'CRITICAL') NOT NULL,
    `containmentAction` TEXT NULL,
    `containmentCompletedAt` DATETIME(3) NULL,
    `disposition` ENUM('USE_AS_IS_CONCESSION', 'REWORK', 'REPAIR', 'RETURN_TO_SUPPLIER', 'SCRAP', 'HOLD') NULL,
    `dispositionNotes` TEXT NULL,
    `dispositionById` CHAR(36) NULL,
    `dispositionAt` DATETIME(3) NULL,
    `status` ENUM('OPEN', 'CONTAINED', 'UNDER_INVESTIGATION', 'DISPOSITIONED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `blocksApproval` BOOLEAN NOT NULL DEFAULT true,
    `ownerId` CHAR(36) NOT NULL,
    `internalNotes` TEXT NULL,
    `supplierVisible` BOOLEAN NOT NULL DEFAULT false,
    `closedById` CHAR(36) NULL,
    `closedAt` DATETIME(3) NULL,
    `closureComment` TEXT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `nonconformances_number_key`(`number`),
    INDEX `nonconformances_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `nonconformances_internalPartId_idx`(`internalPartId`),
    INDEX `nonconformances_status_dateIdentified_idx`(`status`, `dateIdentified`),
    FULLTEXT INDEX `nonconformances_number_title_idx`(`number`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corrective_actions` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `ncrId` CHAR(36) NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NULL,
    `problemDescription` TEXT NOT NULL,
    `requirements` TEXT NULL,
    `severity` ENUM('MINOR', 'MAJOR', 'CRITICAL') NOT NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'RESPONSE_SUBMITTED', 'RESPONSE_REJECTED', 'ACCEPTED', 'VERIFICATION', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `issuedById` CHAR(36) NULL,
    `issuedAt` DATETIME(3) NULL,
    `containmentDueDate` DATE NULL,
    `responseDueDate` DATE NOT NULL,
    `escalationLevel` INTEGER NOT NULL DEFAULT 0,
    `lastEscalatedAt` DATETIME(3) NULL,
    `internalNotes` TEXT NULL,
    `effectivenessDueDate` DATE NULL,
    `effectivenessResult` ENUM('EFFECTIVE', 'NOT_EFFECTIVE') NULL,
    `effectivenessNotes` TEXT NULL,
    `effectivenessVerifiedById` CHAR(36) NULL,
    `effectivenessVerifiedAt` DATETIME(3) NULL,
    `closedById` CHAR(36) NULL,
    `closedAt` DATETIME(3) NULL,
    `closureComment` TEXT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `corrective_actions_number_key`(`number`),
    INDEX `corrective_actions_supplierId_status_idx`(`supplierId`, `status`),
    INDEX `corrective_actions_status_responseDueDate_idx`(`status`, `responseDueDate`),
    FULLTEXT INDEX `corrective_actions_number_title_idx`(`number`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corrective_action_responses` (
    `id` CHAR(36) NOT NULL,
    `scarId` CHAR(36) NOT NULL,
    `revisionNumber` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `submittedByOrganizationId` CHAR(36) NOT NULL,
    `submittedById` CHAR(36) NULL,
    `submittedByName` VARCHAR(160) NULL,
    `submittedAt` DATETIME(3) NULL,
    `d1Team` TEXT NULL,
    `d2Problem` TEXT NULL,
    `d3Containment` TEXT NULL,
    `d4RootCause` TEXT NULL,
    `d4EscapePoint` TEXT NULL,
    `d5CorrectiveActions` TEXT NULL,
    `d6Implementation` TEXT NULL,
    `d6ImplementationDate` DATE NULL,
    `d7Prevention` TEXT NULL,
    `d8Closure` TEXT NULL,
    `reviewComment` TEXT NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `corrective_action_responses_scarId_revisionNumber_key`(`scarId`, `revisionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sourcing_pathways` (
    `id` CHAR(36) NOT NULL,
    `code` ENUM('A', 'B', 'C') NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NOT NULL,
    `designOwnership` ENUM('COMPANY', 'SUPPLIER', 'SHARED') NOT NULL,
    `defaultBaselineType` ENUM('CUSTOMER_CONTROLLED_DESIGN', 'SUPPLIER_PRODUCT_BASELINE', 'SUPPLIER_BASELINE_WITH_DELTA', 'PRELIMINARY_REVERSE_ENGINEERED') NOT NULL,
    `defaultConfigurationType` ENUM('CUSTOMER_DESIGN', 'SUPPLIER_STANDARD', 'SUPPLIER_MODIFIED') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `sourcing_pathways_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sourcing_projects` (
    `id` CHAR(36) NOT NULL,
    `projectNumber` VARCHAR(40) NOT NULL,
    `title` VARCHAR(250) NOT NULL,
    `description` TEXT NULL,
    `pathway` ENUM('A', 'B', 'C') NOT NULL,
    `reverseEngineeringRequired` BOOLEAN NOT NULL DEFAULT false,
    `engineeringOwnership` ENUM('COMPANY', 'SUPPLIER', 'SHARED') NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'IN_PROGRESS', 'QUALIFICATION', 'APPROVED', 'REJECTED', 'ON_HOLD', 'CANCELLED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `stage` ENUM('INTAKE', 'SUPPLIER_ONBOARDING', 'ENGINEERING_DEFINITION', 'REVERSE_ENGINEERING', 'VALIDATION', 'APPROVAL', 'PRODUCTION') NOT NULL DEFAULT 'INTAKE',
    `internalPartId` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NULL,
    `supplierPartId` CHAR(36) NULL,
    `supplierProductId` CHAR(36) NULL,
    `configurationId` CHAR(36) NULL,
    `ownerId` CHAR(36) NOT NULL,
    `targetDate` DATE NULL,
    `businessJustification` TEXT NULL,
    `annualVolume` INTEGER NULL,
    `specialProcesses` BOOLEAN NOT NULL DEFAULT false,
    `customerRequirements` BOOLEAN NOT NULL DEFAULT false,
    `applicabilityContext` JSON NULL,
    `applicabilityPolicyVersionId` CHAR(36) NULL,
    `checklistGeneratedAt` DATETIME(3) NULL,
    `supplierVisible` BOOLEAN NOT NULL DEFAULT false,
    `submittedAt` DATETIME(3) NULL,
    `submittedById` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `holdReason` TEXT NULL,
    `workflowInstanceId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `sourcing_projects_projectNumber_key`(`projectNumber`),
    UNIQUE INDEX `sourcing_projects_workflowInstanceId_key`(`workflowInstanceId`),
    INDEX `sourcing_projects_status_stage_idx`(`status`, `stage`),
    INDEX `sourcing_projects_supplierId_idx`(`supplierId`),
    INDEX `sourcing_projects_internalPartId_idx`(`internalPartId`),
    INDEX `sourcing_projects_ownerId_idx`(`ownerId`),
    FULLTEXT INDEX `sourcing_projects_projectNumber_title_idx`(`projectNumber`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sourcing_project_members` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `role` ENUM('OWNER', 'ENGINEERING', 'SUPPLIER_QUALITY', 'PURCHASING', 'APPROVER', 'CONTRIBUTOR') NOT NULL,
    `dueDate` DATE NULL,
    `responsibility` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sourcing_project_members_userId_idx`(`userId`),
    UNIQUE INDEX `sourcing_project_members_projectId_userId_role_key`(`projectId`, `userId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_assessments` (
    `id` CHAR(36) NOT NULL,
    `sourcingProjectId` CHAR(36) NULL,
    `internalPartId` CHAR(36) NOT NULL,
    `modelVersion` VARCHAR(20) NOT NULL,
    `factors` JSON NOT NULL,
    `score` INTEGER NOT NULL,
    `level` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `specialProcesses` BOOLEAN NOT NULL DEFAULT false,
    `specialProcessList` TEXT NULL,
    `rationale` TEXT NULL,
    `isCurrent` BOOLEAN NOT NULL DEFAULT true,
    `assessedById` CHAR(36) NOT NULL,
    `assessedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `risk_assessments_sourcingProjectId_isCurrent_idx`(`sourcingProjectId`, `isCurrent`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `applicability_policies` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `applicability_policies_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `applicability_policy_versions` (
    `id` CHAR(36) NOT NULL,
    `policyId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `activatedAt` DATETIME(3) NULL,
    `activatedById` CHAR(36) NULL,
    `retiredAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `applicability_policy_versions_policyId_version_key`(`policyId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `applicability_rules` (
    `id` CHAR(36) NOT NULL,
    `policyVersionId` CHAR(36) NOT NULL,
    `documentTypeId` CHAR(36) NOT NULL,
    `outcome` ENUM('REQUIRED', 'CONDITIONAL', 'NOT_APPLICABLE') NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `conditions` JSON NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `dueOffsetDays` INTEGER NULL,
    `defaultAssigneeRoleKey` VARCHAR(60) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `applicability_rules_policyVersionId_documentTypeId_idx`(`policyVersionId`, `documentTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `required_documents` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NULL,
    `changeRequestId` CHAR(36) NULL,
    `qualificationId` CHAR(36) NULL,
    `documentTypeId` CHAR(36) NOT NULL,
    `level` ENUM('REQUIRED', 'CONDITIONAL', 'NOT_APPLICABLE') NOT NULL,
    `status` ENUM('OPEN', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'WAIVED', 'NOT_APPLICABLE') NOT NULL DEFAULT 'OPEN',
    `source` ENUM('POLICY', 'MANUAL', 'CHANGE_ASSESSMENT') NOT NULL DEFAULT 'POLICY',
    `ruleId` CHAR(36) NULL,
    `reason` VARCHAR(500) NULL,
    `notes` TEXT NULL,
    `assignedToId` CHAR(36) NULL,
    `assignedRoleKey` VARCHAR(60) NULL,
    `dueDate` DATE NULL,
    `documentId` CHAR(36) NULL,
    `acceptedRevisionId` CHAR(36) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `waivedById` CHAR(36) NULL,
    `waivedAt` DATETIME(3) NULL,
    `waiverJustification` TEXT NULL,
    `addedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `required_documents_projectId_status_idx`(`projectId`, `status`),
    INDEX `required_documents_changeRequestId_idx`(`changeRequestId`),
    INDEX `required_documents_qualificationId_idx`(`qualificationId`),
    INDEX `required_documents_documentId_idx`(`documentId`),
    INDEX `required_documents_assignedToId_status_idx`(`assignedToId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `supplierNumber` VARCHAR(40) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `legalName` VARCHAR(250) NULL,
    `website` VARCHAR(300) NULL,
    `country` CHAR(2) NOT NULL,
    `status` ENUM('PROSPECTIVE', 'UNDER_EVALUATION', 'APPROVED', 'CONDITIONALLY_APPROVED', 'SUSPENDED', 'INACTIVE') NOT NULL DEFAULT 'PROSPECTIVE',
    `statusReason` VARCHAR(1000) NULL,
    `statusChangedAt` DATETIME(3) NULL,
    `dunsNumber` VARCHAR(20) NULL,
    `taxId` VARCHAR(40) NULL,
    `notes` TEXT NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `suppliers_organizationId_key`(`organizationId`),
    UNIQUE INDEX `suppliers_supplierNumber_key`(`supplierNumber`),
    INDEX `suppliers_status_idx`(`status`),
    INDEX `suppliers_name_idx`(`name`),
    FULLTEXT INDEX `suppliers_name_legalName_supplierNumber_idx`(`name`, `legalName`, `supplierNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_addresses` (
    `id` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `type` ENUM('LEGAL', 'MAILING', 'BILLING', 'SHIPPING') NOT NULL,
    `line1` VARCHAR(200) NOT NULL,
    `line2` VARCHAR(200) NULL,
    `city` VARCHAR(120) NOT NULL,
    `region` VARCHAR(120) NULL,
    `postalCode` VARCHAR(20) NULL,
    `country` CHAR(2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `supplier_addresses_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_sites` (
    `id` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteCode` VARCHAR(40) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `line1` VARCHAR(200) NULL,
    `line2` VARCHAR(200) NULL,
    `city` VARCHAR(120) NOT NULL,
    `region` VARCHAR(120) NULL,
    `postalCode` VARCHAR(20) NULL,
    `country` CHAR(2) NOT NULL,
    `isManufacturing` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('PROSPECTIVE', 'UNDER_EVALUATION', 'APPROVED', 'CONDITIONALLY_APPROVED', 'SUSPENDED', 'INACTIVE') NOT NULL DEFAULT 'PROSPECTIVE',
    `processes` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    UNIQUE INDEX `supplier_sites_supplierId_siteCode_key`(`supplierId`, `siteCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contacts` (
    `id` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NULL,
    `name` VARCHAR(160) NOT NULL,
    `title` VARCHAR(120) NULL,
    `email` VARCHAR(254) NULL,
    `phone` VARCHAR(40) NULL,
    `role` VARCHAR(80) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    INDEX `contacts_supplierId_idx`(`supplierId`),
    INDEX `contacts_siteId_idx`(`siteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capabilities` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `isSpecialProcess` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `capabilities_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_capabilities` (
    `supplierId` CHAR(36) NOT NULL,
    `capabilityId` CHAR(36) NOT NULL,
    `notes` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `supplier_capabilities_capabilityId_idx`(`capabilityId`),
    PRIMARY KEY (`supplierId`, `capabilityId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_product_categories` (
    `supplierId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,

    INDEX `supplier_product_categories_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`supplierId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_certifications` (
    `id` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NULL,
    `standard` VARCHAR(80) NOT NULL,
    `certificateNumber` VARCHAR(80) NULL,
    `registrar` VARCHAR(160) NULL,
    `scope` VARCHAR(1000) NULL,
    `issuedAt` DATE NULL,
    `expiresAt` DATE NULL,
    `status` ENUM('PENDING_VERIFICATION', 'VALID', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `documentId` CHAR(36) NULL,
    `lastExpiryAlertAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    INDEX `supplier_certifications_supplierId_idx`(`supplierId`),
    INDEX `supplier_certifications_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_qualifications` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `siteId` CHAR(36) NULL,
    `type` ENUM('INITIAL', 'REQUALIFICATION', 'PERIODIC_REVIEW', 'SCOPE_EXTENSION') NOT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'CONDITIONALLY_APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `scope` VARCHAR(1000) NULL,
    `summary` TEXT NULL,
    `auditScore` DECIMAL(5, 2) NULL,
    `proposedStatus` ENUM('PROSPECTIVE', 'UNDER_EVALUATION', 'APPROVED', 'CONDITIONALLY_APPROVED', 'SUSPENDED', 'INACTIVE') NOT NULL,
    `conditions` TEXT NULL,
    `validUntil` DATE NULL,
    `decidedById` CHAR(36) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionComment` TEXT NULL,
    `workflowInstanceId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `supplier_qualifications_number_key`(`number`),
    UNIQUE INDEX `supplier_qualifications_workflowInstanceId_key`(`workflowInstanceId`),
    INDEX `supplier_qualifications_supplierId_status_idx`(`supplierId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_performance_metrics` (
    `id` CHAR(36) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `metricKey` VARCHAR(60) NOT NULL,
    `value` DECIMAL(14, 4) NOT NULL,
    `target` DECIMAL(14, 4) NULL,
    `unit` VARCHAR(20) NULL,
    `source` ENUM('CALCULATED', 'MANUAL') NOT NULL DEFAULT 'CALCULATED',
    `notes` VARCHAR(1000) NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `supplier_performance_metrics_periodStart_idx`(`periodStart`),
    UNIQUE INDEX `supplier_performance_metrics_supplierId_metricKey_periodStar_key`(`supplierId`, `metricKey`, `periodStart`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_definitions` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `version` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `subjectType` ENUM('DOCUMENT_REVISION', 'PRODUCT_QUALIFICATION', 'CHANGE_REQUEST', 'SUPPLIER_QUALIFICATION', 'DEVIATION', 'SOURCING_PROJECT', 'NCR_DISPOSITION', 'SCAR_CLOSURE') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_definitions_subjectType_isActive_idx`(`subjectType`, `isActive`),
    UNIQUE INDEX `workflow_definitions_key_version_key`(`key`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_step_definitions` (
    `id` CHAR(36) NOT NULL,
    `definitionId` CHAR(36) NOT NULL,
    `stepOrder` INTEGER NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `approverType` ENUM('ROLE', 'USER', 'RECORD_OWNER') NOT NULL,
    `approverRoleKey` VARCHAR(60) NULL,
    `approverUserId` CHAR(36) NULL,
    `requiredApprovals` INTEGER NOT NULL DEFAULT 1,
    `dueInDays` INTEGER NULL,
    `escalateAfterDays` INTEGER NULL,
    `escalateToRoleKey` VARCHAR(60) NULL,
    `allowDelegation` BOOLEAN NOT NULL DEFAULT true,
    `condition` JSON NULL,

    INDEX `workflow_step_definitions_definitionId_stepOrder_idx`(`definitionId`, `stepOrder`),
    UNIQUE INDEX `workflow_step_definitions_definitionId_key_key`(`definitionId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_instances` (
    `id` CHAR(36) NOT NULL,
    `definitionId` CHAR(36) NOT NULL,
    `subjectType` ENUM('DOCUMENT_REVISION', 'PRODUCT_QUALIFICATION', 'CHANGE_REQUEST', 'SUPPLIER_QUALIFICATION', 'DEVIATION', 'SOURCING_PROJECT', 'NCR_DISPOSITION', 'SCAR_CLOSURE') NOT NULL,
    `subjectId` CHAR(36) NOT NULL,
    `subjectLabel` VARCHAR(200) NOT NULL,
    `subjectVersionRef` VARCHAR(100) NULL,
    `status` ENUM('ACTIVE', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `currentStepOrder` INTEGER NULL,
    `context` JSON NULL,
    `startedById` CHAR(36) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `outcomeComment` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `workflow_instances_subjectType_subjectId_idx`(`subjectType`, `subjectId`),
    INDEX `workflow_instances_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_steps` (
    `id` CHAR(36) NOT NULL,
    `instanceId` CHAR(36) NOT NULL,
    `stepDefinitionId` CHAR(36) NOT NULL,
    `stepOrder` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `status` ENUM('WAITING', 'ACTIVE', 'APPROVED', 'REJECTED', 'SKIPPED', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
    `requiredApprovals` INTEGER NOT NULL DEFAULT 1,
    `activatedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `dueAt` DATETIME(3) NULL,

    INDEX `workflow_steps_instanceId_stepOrder_idx`(`instanceId`, `stepOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_assignments` (
    `id` CHAR(36) NOT NULL,
    `stepId` CHAR(36) NOT NULL,
    `assigneeUserId` CHAR(36) NULL,
    `assigneeRoleKey` VARCHAR(60) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'REASSIGNED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `comment` TEXT NULL,
    `decidedById` CHAR(36) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decidedSubjectRef` VARCHAR(100) NULL,
    `dueAt` DATETIME(3) NULL,
    `escalatedAt` DATETIME(3) NULL,
    `escalationLevel` INTEGER NOT NULL DEFAULT 0,
    `reassignedFromId` CHAR(36) NULL,
    `reassignedById` CHAR(36) NULL,
    `reassignReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `approval_assignments_assigneeUserId_status_idx`(`assigneeUserId`, `status`),
    INDEX `approval_assignments_assigneeRoleKey_status_idx`(`assigneeRoleKey`, `status`),
    INDEX `approval_assignments_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `type` ENUM('APPROVAL', 'DOCUMENT_SUBMISSION', 'ACTION', 'REVIEW', 'SCAR_RESPONSE', 'INFO_REQUEST', 'FOLLOW_UP') NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `assigneeUserId` CHAR(36) NULL,
    `assigneeRoleKey` VARCHAR(60) NULL,
    `assigneeOrganizationId` CHAR(36) NULL,
    `dueAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `completedById` CHAR(36) NULL,
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NULL,
    `entityId` CHAR(36) NULL,
    `entityLabel` VARCHAR(200) NULL,
    `approvalAssignmentId` CHAR(36) NULL,
    `requiredDocumentId` CHAR(36) NULL,
    `lastReminderAt` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `tasks_assigneeUserId_status_idx`(`assigneeUserId`, `status`),
    INDEX `tasks_assigneeRoleKey_status_idx`(`assigneeRoleKey`, `status`),
    INDEX `tasks_assigneeOrganizationId_status_idx`(`assigneeOrganizationId`, `status`),
    INDEX `tasks_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `tasks_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comments` (
    `id` CHAR(36) NOT NULL,
    `entityType` ENUM('ORGANIZATION', 'USER', 'SUPPLIER', 'SUPPLIER_SITE', 'CONTACT', 'SUPPLIER_CERTIFICATION', 'INTERNAL_PART', 'SUPPLIER_PART', 'SUPPLIER_PRODUCT', 'PRODUCT_CONFIGURATION', 'CONFIGURATION_REVISION', 'SOURCING_PROJECT', 'RISK_ASSESSMENT', 'DOCUMENT_TYPE', 'DOCUMENT_TEMPLATE', 'TEMPLATE_REVISION', 'DOCUMENT', 'DOCUMENT_REVISION', 'REQUIRED_DOCUMENT', 'FILE', 'SUPPLIER_QUALIFICATION', 'PRODUCT_QUALIFICATION', 'FIRST_ARTICLE_INSPECTION', 'TEST_RECORD', 'CHANGE_REQUEST', 'DEVIATION', 'NCR', 'SCAR', 'WORKFLOW_INSTANCE', 'APPROVAL_ASSIGNMENT', 'TASK', 'APPLICABILITY_POLICY', 'SYSTEM') NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `authorId` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `visibility` ENUM('INTERNAL', 'SUPPLIER') NOT NULL DEFAULT 'INTERNAL',
    `parentId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `comments_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `document_types` ADD CONSTRAINT `document_types_retentionPolicyId_fkey` FOREIGN KEY (`retentionPolicyId`) REFERENCES `retention_policies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_types` ADD CONSTRAINT `document_types_supersededByTypeId_fkey` FOREIGN KEY (`supersededByTypeId`) REFERENCES `document_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_templates` ADD CONSTRAINT `document_templates_documentTypeId_fkey` FOREIGN KEY (`documentTypeId`) REFERENCES `document_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_revisions` ADD CONSTRAINT `template_revisions_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `document_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_revisions` ADD CONSTRAINT `template_revisions_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `file_objects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_revisions` ADD CONSTRAINT `template_revisions_formDefinitionVersionId_fkey` FOREIGN KEY (`formDefinitionVersionId`) REFERENCES `form_definition_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `form_definitions` ADD CONSTRAINT `form_definitions_documentTypeId_fkey` FOREIGN KEY (`documentTypeId`) REFERENCES `document_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `form_definition_versions` ADD CONSTRAINT `form_definition_versions_formDefinitionId_fkey` FOREIGN KEY (`formDefinitionId`) REFERENCES `form_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_records` ADD CONSTRAINT `document_records_documentTypeId_fkey` FOREIGN KEY (`documentTypeId`) REFERENCES `document_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_records` ADD CONSTRAINT `document_records_ownerOrganizationId_fkey` FOREIGN KEY (`ownerOrganizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_records` ADD CONSTRAINT `document_records_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_records` ADD CONSTRAINT `document_records_latestRevisionId_fkey` FOREIGN KEY (`latestRevisionId`) REFERENCES `document_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_records` ADD CONSTRAINT `document_records_releasedRevisionId_fkey` FOREIGN KEY (`releasedRevisionId`) REFERENCES `document_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_revisions` ADD CONSTRAINT `document_revisions_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `document_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_revisions` ADD CONSTRAINT `document_revisions_templateRevisionId_fkey` FOREIGN KEY (`templateRevisionId`) REFERENCES `template_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_revisions` ADD CONSTRAINT `document_revisions_formDefinitionVersionId_fkey` FOREIGN KEY (`formDefinitionVersionId`) REFERENCES `form_definition_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_revisions` ADD CONSTRAINT `document_revisions_supersededByRevisionId_fkey` FOREIGN KEY (`supersededByRevisionId`) REFERENCES `document_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_revision_files` ADD CONSTRAINT `document_revision_files_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `document_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_revision_files` ADD CONSTRAINT `document_revision_files_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `file_objects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_objects` ADD CONSTRAINT `file_objects_ownerOrganizationId_fkey` FOREIGN KEY (`ownerOrganizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_links` ADD CONSTRAINT `document_links_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `document_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_links` ADD CONSTRAINT `document_links_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `document_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_shares` ADD CONSTRAINT `document_shares_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `document_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_shares` ADD CONSTRAINT `document_shares_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_acknowledgments` ADD CONSTRAINT `document_acknowledgments_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `document_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_acknowledgments` ADD CONSTRAINT `document_acknowledgments_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_releases` ADD CONSTRAINT `document_releases_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `document_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_supersessions` ADD CONSTRAINT `document_supersessions_supersededDocumentId_fkey` FOREIGN KEY (`supersededDocumentId`) REFERENCES `document_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_supersessions` ADD CONSTRAINT `document_supersessions_supersedingDocumentId_fkey` FOREIGN KEY (`supersedingDocumentId`) REFERENCES `document_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `record_attachments` ADD CONSTRAINT `record_attachments_fileObjectId_fkey` FOREIGN KEY (`fileObjectId`) REFERENCES `file_objects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_mfa_factors` ADD CONSTRAINT `user_mfa_factors_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_memberships` ADD CONSTRAINT `organization_memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_memberships` ADD CONSTRAINT `organization_memberships_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_roles` ADD CONSTRAINT `membership_roles_membershipId_fkey` FOREIGN KEY (`membershipId`) REFERENCES `organization_memberships`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_roles` ADD CONSTRAINT `membership_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_acceptedUserId_fkey` FOREIGN KEY (`acceptedUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitation_roles` ADD CONSTRAINT `invitation_roles_invitationId_fkey` FOREIGN KEY (`invitationId`) REFERENCES `invitations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitation_roles` ADD CONSTRAINT `invitation_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_views` ADD CONSTRAINT `saved_views_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_categories` ADD CONSTRAINT `product_categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `product_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `internal_parts` ADD CONSTRAINT `internal_parts_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `oem_cross_references` ADD CONSTRAINT `oem_cross_references_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_parts` ADD CONSTRAINT `supplier_parts_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `part_cross_references` ADD CONSTRAINT `part_cross_references_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `part_cross_references` ADD CONSTRAINT `part_cross_references_supplierPartId_fkey` FOREIGN KEY (`supplierPartId`) REFERENCES `supplier_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_supplierPartId_fkey` FOREIGN KEY (`supplierPartId`) REFERENCES `supplier_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_products` ADD CONSTRAINT `supplier_products_originProjectId_fkey` FOREIGN KEY (`originProjectId`) REFERENCES `sourcing_projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_configurations` ADD CONSTRAINT `product_configurations_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_configurations` ADD CONSTRAINT `product_configurations_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_configurations` ADD CONSTRAINT `product_configurations_baseConfigurationId_fkey` FOREIGN KEY (`baseConfigurationId`) REFERENCES `product_configurations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_configurations` ADD CONSTRAINT `product_configurations_currentApprovedRevisionId_fkey` FOREIGN KEY (`currentApprovedRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_revisions` ADD CONSTRAINT `configuration_revisions_configurationId_fkey` FOREIGN KEY (`configurationId`) REFERENCES `product_configurations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_revisions` ADD CONSTRAINT `configuration_revisions_derivedFromRevisionId_fkey` FOREIGN KEY (`derivedFromRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `configuration_revisions` ADD CONSTRAINT `configuration_revisions_supersededByRevisionId_fkey` FOREIGN KEY (`supersededByRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `engineering_baselines` ADD CONSTRAINT `engineering_baselines_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_requirements` ADD CONSTRAINT `customer_requirements_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `critical_characteristics` ADD CONSTRAINT `critical_characteristics_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `critical_characteristics` ADD CONSTRAINT `critical_characteristics_customerRequirementId_fkey` FOREIGN KEY (`customerRequirementId`) REFERENCES `customer_requirements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_approvals` ADD CONSTRAINT `product_approvals_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_approvals` ADD CONSTRAINT `product_approvals_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_approvals` ADD CONSTRAINT `product_approvals_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_approvals` ADD CONSTRAINT `product_approvals_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_approvals` ADD CONSTRAINT `product_approvals_approvalPackageId_fkey` FOREIGN KEY (`approvalPackageId`) REFERENCES `approval_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_qualifications` ADD CONSTRAINT `product_qualifications_sourcingProjectId_fkey` FOREIGN KEY (`sourcingProjectId`) REFERENCES `sourcing_projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_qualifications` ADD CONSTRAINT `product_qualifications_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `change_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_qualifications` ADD CONSTRAINT `product_qualifications_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_qualifications` ADD CONSTRAINT `product_qualifications_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_qualifications` ADD CONSTRAINT `product_qualifications_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_qualifications` ADD CONSTRAINT `product_qualifications_workflowInstanceId_fkey` FOREIGN KEY (`workflowInstanceId`) REFERENCES `workflow_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_requirements` ADD CONSTRAINT `inspection_requirements_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_requirements` ADD CONSTRAINT `inspection_requirements_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_requirements` ADD CONSTRAINT `inspection_requirements_characteristicId_fkey` FOREIGN KEY (`characteristicId`) REFERENCES `critical_characteristics`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_results` ADD CONSTRAINT `inspection_results_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_results` ADD CONSTRAINT `inspection_results_inspectionRequirementId_fkey` FOREIGN KEY (`inspectionRequirementId`) REFERENCES `inspection_requirements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_results` ADD CONSTRAINT `inspection_results_characteristicId_fkey` FOREIGN KEY (`characteristicId`) REFERENCES `critical_characteristics`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inspection_results` ADD CONSTRAINT `inspection_results_firstArticleId_fkey` FOREIGN KEY (`firstArticleId`) REFERENCES `first_article_inspections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `test_records` ADD CONSTRAINT `test_records_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `first_article_inspections` ADD CONSTRAINT `first_article_inspections_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_packages` ADD CONSTRAINT `approval_packages_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_package_items` ADD CONSTRAINT `approval_package_items_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `approval_packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_package_items` ADD CONSTRAINT `approval_package_items_documentRevisionId_fkey` FOREIGN KEY (`documentRevisionId`) REFERENCES `document_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_supplierPartId_fkey` FOREIGN KEY (`supplierPartId`) REFERENCES `supplier_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_currentSiteId_fkey` FOREIGN KEY (`currentSiteId`) REFERENCES `supplier_sites`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_proposedSiteId_fkey` FOREIGN KEY (`proposedSiteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_currentRevisionId_fkey` FOREIGN KEY (`currentRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_proposedRevisionId_fkey` FOREIGN KEY (`proposedRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_submittedByOrganizationId_fkey` FOREIGN KEY (`submittedByOrganizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_requests` ADD CONSTRAINT `change_requests_workflowInstanceId_fkey` FOREIGN KEY (`workflowInstanceId`) REFERENCES `workflow_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_request_categories` ADD CONSTRAINT `change_request_categories_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `change_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `change_impact_assessments` ADD CONSTRAINT `change_impact_assessments_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `change_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deviations` ADD CONSTRAINT `deviations_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deviations` ADD CONSTRAINT `deviations_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deviations` ADD CONSTRAINT `deviations_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deviations` ADD CONSTRAINT `deviations_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deviations` ADD CONSTRAINT `deviations_ncrId_fkey` FOREIGN KEY (`ncrId`) REFERENCES `nonconformances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deviations` ADD CONSTRAINT `deviations_workflowInstanceId_fkey` FOREIGN KEY (`workflowInstanceId`) REFERENCES `workflow_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_supplierPartId_fkey` FOREIGN KEY (`supplierPartId`) REFERENCES `supplier_parts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `configuration_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_characteristicId_fkey` FOREIGN KEY (`characteristicId`) REFERENCES `critical_characteristics`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nonconformances` ADD CONSTRAINT `nonconformances_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_ncrId_fkey` FOREIGN KEY (`ncrId`) REFERENCES `nonconformances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_action_responses` ADD CONSTRAINT `corrective_action_responses_scarId_fkey` FOREIGN KEY (`scarId`) REFERENCES `corrective_actions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `corrective_action_responses` ADD CONSTRAINT `corrective_action_responses_submittedByOrganizationId_fkey` FOREIGN KEY (`submittedByOrganizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_supplierPartId_fkey` FOREIGN KEY (`supplierPartId`) REFERENCES `supplier_parts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_supplierProductId_fkey` FOREIGN KEY (`supplierProductId`) REFERENCES `supplier_products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_configurationId_fkey` FOREIGN KEY (`configurationId`) REFERENCES `product_configurations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_applicabilityPolicyVersionId_fkey` FOREIGN KEY (`applicabilityPolicyVersionId`) REFERENCES `applicability_policy_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_projects` ADD CONSTRAINT `sourcing_projects_workflowInstanceId_fkey` FOREIGN KEY (`workflowInstanceId`) REFERENCES `workflow_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_project_members` ADD CONSTRAINT `sourcing_project_members_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `sourcing_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_project_members` ADD CONSTRAINT `sourcing_project_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_sourcingProjectId_fkey` FOREIGN KEY (`sourcingProjectId`) REFERENCES `sourcing_projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_internalPartId_fkey` FOREIGN KEY (`internalPartId`) REFERENCES `internal_parts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `applicability_policy_versions` ADD CONSTRAINT `applicability_policy_versions_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `applicability_policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `applicability_rules` ADD CONSTRAINT `applicability_rules_policyVersionId_fkey` FOREIGN KEY (`policyVersionId`) REFERENCES `applicability_policy_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `applicability_rules` ADD CONSTRAINT `applicability_rules_documentTypeId_fkey` FOREIGN KEY (`documentTypeId`) REFERENCES `document_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `required_documents` ADD CONSTRAINT `required_documents_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `sourcing_projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `required_documents` ADD CONSTRAINT `required_documents_changeRequestId_fkey` FOREIGN KEY (`changeRequestId`) REFERENCES `change_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `required_documents` ADD CONSTRAINT `required_documents_qualificationId_fkey` FOREIGN KEY (`qualificationId`) REFERENCES `product_qualifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `required_documents` ADD CONSTRAINT `required_documents_documentTypeId_fkey` FOREIGN KEY (`documentTypeId`) REFERENCES `document_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `required_documents` ADD CONSTRAINT `required_documents_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `applicability_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `required_documents` ADD CONSTRAINT `required_documents_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `document_records`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `required_documents` ADD CONSTRAINT `required_documents_acceptedRevisionId_fkey` FOREIGN KEY (`acceptedRevisionId`) REFERENCES `document_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_addresses` ADD CONSTRAINT `supplier_addresses_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_sites` ADD CONSTRAINT `supplier_sites_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_capabilities` ADD CONSTRAINT `supplier_capabilities_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_capabilities` ADD CONSTRAINT `supplier_capabilities_capabilityId_fkey` FOREIGN KEY (`capabilityId`) REFERENCES `capabilities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_product_categories` ADD CONSTRAINT `supplier_product_categories_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_product_categories` ADD CONSTRAINT `supplier_product_categories_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_certifications` ADD CONSTRAINT `supplier_certifications_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_certifications` ADD CONSTRAINT `supplier_certifications_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_certifications` ADD CONSTRAINT `supplier_certifications_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `document_records`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_qualifications` ADD CONSTRAINT `supplier_qualifications_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_qualifications` ADD CONSTRAINT `supplier_qualifications_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `supplier_sites`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_qualifications` ADD CONSTRAINT `supplier_qualifications_workflowInstanceId_fkey` FOREIGN KEY (`workflowInstanceId`) REFERENCES `workflow_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_performance_metrics` ADD CONSTRAINT `supplier_performance_metrics_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_step_definitions` ADD CONSTRAINT `workflow_step_definitions_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `workflow_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `workflow_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_steps` ADD CONSTRAINT `workflow_steps_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `workflow_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_steps` ADD CONSTRAINT `workflow_steps_stepDefinitionId_fkey` FOREIGN KEY (`stepDefinitionId`) REFERENCES `workflow_step_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_assignments` ADD CONSTRAINT `approval_assignments_stepId_fkey` FOREIGN KEY (`stepId`) REFERENCES `workflow_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_assignments` ADD CONSTRAINT `approval_assignments_assigneeUserId_fkey` FOREIGN KEY (`assigneeUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_assignments` ADD CONSTRAINT `approval_assignments_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_assignments` ADD CONSTRAINT `approval_assignments_reassignedFromId_fkey` FOREIGN KEY (`reassignedFromId`) REFERENCES `approval_assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assigneeUserId_fkey` FOREIGN KEY (`assigneeUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assigneeOrganizationId_fkey` FOREIGN KEY (`assigneeOrganizationId`) REFERENCES `organizations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_approvalAssignmentId_fkey` FOREIGN KEY (`approvalAssignmentId`) REFERENCES `approval_assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
