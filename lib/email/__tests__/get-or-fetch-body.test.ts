jest.mock("@/lib/prisma", () => ({
  prismadb: {
    email: { findUnique: jest.fn(), update: jest.fn() },
    emailAccount: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/email-crypto", () => ({ decrypt: jest.fn(() => "plain-password") }));
jest.mock("@/inngest/lib/imap-utils", () => ({ fetchBodyByUid: jest.fn() }));

import { prismadb } from "@/lib/prisma";
import { fetchBodyByUid } from "@/inngest/lib/imap-utils";
import { getOrFetchEmailBody } from "@/lib/email/get-or-fetch-body";

const email = {
  id: "email-1",
  bodyText: null,
  bodyHtml: null,
  imapUid: 3,
  folder: "INBOX",
  emailAccountId: "account-1",
};
const account = {
  username: "mailbox@example.com",
  passwordEncrypted: "encrypted",
  imapHost: "imap.example.com",
  imapPort: 993,
  imapSsl: true,
  sentFolderName: "Sent",
};

beforeEach(() => {
  jest.clearAllMocks();
  (prismadb.email.findUnique as jest.Mock).mockResolvedValue(email);
  (prismadb.emailAccount.findUnique as jest.Mock).mockResolvedValue(account);
  (prismadb.email.update as jest.Mock).mockResolvedValue({});
});

it("returns an already stored body without opening IMAP", async () => {
  (prismadb.email.findUnique as jest.Mock).mockResolvedValue({ ...email, bodyText: "stored" });
  await expect(getOrFetchEmailBody("email-1")).resolves.toMatchObject({
    bodyText: "stored",
    status: "READY",
  });
  expect(fetchBodyByUid).not.toHaveBeenCalled();
});

it("fetches a missing body, persists it, and marks it READY", async () => {
  (fetchBodyByUid as jest.Mock).mockResolvedValue({ bodyText: "Добрый день", bodyHtml: null });
  await expect(getOrFetchEmailBody("email-1")).resolves.toEqual({
    bodyText: "Добрый день",
    bodyHtml: null,
    status: "READY",
  });
  expect(prismadb.email.update).toHaveBeenCalledWith({
    where: { id: "email-1" },
    data: expect.objectContaining({
      bodyText: "Добрый день",
      bodyFetchStatus: "READY",
      bodyFetchLastError: null,
      bodyFetchAttempts: { increment: 1 },
    }),
  });
});

it("records an explicit FAILED state when IMAP loading fails", async () => {
  (fetchBodyByUid as jest.Mock).mockRejectedValue(new Error("IMAP unavailable"));
  await expect(getOrFetchEmailBody("email-1")).rejects.toThrow("BODY_FETCH_FAILED");
  expect(prismadb.email.update).toHaveBeenCalledWith({
    where: { id: "email-1" },
    data: expect.objectContaining({
      bodyFetchStatus: "FAILED",
      bodyFetchAttempts: { increment: 1 },
      bodyFetchLastError: "IMAP unavailable",
    }),
  });
});
