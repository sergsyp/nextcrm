jest.mock("@/lib/email/send-message", () => ({ sendEmailForUser: jest.fn() }));
jest.mock("@/lib/email/account-access", () => ({
  emailAccountAccessWhere: jest.fn(() => ({ __emailScope: true })),
}));
jest.mock("@/lib/authz/scopes/crm", () => ({
  targetReadScopeWhere: jest.fn(() => ({ deletedAt: null })),
}));
jest.mock("@/lib/email/get-or-fetch-body", () => ({ getOrFetchEmailBody: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prismadb: {
    tasks: { findFirst: jest.fn() },
    crm_Targets: { findFirst: jest.fn() },
    email: { findFirst: jest.fn() },
    emailAccount: { findMany: jest.fn(), count: jest.fn() },
  },
}));

import { prismadb } from "@/lib/prisma";
import { sendEmailForUser } from "@/lib/email/send-message";
import { crmEmailAccountTools } from "@/lib/mcp/tools/crm-email-accounts";
import { getOrFetchEmailBody } from "@/lib/email/get-or-fetch-body";

const MANAGER = { id: "m1", role: "manager" } as const;
const approved = {
  comments: [{ comment: "APPROVED:FIRST_MESSAGE", assigned_user: { role: "admin" } }],
};

function send(args: Record<string, unknown>) {
  const tool = crmEmailAccountTools.find((candidate) => candidate.name === "crm_send_individual_email")!;
  return (tool.handler as any)(
    {
      accountId: "a1",
      to: ["lead@example.com"],
      subject: "Subject",
      body: "Body",
      approvalTaskId: "task1",
      targetId: "target1",
      ...args,
    },
    MANAGER.id,
    MANAGER
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (prismadb.tasks.findFirst as jest.Mock).mockResolvedValue(approved);
  (prismadb.crm_Targets.findFirst as jest.Mock).mockResolvedValue({
    id: "target1",
    email: "lead@example.com",
  });
  (prismadb.email.findFirst as jest.Mock).mockResolvedValue(null);
  (sendEmailForUser as jest.Mock).mockResolvedValue({ id: "email1" });
});

it("rejects a recipient that differs from the target card", async () => {
  await expect(send({ to: ["wrong@example.com"] })).rejects.toThrow("TARGET_EMAIL_MISMATCH");
  expect(sendEmailForUser).not.toHaveBeenCalled();
});

it("returns the existing email for the same approval task and target", async () => {
  (prismadb.email.findFirst as jest.Mock).mockResolvedValue({ id: "already-sent" });
  await expect(send({})).resolves.toEqual({
    data: { id: "already-sent" },
    deduplicated: true,
  });
  expect(sendEmailForUser).not.toHaveBeenCalled();
});

it("persists task and target idempotency metadata on a new send", async () => {
  await send({});
  expect(sendEmailForUser).toHaveBeenCalledWith(
    MANAGER.id,
    expect.objectContaining({ approvalTaskId: "task1", targetId: "target1" })
  );
});

it("crm_get_email fetches and returns a missing IMAP body", async () => {
  const stored = { id: "email-1", bodyText: null, bodyHtml: null, imapUid: 3 };
  (prismadb.email.findFirst as jest.Mock).mockResolvedValue(stored);
  (getOrFetchEmailBody as jest.Mock).mockResolvedValue({
    bodyText: "Recovered",
    bodyHtml: null,
    status: "READY",
  });
  const tool = crmEmailAccountTools.find((candidate) => candidate.name === "crm_get_email")!;
  await expect((tool.handler as any)({ id: "email-1" }, MANAGER.id, MANAGER)).resolves.toEqual({
    data: expect.objectContaining({ bodyText: "Recovered", bodyFetchStatus: "READY" }),
  });
});
