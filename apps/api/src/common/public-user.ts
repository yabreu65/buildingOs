import { Prisma } from '@prisma/client';

export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export const publicUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  name: true,
});

export function toPublicUser(
  user: { id: string; email: string; name: string } | null | undefined,
): PublicUser | undefined {
  if (!user) {
    return undefined;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}
