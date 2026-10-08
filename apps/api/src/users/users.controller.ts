import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestUser } from '../auth/types/jwt-payload.interface';
import { UsersService } from './users.service';
import { UserResponseDto } from './dto/user-response.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UsersListResponseDto } from './dto/users-list-response.dto';
import type { User } from '../db/schema';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentUser() currentUser: RequestUser): Promise<UserResponseDto> {
    const user = await this.usersService.findById(currentUser.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toUserResponse(user);
  }

  /**
   * ADMIN-only account search/listing - this resource's own collection endpoint (plan.md Phase
   * 8), not an /admin-prefixed route - see admin.controller.ts's doc comment and
   * docs/open-items.md. Deliberately ADMIN-only, not OPERATOR, per specification.md §2's role
   * description (user account management is an admin, not dispatch-oversight, concern) -
   * unlike admin.controller.ts's dashboard/rides endpoints, which OPERATOR can also see.
   */
  @Get()
  @Roles('ADMIN')
  @ApiOkResponse({ type: UsersListResponseDto })
  async findAll(
    @Query() query: ListUsersQueryDto,
  ): Promise<{ items: UserResponseDto[]; total: number }> {
    const { items, total } = await this.usersService.search(query);
    return { items: items.map(toUserResponse), total };
  }
}

/**
 * `users` rows carry `passwordHash` (and `firebaseUid`) - fields that must never reach a
 * client. Neither endpoint above had been mapping through `UserResponseDto` at all (it was
 * declared only for Swagger's `@ApiOkResponse` metadata, never actually applied at runtime -
 * this codebase has no global `ClassSerializerInterceptor`), so both were returning the raw DB
 * row/array verbatim. `GET /users/me` has leaked the caller's own hash since Phase 1; `GET
 * /users` (Phase 8) made it worse by leaking *every* user's hash to any ADMIN caller. Fixed by
 * explicitly mapping to the safe field set here, at the controller boundary, rather than
 * instrumenting a serializer - other controllers in this codebase (drivers/vehicles) return raw
 * entities too, but none of their entities carry a secret field, so this mapper is this
 * resource's own responsibility, not a precedent to generalize unless another entity gains a
 * sensitive column.
 */
function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
