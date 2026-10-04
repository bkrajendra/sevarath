import { Module } from '@nestjs/common';
import { CampusLocationsController } from './campus-locations.controller';
import { CampusLocationsService } from './campus-locations.service';
import { CampusRoadsController } from './campus-roads.controller';
import { CampusRoadsService } from './campus-roads.service';
import { CampusRestrictedZonesController } from './campus-restricted-zones.controller';
import { CampusRestrictedZonesService } from './campus-restricted-zones.service';

@Module({
  controllers: [CampusLocationsController, CampusRoadsController, CampusRestrictedZonesController],
  providers: [CampusLocationsService, CampusRoadsService, CampusRestrictedZonesService],
  exports: [CampusLocationsService, CampusRoadsService, CampusRestrictedZonesService],
})
export class CampusModule {}
