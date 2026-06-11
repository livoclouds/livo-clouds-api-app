import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ArcoRequestStatusDto } from './create-arco-request.dto';

export enum BulkArcoActionType {
  STATUS_UPDATE = 'STATUS_UPDATE',
  DELETE = 'DELETE',
}

// Bulk operation over several ARCO requests at once (RP-014). Each request is
// processed individually (its own timeline event + audit row) so traceability is
// preserved — this DTO just carries the batch.
export class BulkArcoActionDto {
  @ApiProperty({ enum: BulkArcoActionType })
  @IsEnum(BulkArcoActionType)
  action: BulkArcoActionType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  requestIds: string[];

  // Required when action = STATUS_UPDATE.
  @ApiPropertyOptional({ enum: ArcoRequestStatusDto })
  @IsOptional()
  @IsEnum(ArcoRequestStatusDto)
  status?: ArcoRequestStatusDto;

  // Required when the bulk status is REJECTED (LFPDPPP Art. 12).
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rejectionReason?: string;
}
