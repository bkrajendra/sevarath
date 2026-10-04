import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROUTING_PROVIDER, type RoutingProvider, type Route } from './interfaces/routing-provider.interface';
import { GetRouteQueryDto } from './dto/get-route-query.dto';
import { RouteResponseDto } from './dto/route-response.dto';

@ApiTags('maps')
@ApiBearerAuth()
@Controller({ path: 'maps', version: '1' })
@UseGuards(JwtAuthGuard)
export class MapsController {
  constructor(@Inject(ROUTING_PROVIDER) private readonly routingProvider: RoutingProvider) {}

  @Get('route')
  @ApiOkResponse({ type: RouteResponseDto })
  getRoute(@Query() query: GetRouteQueryDto): Promise<Route> {
    return this.routingProvider.getRoute(
      { latitude: query.originLat, longitude: query.originLng },
      { latitude: query.destinationLat, longitude: query.destinationLng },
    );
  }
}
