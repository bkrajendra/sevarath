import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() mobile!: string;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ enum: ['USER', 'DRIVER', 'ADMIN', 'OPERATOR'] })
  role!: 'USER' | 'DRIVER' | 'ADMIN' | 'OPERATOR';
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'PENDING'] })
  status!: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
