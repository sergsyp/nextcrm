export function emailAccountAccessWhere(userId: string) {
  return {
    OR: [
      { userId },
      { delegates: { some: { userId } } },
    ],
  } as const;
}
