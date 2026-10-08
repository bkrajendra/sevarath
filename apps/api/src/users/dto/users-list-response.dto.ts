import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

/** {items, total} - same shape as admin/dto/admin-rides-list-response.dto.ts, for the same reason. */
export class UsersListResponseDto {
  @ApiProperty({ type: [UserResponseDto] }) items!: UserResponseDto[];
  @ApiProperty() total!: number;
}
