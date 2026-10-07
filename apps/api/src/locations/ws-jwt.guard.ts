import { Logger } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { JwtPayload, RequestUser } from '../auth/types/jwt-payload.interface';

const logger = new Logger('WsJwtAuth');

/**
 * Verifies the JWT a Socket.IO client sends via `handshake.auth.token` (the standard
 * `io(url, { auth: { token } })` client convention) and returns the same `RequestUser` shape
 * `JwtStrategy` produces for HTTP requests (`{sub, role}` -> `{userId, role}`), so downstream
 * code never has to care whether a user arrived over HTTP or a socket.
 *
 * This is deliberately a plain async function, not a Nest `CanActivate` guard: `@UseGuards()`
 * on a gateway's *message handlers* only runs once a connection already exists, it does not
 * protect `handleConnection` itself - and the handshake is exactly where this check has to
 * happen (see `LocationGateway#handleConnection`, which disconnects the socket immediately on
 * a null result). A full guard class would add indirection with no benefit here.
 *
 * Returns `null` (never throws) for every failure mode - missing token, malformed token, bad
 * signature, expired token - so callers can handle them uniformly. Never logs the token value.
 */
export async function authenticateSocket(
  client: Socket,
  jwtService: JwtService,
): Promise<RequestUser | null> {
  const token = client.handshake.auth?.token;
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  try {
    const payload = await jwtService.verifyAsync<JwtPayload>(token);
    return { userId: payload.sub, role: payload.role };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`WebSocket JWT verification failed: ${message}`);
    return null;
  }
}
