import type { Actor } from './lib/actor';

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      sessionId?: number;
    }
  }
}
export {};
