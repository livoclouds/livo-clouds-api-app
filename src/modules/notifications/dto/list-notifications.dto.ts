import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const NOTIFICATION_SORT_FIELDS = ['createdAt', 'type'] as const;
export type NotificationSortField = (typeof NOTIFICATION_SORT_FIELDS)[number];

export const NOTIFICATION_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type NotificationSortDirection =
  (typeof NOTIFICATION_SORT_DIRECTIONS)[number];

export class ListNotificationsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Return only notifications that have not been read.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Include dismissed notifications in the result set.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeDismissed?: boolean;

  @ApiPropertyOptional({
    description: 'Return only notifications that have already been read.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  readOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Return only notifications that are currently snoozed.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  snoozedOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Include snoozed-and-not-yet-due notifications in the result.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeSnoozed?: boolean;

  @ApiPropertyOptional({
    description: 'Field to sort by.',
    enum: NOTIFICATION_SORT_FIELDS,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_SORT_FIELDS)
  sortBy?: NotificationSortField;

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: NOTIFICATION_SORT_DIRECTIONS,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_SORT_DIRECTIONS)
  sortDir?: NotificationSortDirection;

  @ApiPropertyOptional({
    description: 'Comma-separated list of NotificationType values to filter by.',
    isArray: true,
    enum: NotificationType,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : value,
  )
  @IsEnum(NotificationType, { each: true })
  types?: NotificationType[];

  @ApiPropertyOptional({
    description: 'Filter notifications created on or after this ISO date.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter notifications created on or before this ISO date.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
