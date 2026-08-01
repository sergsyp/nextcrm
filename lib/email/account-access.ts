import type { Prisma } from "@prisma/client";

export function emailAccountAccessWhere(
  userId: string
): Prisma.EmailAccountWhereInput {
  return {
    OR: [
      { userId },
      { delegates: { some: { userId } } },
    ],
  };
}
