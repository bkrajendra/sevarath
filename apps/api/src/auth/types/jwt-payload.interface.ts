export interface JwtPayload {
  sub: string;
  role: 'USER' | 'DRIVER' | 'ADMIN' | 'OPERATOR';
}

export interface RequestUser {
  userId: string;
  role: JwtPayload['role'];
}
