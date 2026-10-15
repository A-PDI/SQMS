import { Global, Module } from "@nestjs/common";
import { ChecklistService } from "./checklist.service";
import { RequiredDocumentsController, SourcingController } from "./sourcing.controller";
import { SourcingService } from "./sourcing.service";

@Global()
@Module({ controllers: [SourcingController, RequiredDocumentsController], providers: [SourcingService, ChecklistService], exports: [SourcingService, ChecklistService] })
export class SourcingModule {}
