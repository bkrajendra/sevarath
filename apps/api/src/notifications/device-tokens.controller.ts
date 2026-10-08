import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import { DeviceTokensService } from './device-tokens.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { UnregisterDeviceTokenDto } from './dto/unregister-device-token.dto';
import { DeviceTokenResponseDto } from './dto/device-token-response.dto';
import type { DeviceToken } from '../db/schema';

/**
 * Device-token registration for push delivery (Phase 7). Any authenticated role may register -
 * both riders and drivers receive pushes (see `notifications/push-recipients.ts`).
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications/device-tokens', version: '1' })
@UseGuards(JwtAuthGuard)
export class DeviceTokensController {
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  @Post()
  @ApiOkResponse({ type: DeviceTokenResponseDto })
  async register(
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    const row = await this.deviceTokensService.register(currentUser.userId, dto.token, dto.platform);
    return toDeviceTokenResponse(row);
  }

  /**
   * Unregisters the calling user's own device token (e.g. on logout), so a device that's been
   * logged out of stops receiving pushes for that account. Nice-to-have per the task brief -
   * included since it was straightforward given `DeviceTokensService#unregister` already
   * existing for the reassignment-safety reasoning above.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async unregister(
    @CurrentUser() currentUser: RequestUser,
    @Body() dto: UnregisterDeviceTokenDto,
  ): Promise<void> {
    await this.deviceTokensService.unregister(currentUser.userId, dto.token);
  }
}

/**
 * `device_tokens.token` is the literal FCM registration token - never return it (see
 * docs/open-items.md and `DeviceTokenResponseDto`'s own doc comment). The caller already knows
 * it (they just sent it in the request body); nothing in this codebase's actual usage needs it
 * echoed back, so it's stripped here the same way `users.controller.ts#toUserResponse` strips
 * `passwordHash`/`firebaseUid`.
 */
function toDeviceTokenResponse(row: DeviceToken): DeviceTokenResponseDto {
  return {
    id: row.id,
    userId: row.userId,
    platform: row.platform,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
