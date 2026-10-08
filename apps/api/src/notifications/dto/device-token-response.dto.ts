import { ApiProperty } from '@nestjs/swagger';

/**
 * Deliberately does NOT declare a `token` field, even though the `device_tokens` row itself has
 * one (the literal FCM registration token) - see docs/open-items.md (this task's leak-audit
 * pass, same bug class as `UserResponseDto`/`toUserResponse` in `users.controller.ts`, #45).
 * The caller already has this exact value (it's the one they just POSTed to register it), so
 * echoing it back serves no real client need and is needless exposure in the response
 * body/network logs. `device-tokens.controller.ts#toDeviceTokenResponse` is what actually
 * enforces this at runtime - this class alone is Swagger documentation only.
 */
export class DeviceTokenResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: ['ANDROID', 'IOS'] })
  platform!: 'ANDROID' | 'IOS';
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
