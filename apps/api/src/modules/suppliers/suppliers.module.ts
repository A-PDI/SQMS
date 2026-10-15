import { Module } from "@nestjs/common";
import { SupplierQualificationsController, SuppliersController, SupplierSitesController } from "./suppliers.controller";
import { SuppliersService } from "./suppliers.service";

@Module({
  controllers: [SuppliersController, SupplierSitesController, SupplierQualificationsController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
