import {
  eligibleSectionsForAgent,
  isRunnableAiTask,
  selectAllowedTools,
  toSerializable,
} from "../executor-utils";

describe("AI team executor", () => {
  test("maps each role to the sections it may process", () => {
    expect(eligibleSectionsForAgent("researcher")).toEqual([
      "Входящие идеи",
      "Исследование",
    ]);
    expect(eligibleSectionsForAgent("sales")).toEqual([
      "Подготовка предложения",
      "Готово к тесту",
      "Тест продаж",
    ]);
    expect(eligibleSectionsForAgent("controller")).toEqual(["Проверка"]);
  });

  test("exposes only explicitly allowed tools", () => {
    const tools = [
      { name: "safe", handler: jest.fn() },
      { name: "dangerous", handler: jest.fn() },
    ] as any;

    expect(selectAllowedTools(tools, ["safe"]).map((tool) => tool.name)).toEqual([
      "safe",
    ]);
  });

  test("fails closed when a configured tool is missing", () => {
    expect(() => selectAllowedTools([] as any, ["missing"])).toThrow(
      "Unknown AI agent tools: missing"
    );
  });

  test("serializes bigint and dates for model tool results", () => {
    expect(
      toSerializable({ position: BigInt(1000), at: new Date("2026-07-30T10:00:00Z") })
    ).toEqual({ position: "1000", at: "2026-07-30T10:00:00.000Z" });
  });

  test("does not rerun completed or recently running tasks", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    expect(isRunnableAiTask({ aiRunStatus: "completed" }, now)).toBe(false);
    expect(
      isRunnableAiTask(
        { aiRunStatus: "running", aiRunStartedAt: "2026-07-30T11:30:00Z" },
        now
      )
    ).toBe(false);
    expect(
      isRunnableAiTask(
        { aiRunStatus: "running", aiRunStartedAt: "2026-07-30T10:00:00Z" },
        now
      )
    ).toBe(true);
  });
});
