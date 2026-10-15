import { Module } from "@nestjs/common";
import { CrossReferencesController, LookupsController, ProductApprovalsController, ProductsController, SupplierPartsController, SupplierProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

@Module({
  controllers: [LookupsController, ProductsController, SupplierPartsController, CrossReferencesController, SupplierProductsController, ProductApprovalsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
