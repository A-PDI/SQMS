import { Global, Module } from "@nestjs/common";
import { DeviationsService } from "./deviations.service";
import { NcrService } from "./ncr.service";
import { DeviationsController, NcrController, ScarController } from "./quality.controller";
import { ScarService } from "./scar.service";

@Global()
@Module({ controllers: [DeviationsController, NcrController, ScarController], providers: [DeviationsService, NcrService, ScarService], exports: [DeviationsService, NcrService, ScarService] })
export class QualityModule {}
