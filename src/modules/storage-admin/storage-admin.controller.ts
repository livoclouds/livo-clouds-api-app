import { Controller, Delete, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtPayload } from '../../common/types';
import {
  ListAggregateQuery,
  ListObjectsQuery,
  ListUserAggregateQuery,
} from './dto/list-objects.dto';
import { StorageAdminService } from './storage-admin.service';

// RBAC Phase 2: platform storage admin. Reads require platform.storage.read
// (Developer + Supervisor); deleting an object requires platform.storage.manage
// (Developer only) — the method-level decorator overrides the class default.
@ApiTags('Storage Admin')
@RequirePermission('platform.storage.read')
@Controller('admin/storage')
export class StorageAdminController {
  constructor(private readonly service: StorageAdminService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Aggregate R2 bucket KPIs (root only)' })
  summary() {
    return this.service.getSummary();
  }

  @Get('condominiums')
  @ApiOperation({ summary: 'Aggregated storage usage by condominium (root only)' })
  byCondominium(@Query() query: ListAggregateQuery) {
    return this.service.listByCondominium(query);
  }

  @Get('users')
  @ApiOperation({ summary: 'Aggregated storage usage by uploader (root only)' })
  byUser(@Query() query: ListUserAggregateQuery) {
    return this.service.listByUser(query);
  }

  @Get('objects')
  @ApiOperation({ summary: 'List R2 objects with filters (root only)' })
  listObjects(@Query() query: ListObjectsQuery) {
    return this.service.listObjects(query);
  }

  @Get('objects/presigned-url')
  @ApiOperation({ summary: 'Generate temporary GET URL for an R2 object (root only)' })
  presignedUrl(@Query('key') key: string, @CurrentUser() user: JwtPayload) {
    return this.service.createPresignedUrl(key, user);
  }

  @Get('objects/detail')
  @ApiOperation({ summary: 'Detail + access history of an R2 object (root only)' })
  detail(@Query('key') key: string) {
    return this.service.getObjectDetail(key);
  }

  @Delete('objects')
  @RequirePermission('platform.storage.manage')
  @ApiOperation({ summary: 'Delete an R2 object (root only)' })
  remove(@Query('key') key: string, @CurrentUser() user: JwtPayload) {
    return this.service.deleteObject(key, user);
  }
}
