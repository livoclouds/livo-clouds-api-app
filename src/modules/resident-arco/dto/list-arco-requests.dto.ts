import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ArcoRequestStatusDto, ArcoRequestTypeDto } from './create-arco-request.dto';

export class ListArcoRequestsDto {
  @ApiPropertyOptional({ enum: ArcoRequestTypeDto })
  @IsOptional()
  @IsEnum(ArcoRequestTypeDto)
  type?: ArcoRequestTypeDto;

  @ApiPropertyOptional({ enum: ArcoRequestStatusDto })
  @IsOptional()
  @IsEnum(ArcoRequestStatusDto)
  status?: ArcoRequestStatusDto;
}
