import { ApiProperty } from '@nestjs/swagger';
import { DriverResponseDto } from './driver-response.dto';

/**
 * The one and only time the plaintext temporary password is ever available anywhere - it is
 * never stored (only its bcrypt hash is), never logged, and this response is never re-fetchable.
 * The admin console must show/copy it immediately, since there's no guaranteed delivery channel
 * yet (SMS isn't wired up - docs/open-items.md) and email delivery (emailSent) is best-effort.
 */
export class ProvisionDriverResponseDto {
  @ApiProperty({ type: DriverResponseDto }) driver!: DriverResponseDto;
  @ApiProperty() temporaryPassword!: string;
  @ApiProperty({ description: 'Whether the credentials email was actually sent (false if no email was given, or RESEND_API_KEY is unconfigured, or the send failed)' })
  emailSent!: boolean;
}
