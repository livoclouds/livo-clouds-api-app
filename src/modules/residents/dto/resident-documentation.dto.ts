import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

// Nested validated shape for the Resident `documentation` Json column. Modelling
// it as a class — not raw Json — lets ValidationPipe reject unknown keys and
// non-boolean values. All five flags are required: `documentation` is persisted
// as a single Json blob, so a partial object would silently drop the omitted
// flags. The five keys mirror the Prisma schema default and the web modal.
export class ResidentDocumentationDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  propertyTax: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  titleDeed: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  ownerDocumentation: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  nationalId: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  proofOfAddress: boolean;
}
