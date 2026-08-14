jest.mock("@/inngest/client", () => ({
  inngest: { send: jest.fn() },
}));

jest.mock("@/lib/prisma", () => ({
  prismadb: {
    ai_ApprovalRequest: { update: jest.fn() },
  },
}));

jest.mock("@/lib/ai-team/observability", () => ({
  logPipelineEvent: jest.fn(),
}));

import { inngest } from "@/inngest/client";
import { prismadb } from "@/lib/prisma";
import { dispatchApprovalResume } from "../approval-service";

const send = inngest.send as jest.MockedFunction<typeof inngest.send>;
const update = prismadb.ai_ApprovalRequest.update as jest.Mock;

describe("dispatchApprovalResume", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({ ids: ["event-1"] });
    update.mockResolvedValue({});
  });

  it("retries resume delivery when a decision exists without a dispatch marker", async () => {
    await expect(dispatchApprovalResume({
      id: "5292d2cb-56f6-4f9f-a716-ae65ef745d2f",
      taskId: "57303c4a-0009-4ee1-ba23-0e2b4ac66b9f",
      resumeDispatchedAt: null,
    })).resolves.toEqual({ dispatched: true });

    expect(send).toHaveBeenCalledWith({
      name: "ai-team/task.run",
      data: { agent: "sales", taskId: "57303c4a-0009-4ee1-ba23-0e2b4ac66b9f" },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "5292d2cb-56f6-4f9f-a716-ae65ef745d2f" },
      data: { resumeDispatchedAt: expect.any(Date) },
    }));
  });

  it("does not dispatch a second event after the marker is stored", async () => {
    await expect(dispatchApprovalResume({
      id: "5292d2cb-56f6-4f9f-a716-ae65ef745d2f",
      taskId: "57303c4a-0009-4ee1-ba23-0e2b4ac66b9f",
      resumeDispatchedAt: new Date(),
    })).resolves.toEqual({ dispatched: false });

    expect(send).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
