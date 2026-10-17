import { Module } from "@nestjs/common";
import { AdminController, AuditController } from "./admin.controller";
import { ConfigAdminService } from "./config-admin.service";
import { UsersAdminService } from "./users-admin.service";

@Module({ controllers: [AdminController, AuditController], providers: [UsersAdminService, ConfigAdminService], exports: [UsersAdminService] })
export class AdminModule {}
