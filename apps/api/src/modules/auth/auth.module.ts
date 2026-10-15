import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { IDENTITY_PROVIDER, LocalPasswordIdentityProvider } from "./identity.provider";

@Module({
  controllers: [AuthController],
  providers: [AuthService, LocalPasswordIdentityProvider, { provide: IDENTITY_PROVIDER, useExisting: LocalPasswordIdentityProvider }],
  exports: [AuthService],
})
export class AuthModule {}
