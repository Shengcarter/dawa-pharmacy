import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface AccessClaims {
  sub: string;
  sid: number;
}

export function signAccessToken(userId: number, sessionId: number): string {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    subject: String(userId),
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
    algorithm: 'HS256',
    issuer: 'dawa',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'dawa' }) as unknown as AccessClaims;
}
