import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { authenticateSocket } from './ws-jwt.guard';

const SECRET = 'ws-jwt-guard-test-secret';

function socketWithToken(token: unknown): Socket {
  return {
    handshake: { auth: { token } },
  } as unknown as Socket;
}

describe('authenticateSocket', () => {
  const jwtService = new JwtService({ secret: SECRET });

  it('returns a RequestUser for a valid token', async () => {
    const token = jwtService.sign({ sub: 'user-1', role: 'DRIVER' });

    const result = await authenticateSocket(socketWithToken(token), jwtService);

    expect(result).toEqual({ userId: 'user-1', role: 'DRIVER' });
  });

  it('rejects a missing token', async () => {
    const result = await authenticateSocket(socketWithToken(undefined), jwtService);
    expect(result).toBeNull();
  });

  it('rejects an empty-string token', async () => {
    const result = await authenticateSocket(socketWithToken(''), jwtService);
    expect(result).toBeNull();
  });

  it('rejects a malformed token', async () => {
    const result = await authenticateSocket(socketWithToken('not-a-jwt'), jwtService);
    expect(result).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const otherService = new JwtService({ secret: 'a-different-secret' });
    const token = otherService.sign({ sub: 'user-1', role: 'USER' });

    const result = await authenticateSocket(socketWithToken(token), jwtService);

    expect(result).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = jwtService.sign({ sub: 'user-1', role: 'USER' }, { expiresIn: '-10s' });

    const result = await authenticateSocket(socketWithToken(token), jwtService);

    expect(result).toBeNull();
  });
});
