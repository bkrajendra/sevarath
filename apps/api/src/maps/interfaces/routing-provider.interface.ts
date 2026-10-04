export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** One instruction in the turn-by-turn sequence - maps directly to Valhalla's maneuver shape. */
export interface RouteManeuver {
  instruction: string;
  verbalPreTransitionInstruction?: string;
  verbalTransitionAlertInstruction?: string;
  verbalPostTransitionInstruction?: string;
  /** Meters */
  length: number;
  /** Seconds */
  time: number;
  /** Indices into Route.shape marking where this maneuver's geometry starts/ends. */
  beginShapeIndex: number;
  endShapeIndex: number;
}

export interface Route {
  /** Encoded polyline (Valhalla's default 1e6-precision encoding), decode client-side for rendering. */
  shape: string;
  /** Meters */
  length: number;
  /** Seconds */
  time: number;
  maneuvers: RouteManeuver[];
}

export interface GetRouteOptions {
  /** Driver's last known heading in degrees, so the route starts in the direction of travel. */
  originHeading?: number;
  /** BCP-47 locale for narrative text, e.g. "en-US". */
  language?: string;
  /** Polygons (GeoJSON rings) the route must avoid - see campus_restricted_zones, architecture.md §8.2. */
  excludePolygons?: [number, number][][];
}

/**
 * Backend-side abstraction over the routing engine - Valhalla is the only concrete
 * implementation today, but callers (dispatch, navigation) depend on this interface,
 * not on Valhalla directly. See architecture.md §8.
 */
export interface RoutingProvider {
  getRoute(origin: Coordinates, destination: Coordinates, options?: GetRouteOptions): Promise<Route>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
