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
  async me(@CurrentUser() currentUser: RequestUser): Promise<User> {
    const user = await this.usersService.findById(currentUser.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
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
  findAll(@Query() query: ListUsersQueryDto): Promise<{ items: User[]; total: number }> {
    return this.usersService.search(query);
  }
}
