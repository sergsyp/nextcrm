import { emailAccountAccessWhere } from "../account-access";

describe("emailAccountAccessWhere", () => {
  it("allows the owner or an explicitly delegated user", () => {
    expect(emailAccountAccessWhere("agent-1")).toEqual({
      OR: [
        { userId: "agent-1" },
        { delegates: { some: { userId: "agent-1" } } },
      ],
    });
  });
});
