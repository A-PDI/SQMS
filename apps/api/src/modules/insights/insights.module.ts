import { Module } from "@nestjs/common";
import { ProductsModule } from "../products/products.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { InsightsController } from "./insights.controller";
import { InsightsService } from "./insights.service";

@Module({ imports: [SuppliersModule, ProductsModule], controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
