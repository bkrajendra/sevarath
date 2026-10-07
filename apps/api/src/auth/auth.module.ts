import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseAdminProvider, FIREBASE_ADMIN } from './firebase/firebase-admin.provider';
import { FirebaseStrategy } from './strategies/firebase.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_TTL') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, FirebaseAdminProvider, FirebaseStrategy, JwtStrategy, RolesGuard],
  // JwtModule is exported so other modules that need to verify JWTs outside of Passport's
  // HTTP-only AuthGuard flow (e.g. LocationsModule's WebSocket handshake auth) can inject
  // JwtService directly, without duplicating the secret/TTL config from ConfigService.
  // FIREBASE_ADMIN is exported (Phase 7) so NotificationsModule's push consumer can reuse the
  // same initialized `admin.app.App` (via `admin.messaging()`) that auth already sets up,
  // instead of initializing a second Firebase app or adding a new SDK.
  exports: [AuthService, RolesGuard, JwtModule, FIREBASE_ADMIN],
})
export class AuthModule {}
