import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, ValidateIf } from 'class-validator';

// Wire (web-friendly) vote vocabulary. Maps to the Prisma `HelpVoteValue` enum
// in the service.
export const HELP_VOTE_WIRE_VALUES = ['helpful', 'notHelpful'] as const;
export type HelpVoteWire = (typeof HELP_VOTE_WIRE_VALUES)[number];

export class SubmitFeedbackDto {
  // 'helpful' | 'notHelpful' casts/changes a vote; null (or omitted) retracts it.
  @ApiPropertyOptional({ enum: HELP_VOTE_WIRE_VALUES, nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.value !== null)
  @IsIn(HELP_VOTE_WIRE_VALUES)
  value?: HelpVoteWire | null;
}
