import { searchPublicWeb } from "../tools/crm-web-search";

describe("public web search", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns an empty result set without blocking the agent", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("<html><body>No results</body></html>", { status: 200 }));
    await expect(searchPublicWeb("valid b2b query", 5)).resolves.toEqual([]);
  });
});
