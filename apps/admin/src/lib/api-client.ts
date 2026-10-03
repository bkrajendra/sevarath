import createClient from 'openapi-fetch';
import type { paths } from '@/types/api';

// The generated `paths` keys already carry the full `/api/v1/...` prefix (that's the
// real route NestJS serves - see apps/api/src/main.ts's setGlobalPrefix/enableVersioning).
// baseUrl must therefore be empty for a same-origin deployment (the default here) -
// setting it to '/api/v1' double-prefixes every request. Only set VITE_API_BASE_URL
// if the Admin app and API are ever split across different origins, and then set it
// to that origin with NO /api/v1 suffix (e.g. "https://api.example.com").
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const api = createClient<paths>({ baseUrl: BASE_URL });

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

api.use({
  onRequest({ request }) {
    if (accessToken) {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
    }
    return request;
  },
});
