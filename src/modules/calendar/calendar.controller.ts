import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RbacService } from '../../common/rbac/rbac.service';
import { JwtPayload } from '../../common/types';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';
import { PaidLinkActionDto, UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

// CAL-027: the global ValidationPipe runs with whitelist:true but NOT
// forbidNonWhitelisted, so unknown fields are silently stripped. Several other
// modules deliberately rely on that silent stripping for mass-assignment defense,
// so flipping it globally is unsafe — instead scope a stricter pipe to the calendar
// write endpoints, mirroring imports.controller.ts. Unknown fields now 400 here.
const calendarWriteValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

@ApiTags('Calendar')
@Controller('condominiums/:condominiumSlug/calendar/events')
@UseGuards(CondominiumAccessGuard)
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly rbac: RbacService,
  ) {}

  // CAL-009: gate the reads on calendar.read (any-of with calendar.manage) so that
  // revoking the key actually blocks access — PermissionsGuard is a no-op otherwise.
  // CAL-032: resolve the visibility tier from LIVE effective permissions per request
  // (via RbacService), not the stale JWT role claim, so a role change applies at once.
  @Get()
  @RequirePermission('calendar.read', 'calendar.manage')
  @ApiOperation({ summary: 'List calendar events' })
  async findAll(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Query() query: ListCalendarEventsDto,
  ) {
    const perms = await this.rbac.getEffectivePermissions(req.user.sub);
    return this.calendarService.findAll(req.condominiumId, query, perms);
  }

  @Get(':id')
  @RequirePermission('calendar.read', 'calendar.manage')
  @ApiOperation({ summary: 'Get calendar event detail' })
  async findOne(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
  ) {
    const perms = await this.rbac.getEffectivePermissions(req.user.sub);
    return this.calendarService.findOne(req.condominiumId, id, perms);
  }

  @Post()
  @RequirePermission('calendar.manage')
  @ApiOperation({ summary: 'Create calendar event' })
  create(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Body(calendarWriteValidationPipe) dto: CreateCalendarEventDto,
  ) {
    return this.calendarService.create(req.condominiumId, req.user.sub, dto);
  }

  @Patch(':id')
  @RequirePermission('calendar.manage')
  @ApiOperation({ summary: 'Update calendar event' })
  update(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
    @Body(calendarWriteValidationPipe) dto: UpdateCalendarEventDto,
  ) {
    return this.calendarService.update(req.condominiumId, req.user.sub, id, dto);
  }

  @Delete(':id')
  @RequirePermission('calendar.manage')
  @ApiOperation({ summary: 'Soft delete calendar event' })
  remove(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
    // CAL-011: keep/reopen decision for a paid-linked terrace booking. Passed as a
    // query param since DELETE carries no body; omitting it on such a booking
    // returns 409 PAID_BOOKING_LINKED so the client can prompt the operator.
    @Query('paidLinkAction') paidLinkAction?: PaidLinkActionDto,
  ) {
    return this.calendarService.remove(req.condominiumId, req.user.sub, id, paidLinkAction);
  }
}
