import { Global, Module } from "@nestjs/common";
import { QualificationsController } from "./qualifications.controller";
import { QualificationsService } from "./qualifications.service";

@Global()
@Module({ controllers: [QualificationsController], providers: [QualificationsService], exports: [QualificationsService] })
export class QualificationsModule {}
