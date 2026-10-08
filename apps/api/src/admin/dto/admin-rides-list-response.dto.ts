import { ApiProperty } from '@nestjs/swagger';
import { RideResponseDto } from '../../rides/dto/ride-response.dto';

/**
 * {items, total} rather than rides.controller.ts's bare-array `GET /rides/history` shape - a
 * documented judgment call (see docs/open-items.md): this endpoint is a paginated/filterable
 * admin search, not "give me everything I own", so the Admin frontend needs a total count to
 * render "page X of Y"/"N results" without a second request.
 */
export class AdminRidesListResponseDto {
  @ApiProperty({ type: [RideResponseDto] }) items!: RideResponseDto[];
  @ApiProperty() total!: number;
}
