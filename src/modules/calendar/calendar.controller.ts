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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload, UserRole } from '../../common/types';
import { CalendarService, CalendarEventQuery } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

@ApiTags('Calendar')
@Controller('condominiums/:condominiumSlug/calendar/events')
@UseGuards(CondominiumAccessGuard, RolesGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  @ApiOperation({ summary: 'List calendar events' })
  findAll(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Query() query: CalendarEventQuery,
  ) {
    return this.calendarService.findAll(req.condominiumId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get calendar event detail' })
  findOne(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.calendarService.findOne(req.condominiumId, id);
  }

  @Post()
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Create calendar event' })
  create(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.calendarService.create(req.condominiumId, req.user.sub, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Update calendar event' })
  update(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendarService.update(req.condominiumId, req.user.sub, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Soft delete calendar event' })
  remove(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.calendarService.remove(req.condominiumId, req.user.sub, id);
  }
}
