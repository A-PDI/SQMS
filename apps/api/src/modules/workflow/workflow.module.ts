import { Global, Module } from "@nestjs/common";
import { EntityAccessService } from "../entity/entity-access.service";
import { WorkflowController } from "./workflow.controller";
import { WorkflowService } from "./workflow.service";

@Global()
@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, EntityAccessService],
  exports: [WorkflowService, EntityAccessService],
})
export class WorkflowModule {}
