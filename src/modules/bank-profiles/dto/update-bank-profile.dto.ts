import { PartialType } from '@nestjs/swagger';
import { CreateBankProfileDto } from './create-bank-profile.dto';

export class UpdateBankProfileDto extends PartialType(CreateBankProfileDto) {}
