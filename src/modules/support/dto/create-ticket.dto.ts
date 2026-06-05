import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  SupportModule,
  SupportPriority,
  SupportRequestType,
  SupportTicketStatus,
} from '@prisma/client';

// Wire (lowercamel) vocabularies — kept stable for the web client. The Prisma
// enums are UPPER_SNAKE (repo convention), so the service maps between the two.
export const TICKET_REQUEST_TYPES = [
  'technical',
  'usage',
  'improvement',
  'dataIssue',
  'admin',
] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const TICKET_MODULES = [
  'dashboard',
  'imports',
  'reconciliation',
  'residents',
  'reports',
  'inventory',
  'settings',
  'auth',
] as const;

export type TicketRequestTypeWire = (typeof TICKET_REQUEST_TYPES)[number];
export type TicketPriorityWire = (typeof TICKET_PRIORITIES)[number];
export type TicketModuleWire = (typeof TICKET_MODULES)[number];

export class CreateTicketDto {
  @ApiProperty({ enum: TICKET_REQUEST_TYPES })
  @IsIn(TICKET_REQUEST_TYPES)
  requestType: TicketRequestTypeWire;

  @ApiProperty({ enum: TICKET_PRIORITIES })
  @IsIn(TICKET_PRIORITIES)
  priority: TicketPriorityWire;

  @ApiProperty({ enum: TICKET_MODULES })
  @IsIn(TICKET_MODULES)
  module: TicketModuleWire;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;
}

// ─── Wire ⇄ Prisma enum maps ────────────────────────────────────────────────
export const REQUEST_TYPE_TO_PRISMA: Record<
  TicketRequestTypeWire,
  SupportRequestType
> = {
  technical: SupportRequestType.TECHNICAL,
  usage: SupportRequestType.USAGE,
  improvement: SupportRequestType.IMPROVEMENT,
  dataIssue: SupportRequestType.DATA_ISSUE,
  admin: SupportRequestType.ADMIN,
};

export const PRIORITY_TO_PRISMA: Record<TicketPriorityWire, SupportPriority> = {
  low: SupportPriority.LOW,
  medium: SupportPriority.MEDIUM,
  high: SupportPriority.HIGH,
  critical: SupportPriority.CRITICAL,
};

export const MODULE_TO_PRISMA: Record<TicketModuleWire, SupportModule> = {
  dashboard: SupportModule.DASHBOARD,
  imports: SupportModule.IMPORTS,
  reconciliation: SupportModule.RECONCILIATION,
  residents: SupportModule.RESIDENTS,
  reports: SupportModule.REPORTS,
  inventory: SupportModule.INVENTORY,
  settings: SupportModule.SETTINGS,
  auth: SupportModule.AUTH,
};

export const REQUEST_TYPE_TO_WIRE: Record<
  SupportRequestType,
  TicketRequestTypeWire
> = {
  TECHNICAL: 'technical',
  USAGE: 'usage',
  IMPROVEMENT: 'improvement',
  DATA_ISSUE: 'dataIssue',
  ADMIN: 'admin',
};

export const PRIORITY_TO_WIRE: Record<SupportPriority, TicketPriorityWire> = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

export const MODULE_TO_WIRE: Record<SupportModule, TicketModuleWire> = {
  DASHBOARD: 'dashboard',
  IMPORTS: 'imports',
  RECONCILIATION: 'reconciliation',
  RESIDENTS: 'residents',
  REPORTS: 'reports',
  INVENTORY: 'inventory',
  SETTINGS: 'settings',
  AUTH: 'auth',
};

export const STATUS_TO_WIRE: Record<SupportTicketStatus, string> = {
  OPEN: 'open',
  IN_PROGRESS: 'inProgress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};
