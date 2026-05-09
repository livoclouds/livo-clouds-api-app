import { PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['email'] as const)) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
