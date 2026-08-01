export const FIRST_MESSAGE_APPROVAL = "APPROVED:FIRST_MESSAGE";
export const LANDING_PUBLISH_APPROVAL = "APPROVED:LANDING_PUBLISH";

export function hasFirstMessageApproval(
  comments: Array<{ comment: string; assigned_user?: { role?: string } | null }>
): boolean {
  return hasAdminApproval(comments, FIRST_MESSAGE_APPROVAL);
}

export function hasAdminApproval(
  comments: Array<{ comment: string; assigned_user?: { role?: string } | null }>,
  marker: string
): boolean {
  return comments.some(
    (item) =>
      item.comment.trim() === marker &&
      item.assigned_user?.role === "admin"
  );
}
