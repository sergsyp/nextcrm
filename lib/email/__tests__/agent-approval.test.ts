import { hasFirstMessageApproval } from "../agent-approval";

describe("agent email approval", () => {
  test("requires an explicit first-message approval marker", () => {
    expect(hasFirstMessageApproval([])).toBe(false);
    expect(
      hasFirstMessageApproval([
        { comment: "APPROVED:FIRST_MESSAGE", assigned_user: { role: "manager" } },
      ])
    ).toBe(false);
    expect(
      hasFirstMessageApproval([
        { comment: "APPROVED:FIRST_MESSAGE", assigned_user: { role: "admin" } },
      ])
    ).toBe(true);
  });
});
