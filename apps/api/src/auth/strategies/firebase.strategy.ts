import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import type { Request } from 'express';
import * as admin from 'firebase-admin';
import { FIREBASE_ADMIN } from '../firebase/firebase-admin.provider';

@Injectable()
export class FirebaseStrategy extends PassportStrategy(Strategy, 'firebase') {
  constructor(@Inject(FIREBASE_ADMIN) private readonly firebaseApp: admin.app.App | null) {
    super();
  }

  async validate(req: Request): Promise<admin.auth.DecodedIdToken> {
    if (!this.firebaseApp) {
      throw new ServiceUnavailableException(
        'Firebase auth is not configured on this server yet',
      );
    }

    const idToken = req.body?.idToken as string | undefined;
    if (!idToken) {
      throw new UnauthorizedException('idToken is required');
    }

    try {
      return await admin.auth(this.firebaseApp).verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase ID token');
    }
  }
}
