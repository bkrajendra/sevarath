import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Coordinates,
  GetRouteOptions,
  Route,
  RoutingProvider,
} from '../interfaces/routing-provider.interface';
import type { ValhallaRouteResponse } from './valhalla.types';

@Injectable()
export class ValhallaRoutingProvider implements RoutingProvider {
  private readonly logger = new Logger(ValhallaRoutingProvider.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('VALHALLA_URL') ?? 'http://sevarath-valhalla:8002';
  }

  async getRoute(
    origin: Coordinates,
    destination: Coordinates,
    options?: GetRouteOptions,
  ): Promise<Route> {
    const body = {
      locations: [
        { lat: origin.latitude, lon: origin.longitude, type: 'break', heading: options?.originHeading },
        { lat: destination.latitude, lon: destination.longitude, type: 'break' },
      ],
      costing: 'auto',
      units: 'kilometers',
      language: options?.language ?? 'en-US',
      // 'instructions' (Valhalla's default) includes narrative text; 'maneuvers'
      // - despite the name - returns maneuver data WITHOUT instruction strings.
      // Caught via a live test: every instruction came back empty with 'maneuvers'.
      directions_type: 'instructions',
      ...(options?.excludePolygons ? { exclude_polygons: options.excludePolygons } : {}),
    };

    let response: globalThis.Response;
    try {
      response = await fetch(`${this.baseUrl}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(`Valhalla request failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Routing service is unavailable');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Valhalla returned ${response.status}: ${text}`);
      throw new ServiceUnavailableException('Routing service rejected the request');
    }

    const data = (await response.json()) as ValhallaRouteResponse;
    const leg = data.trip.legs[0];

    return {
      shape: leg.shape,
      length: data.trip.summary.length,
      time: data.trip.summary.time,
      maneuvers: leg.maneuvers.map((m) => ({
        instruction: m.instruction,
        verbalPreTransitionInstruction: m.verbal_pre_transition_instruction,
        verbalTransitionAlertInstruction: m.verbal_transition_alert_instruction,
        verbalPostTransitionInstruction: m.verbal_post_transition_instruction,
        length: m.length,
        time: m.time,
        beginShapeIndex: m.begin_shape_index,
        endShapeIndex: m.end_shape_index,
      })),
    };
  }
}
