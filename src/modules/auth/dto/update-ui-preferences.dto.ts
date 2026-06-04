import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationSound, UiLocale, UiThemeMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Body for updating the current user's UI preferences (PATCH — every field is
 * optional, only the provided keys are written). Passing `null` for `locale` or
 * `primaryColor` clears the override so the user falls back to the condominium
 * default. `@IsOptional()` deliberately allows `null` through (it short-circuits
 * before `@IsEnum`/`@Matches`), which is how a "clear the override" PATCH works.
 */
export class UpdateUiPreferencesDto {
  @ApiPropertyOptional({
    enum: UiLocale,
    nullable: true,
    description: 'Locale override; null inherits the condominium default.',
  })
  @IsOptional()
  @IsEnum(UiLocale)
  locale?: UiLocale | null;

  @ApiPropertyOptional({ enum: UiThemeMode })
  @IsOptional()
  @IsEnum(UiThemeMode)
  themeMode?: UiThemeMode;

  @ApiPropertyOptional({
    nullable: true,
    example: '213 76% 45%',
    description:
      'Primary color as an HSL triplet ("H S% L%") to match the web --primary ' +
      'variable; null inherits the condominium branding color. Never a hex value.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/, {
    message: 'primaryColor must be an HSL triplet like "213 76% 45%"',
  })
  primaryColor?: string | null;

  @ApiPropertyOptional({
    description: 'Whether a sound plays on a successful Lock Screen unlock.',
  })
  @IsOptional()
  @IsBoolean()
  unlockSoundEnabled?: boolean;

  @ApiPropertyOptional({
    enum: NotificationSound,
    description: 'Sound preset played on a successful Lock Screen unlock.',
  })
  @IsOptional()
  @IsEnum(NotificationSound)
  unlockSoundChoice?: NotificationSound;

  @ApiPropertyOptional({
    description: 'Whether a sound plays when the Lock Screen engages.',
  })
  @IsOptional()
  @IsBoolean()
  lockSoundEnabled?: boolean;

  @ApiPropertyOptional({
    enum: NotificationSound,
    description: 'Sound preset played when the Lock Screen engages.',
  })
  @IsOptional()
  @IsEnum(NotificationSound)
  lockSoundChoice?: NotificationSound;
}
