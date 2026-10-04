import { Module } from '@nestjs/common';
import { MapsController } from './maps.controller';
import { ROUTING_PROVIDER } from './interfaces/routing-provider.interface';
import { ValhallaRoutingProvider } from './providers/valhalla-routing.provider';

@Module({
  controllers: [MapsController],
  providers: [{ provide: ROUTING_PROVIDER, useClass: ValhallaRoutingProvider }],
  exports: [ROUTING_PROVIDER],
})
export class MapsModule {}
