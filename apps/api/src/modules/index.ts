import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";
import { ConfigurationsModule } from "./configurations/configurations.module";
import { FilesModule } from "./files/files.module";
import { ProductsModule } from "./products/products.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { WorkflowModule } from "./workflow/workflow.module";

@Module({ controllers: [HealthController] })
class HealthModule {}

export const FEATURE_MODULES = [HealthModule, AuthModule, WorkflowModule, SuppliersModule, ProductsModule, ConfigurationsModule, FilesModule];
