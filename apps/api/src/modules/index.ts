import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { ChangeRequestsModule } from "./change-requests/change-requests.module";
import { CollaborationModule } from "./collaboration/collaboration.module";
import { HealthController } from "./health/health.controller";
import { InsightsModule } from "./insights/insights.module";
import { ConfigurationsModule } from "./configurations/configurations.module";
import { DocumentTypesModule } from "./document-types/document-types.module";
import { DocumentsModule } from "./documents/documents.module";
import { FilesModule } from "./files/files.module";
import { ProductsModule } from "./products/products.module";
import { QualificationsModule } from "./qualifications/qualifications.module";
import { QualityModule } from "./quality/quality.module";
import { SourcingModule } from "./sourcing/sourcing.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { WorkflowModule } from "./workflow/workflow.module";

@Module({ controllers: [HealthController] })
class HealthModule {}

export const FEATURE_MODULES = [HealthModule, AuthModule, WorkflowModule, SuppliersModule, ProductsModule, ConfigurationsModule, FilesModule, DocumentTypesModule, DocumentsModule, SourcingModule, QualificationsModule, ChangeRequestsModule, QualityModule, CollaborationModule, AdminModule, InsightsModule];
