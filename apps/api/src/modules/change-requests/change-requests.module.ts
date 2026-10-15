import { Global, Module } from "@nestjs/common";
import { ChangeRequestsController } from "./change-requests.controller";
import { ChangeRequestsService } from "./change-requests.service";

@Global()
@Module({ controllers: [ChangeRequestsController], providers: [ChangeRequestsService], exports: [ChangeRequestsService] })
export class ChangeRequestsModule {}
