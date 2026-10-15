import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 25;

  @ApiPropertyOptional({ description: "Free-text search" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: "Sort field (endpoint specific)" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sort?: string;

  @ApiPropertyOptional({ enum: ["asc", "desc"] })
  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc";
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageArgs(q: PageQueryDto): { skip: number; take: number; page: number; pageSize: number } {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 25;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

/** Resolves a sort field against an allow-list; never passes arbitrary client input to orderBy. */
export function sortArg<T extends string>(q: PageQueryDto, allowed: readonly T[], fallback: T, fallbackOrder: "asc" | "desc" = "desc"): Record<string, "asc" | "desc"> {
  const field = (allowed as readonly string[]).includes(q.sort ?? "") ? (q.sort as T) : fallback;
  return { [field]: q.order ?? fallbackOrder };
}

export function trimQ(q?: string): string | undefined {
  const t = q?.trim();
  return t ? t : undefined;
}
