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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarEventsDto } from './dto/list-calendar-events.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

@ApiTags('Calendar')
@Controller('condominiums/:condominiumSlug/calendar/events')
@UseGuards(CondominiumAccessGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  @ApiOperation({ summary: 'List calendar events' })
  findAll(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Query() query: ListCalendarEventsDto,
  ) {
    return this.calendarService.findAll(req.condominiumId, query, req.user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get calendar event detail' })
  findOne(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.calendarService.findOne(req.condominiumId, id, req.user.role);
  }

  @Post()
  @RequirePermission('calendar.manage')
  @ApiOperation({ summary: 'Create calendar event' })
  create(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.calendarService.create(req.condominiumId, req.user.sub, dto);
  }

  @Patch(':id')
  @RequirePermission('calendar.manage')
  @ApiOperation({ summary: 'Update calendar event' })
  update(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendarService.update(req.condominiumId, req.user.sub, id, dto);
  }

  @Delete(':id')
  @RequirePermission('calendar.manage')
  @ApiOperation({ summary: 'Soft delete calendar event' })
  remove(
    @Request() req: { condominiumId: string; user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.calendarService.remove(req.condominiumId, req.user.sub, id);
  }
}
