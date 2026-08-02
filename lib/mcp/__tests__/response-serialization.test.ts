jest.mock("@/lib/prisma", () => ({ prismadb: {} }));

import { itemResponse, jsonSafe, listResponse } from "../helpers";

describe("MCP response serialization", () => {
  it("converts safe bigint positions to numbers in nested project data", () => {
    const response = itemResponse({
      id: "board-1",
      sections: [{ id: "section-1", position: 1000n, tasks: [{ position: 2000n }] }],
    });

    expect(response).toEqual({
      data: {
        id: "board-1",
        sections: [{ id: "section-1", position: 1000, tasks: [{ position: 2000 }] }],
      },
    });
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it("uses a string when a bigint is outside JSON's safe integer range", () => {
    expect(jsonSafe(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe("9007199254740992");
  });

  it("serializes bigint values returned by list tools", () => {
    const response = listResponse([{ id: "task-1", position: 3000n }], 1, 0);

    expect(response).toEqual({ data: [{ id: "task-1", position: 3000 }], total: 1, offset: 0 });
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it("preserves Date values for the transport serializer", () => {
    const date = new Date("2026-08-02T12:00:00.000Z");
    expect(jsonSafe({ date })).toEqual({ date });
  });
});
