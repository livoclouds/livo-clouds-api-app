import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { OnboardingStatus } from '../../../common/types';

export class UpdateOnboardingDto {
  @ApiPropertyOptional({ enum: OnboardingStatus, example: OnboardingStatus.IN_PROGRESS })
  @IsOptional()
  @IsEnum(OnboardingStatus)
  status?: OnboardingStatus;

  @ApiPropertyOptional({ example: 3, description: 'Last tour step reached' })
  @IsOptional()
  @IsInt()
  @Min(0)
  step?: number;
}
