import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RouteManeuverResponseDto {
  @ApiProperty() instruction!: string;
  @ApiPropertyOptional() verbalPreTransitionInstruction?: string;
  @ApiPropertyOptional() verbalTransitionAlertInstruction?: string;
  @ApiPropertyOptional() verbalPostTransitionInstruction?: string;
  @ApiProperty() length!: number;
  @ApiProperty() time!: number;
  @ApiProperty() beginShapeIndex!: number;
  @ApiProperty() endShapeIndex!: number;
}

export class RouteResponseDto {
  @ApiProperty({ description: 'Encoded polyline, 1e6 precision (Valhalla default)' })
  shape!: string;
  @ApiProperty({ description: 'Kilometers' }) length!: number;
  @ApiProperty({ description: 'Seconds' }) time!: number;
  @ApiProperty({ type: [RouteManeuverResponseDto] }) maneuvers!: RouteManeuverResponseDto[];
}
