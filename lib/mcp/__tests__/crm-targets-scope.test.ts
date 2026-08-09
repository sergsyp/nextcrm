jest.mock("@/lib/authz", () => ({
  AuthorizationError: jest.requireActual("@/lib/authz/errors").AuthorizationError,
}));
jest.mock("@/lib/authz/scopes/crm", () => ({
  targetReadScopeWhere: jest.fn((user) =>
    user.role === "manager" || user.role === "admin"
      ? { deletedAt: null }
      : { deletedAt: null, created_by: user.id }
  ),
  assertCanWriteTarget: jest.fn(),
}));
jest.mock("@/lib/prisma", () => ({
  prismadb: {
    crm_Targets: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { AuthorizationError } from "@/lib/authz/errors";
import type { AuthzUser } from "@/lib/authz/session";
import { assertCanWriteTarget } from "@/lib/authz/scopes/crm";
import { prismadb } from "@/lib/prisma";
import { crmTargetTools } from "@/lib/mcp/tools/crm-targets";

const MEMBER = { id: "u1", role: "user" } as const;
const MANAGER = { id: "m1", role: "manager" } as const;

function call(name: string, args: any, user: AuthzUser = MEMBER) {
  const tool = crmTargetTools.find((candidate) => candidate.name === name)!;
  return (tool.handler as any)(args, user.id, user);
}

beforeEach(() => {
  jest.clearAllMocks();
  (prismadb.crm_Targets.findMany as jest.Mock).mockResolvedValue([]);
  (prismadb.crm_Targets.count as jest.Mock).mockResolvedValue(0);
});

it("limits regular users to targets they created", async () => {
  await call("crm_list_targets", { limit: 20, offset: 0 });
  expect((prismadb.crm_Targets.findMany as jest.Mock).mock.calls[0][0].where)
    .toEqual({ deletedAt: null, created_by: "u1" });
});

it("lets managers list all active targets", async () => {
  await call("crm_list_targets", { limit: 20, offset: 0 }, MANAGER);
  expect((prismadb.crm_Targets.findMany as jest.Mock).mock.calls[0][0].where)
    .toEqual({ deletedAt: null });
});

it("intersects search terms with the caller scope", async () => {
  await call("crm_search_targets", { query: "metal", limit: 20, offset: 0 });
  const where = (prismadb.crm_Targets.findMany as jest.Mock).mock.calls[0][0].where;
  expect(where).toMatchObject({ deletedAt: null, created_by: "u1" });
  expect(where.AND[0].OR).toHaveLength(4);
});

it("lets managers get an active target regardless of creator", async () => {
  (prismadb.crm_Targets.findFirst as jest.Mock).mockResolvedValue({ id: "t1" });
  await call("crm_get_target", { id: "t1" }, MANAGER);
  expect((prismadb.crm_Targets.findFirst as jest.Mock).mock.calls[0][0].where)
    .toEqual({ id: "t1", deletedAt: null });
});

it("denies an out-of-scope update without mutating the target", async () => {
  (prismadb.crm_Targets.findFirst as jest.Mock).mockResolvedValue({ id: "t1" });
  (assertCanWriteTarget as jest.Mock).mockRejectedValue(new AuthorizationError());
  await expect(call("crm_update_target", { id: "t1", company: "x" }))
    .rejects.toThrow("NOT_FOUND");
  expect(prismadb.crm_Targets.update).not.toHaveBeenCalled();
});
