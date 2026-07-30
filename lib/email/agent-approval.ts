export const FIRST_MESSAGE_APPROVAL = "APPROVED:FIRST_MESSAGE";

export function hasFirstMessageApproval(
  comments: Array<{ comment: string; assigned_user?: { role?: string } | null }>
): boolean {
  return comments.some(
    (item) =>
      item.comment.trim() === FIRST_MESSAGE_APPROVAL &&
      item.assigned_user?.role === "admin"
  );
}
