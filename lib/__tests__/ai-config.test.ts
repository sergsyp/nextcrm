import { readFileSync } from "node:fs";
import { resolveOpenAIApiKey } from "@/lib/ai-config";

jest.mock("node:fs", () => ({ readFileSync: jest.fn() }));

const mockedReadFileSync = jest.mocked(readFileSync);

describe("resolveOpenAIApiKey", () => {
  const oldEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...oldEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY_FILE;
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  it("prefers an explicitly supplied key", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveOpenAIApiKey("explicit-key")).toBe("explicit-key");
  });

  it("reads and trims a Docker secret file", () => {
    process.env.OPENAI_API_KEY_FILE = "/run/secrets/provod_api_key";
    mockedReadFileSync.mockReturnValue("file-key\n");
    expect(resolveOpenAIApiKey()).toBe("file-key");
    expect(mockedReadFileSync).toHaveBeenCalledWith(
      "/run/secrets/provod_api_key",
      "utf8"
    );
  });

  it("falls back to OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveOpenAIApiKey()).toBe("env-key");
  });
});
