import { Transform, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const OBJECT_SORT_FIELDS = [
  'fileName',
  'size',
  'lastModified',
  'condominiumName',
  'uploaderName',
  'lastAccessedAt',
  'createdAt',
] as const;
export type ObjectSortField = (typeof OBJECT_SORT_FIELDS)[number];

export const AGGREGATE_SORT_FIELDS = [
  'name',
  'fileCount',
  'totalSize',
  'lastUploadAt',
] as const;
export type AggregateSortField = (typeof AGGREGATE_SORT_FIELDS)[number];

export class ListObjectsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  condominiumId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  extension?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeMax?: number;

  @IsOptional()
  @IsString()
  modifiedFrom?: string;

  @IsOptional()
  @IsString()
  modifiedTo?: string;

  @IsOptional()
  @IsBooleanString()
  orphan?: string;

  @IsOptional()
  @IsIn(OBJECT_SORT_FIELDS as unknown as string[])
  sortBy?: ObjectSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeAccessLog?: boolean;
}

export class ListAggregateQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(AGGREGATE_SORT_FIELDS as unknown as string[])
  sortBy?: AggregateSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class ListUserAggregateQuery extends ListAggregateQuery {
  @IsOptional()
  @IsString()
  condominiumId?: string;
}
