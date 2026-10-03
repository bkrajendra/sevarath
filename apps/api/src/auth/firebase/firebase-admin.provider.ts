import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export const FIREBASE_ADMIN = Symbol('FIREBASE_ADMIN');

const logger = new Logger('FirebaseAdmin');

/**
 * Returns `null` when Firebase credentials aren't configured, instead of throwing at
 * app bootstrap - so the rest of the API (health, DB, future modules) stays usable
 * before Firebase is set up. FirebaseStrategy surfaces a clear error if login is
 * actually attempted against a null app.
 */
export const FirebaseAdminProvider: Provider = {
  provide: FIREBASE_ADMIN,
  inject: [ConfigService],
  useFactory: (config: ConfigService): admin.app.App | null => {
    if (admin.apps.length > 0) {
      return admin.apps[0] as admin.app.App;
    }

    const projectId = config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = config.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      logger.warn(
        'FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY are not set - ' +
          'Firebase auth is disabled until configured (see apps/api/.env.example).',
      );
      return null;
    }

    return admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  },
};
