import { classifyAiError, pipelineContext } from "../observability";

jest.mock("@/lib/prisma", () => ({ prismadb: {} }));

describe("AI pipeline observability", () => {
  it.each([
    ["429 Too Many Requests", "AI_RATE_LIMITED", true],
    ["Request timed out", "AI_TIMEOUT", true],
    ["InternalError.Algo.DataInspectionFailed", "AI_CONTENT_FILTER", true],
    ["AGENT_TURN_LIMIT_REACHED_WITHOUT_FINAL_RESULT", "AGENT_TURN_LIMIT", false],
    ["NOT_FOUND", "KNOWLEDGE_OR_ENTITY_NOT_FOUND", false],
  ])("classifies %s", (message, code, transient) => {
    expect(classifyAiError(new Error(message))).toEqual({ code, transient });
  });

  it("extracts correlation fields without exposing arbitrary task tags", () => {
    expect(pipelineContext({ prospectingCycleId: "cycle-1", direction: "hvac", secret: "hidden" }))
      .toEqual({ cycleId: "cycle-1", direction: "hvac" });
  });
});
