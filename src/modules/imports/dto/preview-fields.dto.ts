import { plainToInstance } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  validateSync,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';

const HASH_REGEX = /^[0-9a-f]{64}$/i;

// ENGINE-061 — the preview endpoint receives `storedHashes`/`clientIds` as raw
// multipart text fields, which bypass the global ValidationPipe. This DTO applies
// the same constraints CheckHashesDto enforces on the JSON route (hash shape +
// array caps) so unbounded or malformed arrays never reach the dedup checks.
export class PreviewFieldsDto {
  @IsArray()
  @ArrayMaxSize(10, { message: 'storedHashes must not exceed 10 entries' })
  @IsString({ each: true })
  @Matches(HASH_REGEX, {
    each: true,
    message:
      'each storedHashes entry must be a 64-character hex string (SHA-256)',
  })
  storedHashes: string[] = [];

  @IsArray()
  @ArrayMaxSize(5, { message: 'clientIds must not exceed 5 entries' })
  @IsString({ each: true })
  @MaxLength(64, { each: true, message: 'each clientId must be ≤64 characters' })
  clientIds: string[] = [];
}

/** Parse a raw multipart text field expected to hold a JSON string array. */
export function parseJsonStringArray(
  raw: string | undefined,
  field: string,
): unknown {
  if (raw === undefined || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      reason: `Invalid preview payload — ${field} is not valid JSON`,
    });
  }
  return parsed;
}

/** Validate the parsed preview fields; throws 400 VALIDATION_FAILED on violation. */
export function validatePreviewFields(input: {
  storedHashes: unknown;
  clientIds: unknown;
}): PreviewFieldsDto {
  const dto = plainToInstance(PreviewFieldsDto, input);
  const errors = validateSync(dto, { whitelist: true });
  if (errors.length > 0) {
    const first = errors[0];
    const message = first.constraints
      ? Object.values(first.constraints)[0]
      : `${first.property} is invalid`;
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      reason: `Invalid preview payload — ${message}`,
    });
  }
  return dto;
}
