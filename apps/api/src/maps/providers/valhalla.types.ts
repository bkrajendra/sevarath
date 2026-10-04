/** Only the fields this backend actually consumes - see https://valhalla.github.io/valhalla/api/route/overview/ */
export interface ValhallaRouteResponse {
  trip: {
    legs: {
      shape: string;
      summary: { length: number; time: number };
      maneuvers: {
        instruction: string;
        verbal_pre_transition_instruction?: string;
        verbal_transition_alert_instruction?: string;
        verbal_post_transition_instruction?: string;
        length: number;
        time: number;
        begin_shape_index: number;
        end_shape_index: number;
      }[];
    }[];
    summary: { length: number; time: number };
  };
}
