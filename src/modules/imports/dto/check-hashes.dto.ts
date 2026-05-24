import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

const HASH_REGEX = /^[0-9a-f]{64}$/i;

export class CheckHashesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'hashes must contain at least 1 entry' })
  @ArrayMaxSize(10, { message: 'hashes must not exceed 10 entries' })
  @IsString({ each: true })
  @Matches(HASH_REGEX, {
    each: true,
    message: 'each hash must be a 64-character lowercase hex string (SHA-256)',
  })
  hashes: string[];
}
