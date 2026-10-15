import { Global, Module } from "@nestjs/common";
import { DocumentTypesController, TemplatesController } from "./document-types.controller";
import { DocumentTypesService } from "./document-types.service";

@Global()
@Module({ controllers: [DocumentTypesController, TemplatesController], providers: [DocumentTypesService], exports: [DocumentTypesService] })
export class DocumentTypesModule {}
