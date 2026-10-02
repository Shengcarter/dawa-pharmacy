/** Who is performing an operation. Services receive this instead of an HTTP request. */
export interface Actor {
  userId: number;
  userName: string;
  branchId: number;
  permissions: ReadonlySet<string>;
  ip?: string | null;
  userAgent?: string | null;
  /** Internal-only: lets seed scripts back-date documents. Never set from HTTP input. */
  occurredAt?: Date;
}

export const can = (actor: Actor, permission: string) => actor.permissions.has(permission);
export const occurredAt = (actor: Actor) => actor.occurredAt ?? new Date();
