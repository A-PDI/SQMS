import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "quality.engineer@example.com" })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  currentPassword: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  newPassword: string;
}

export class PasswordResetRequestDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  newPassword: string;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @ApiPropertyOptional({ example: "America/Chicago" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}
