import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import type { AuthzUser } from "@/lib/authz";
import {
  assertCanWriteTarget,
  targetReadScopeWhere,
} from "@/lib/authz/scopes/crm";
import {
  paginationSchema,
  paginationArgs,
  listResponse,
  itemResponse,
  ilike,
  notFound,
  softDeleteData,
  assertScopeOrNotFound,
} from "../helpers";

async function assertWritableTarget(user: AuthzUser, targetId: string) {
  const row = await prismadb.crm_Targets.findFirst({
    where: { id: targetId, deletedAt: null },
    select: { id: true },
  });
  if (!row) notFound("Target");
  await assertScopeOrNotFound(() => assertCanWriteTarget(user, targetId), "Target");
}

export const crmTargetTools = [
  {
    name: "crm_list_targets",
    description: "List CRM targets visible to the authenticated user",
    schema: z.object({ ...paginationSchema }),
    async handler(
      args: { limit: number; offset: number },
      _userId: string,
      user: AuthzUser
    ) {
      const where = targetReadScopeWhere(user);
      const [data, total] = await Promise.all([
        prismadb.crm_Targets.findMany({
          where,
          ...paginationArgs(args),
          orderBy: { created_on: "desc" },
        }),
        prismadb.crm_Targets.count({ where }),
      ]);
      return listResponse(data, total, args.offset);
    },
  },
  {
    name: "crm_get_target",
    description: "Get a single CRM target by ID",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, _userId: string, user: AuthzUser) {
      const target = await prismadb.crm_Targets.findFirst({
        where: { id: args.id, ...targetReadScopeWhere(user) },
      });
      if (!target) notFound("Target");
      return itemResponse(target);
    },
  },
  {
    name: "crm_search_targets",
    description: "Search targets by name, email, or company (substring match)",
    schema: z.object({ query: z.string().min(1), ...paginationSchema }),
    async handler(
      args: { query: string; limit: number; offset: number },
      _userId: string,
      user: AuthzUser
    ) {
      const where = {
        ...targetReadScopeWhere(user),
        AND: [
          {
            OR: [
              ilike("first_name", args.query),
              ilike("last_name", args.query),
              ilike("email", args.query),
              ilike("company", args.query),
            ],
          },
        ],
      };
      const [data, total] = await Promise.all([
        prismadb.crm_Targets.findMany({
          where,
          ...paginationArgs(args),
          orderBy: { created_on: "desc" },
        }),
        prismadb.crm_Targets.count({ where }),
      ]);
      return listResponse(data, total, args.offset);
    },
  },
  {
    name: "crm_create_target",
    description: "Create a new CRM target",
    schema: z.object({
      first_name: z.string().min(1).optional(),
      last_name: z.string().min(1),
      email: z.string().email().optional(),
      mobile_phone: z.string().optional(),
      office_phone: z.string().optional(),
      company: z.string().optional(),
      position: z.string().optional(),
    }),
    async handler(
      args: {
        first_name?: string;
        last_name: string;
        email?: string;
        mobile_phone?: string;
        office_phone?: string;
        company?: string;
        position?: string;
      },
      userId: string
    ) {
      const { last_name, ...rest } = args;
      const target = await prismadb.crm_Targets.create({
        data: { last_name, ...rest, created_by: userId },
      });
      return itemResponse(target);
    },
  },
  {
    name: "crm_update_target",
    description: "Update an existing CRM target by ID",
    schema: z.object({
      id: z.string().uuid(),
      first_name: z.string().min(1).optional(),
      last_name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      mobile_phone: z.string().optional(),
      office_phone: z.string().optional(),
      company: z.string().optional(),
      position: z.string().optional(),
    }),
    async handler(
      args: {
        id: string;
        first_name?: string;
        last_name?: string;
        email?: string;
        mobile_phone?: string;
        office_phone?: string;
        company?: string;
        position?: string;
      },
      userId: string,
      user: AuthzUser
    ) {
      await assertWritableTarget(user, args.id);
      const { id, ...updateData } = args;
      const target = await prismadb.crm_Targets.update({
        where: { id },
        data: { ...updateData, updatedBy: userId },
      });
      return itemResponse(target);
    },
  },
  {
    name: "crm_delete_target",
    description: "Soft-delete a CRM target by ID (sets deletedAt timestamp)",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, userId: string, user: AuthzUser) {
      await assertWritableTarget(user, args.id);
      const target = await prismadb.crm_Targets.update({
        where: { id: args.id },
        data: softDeleteData(userId),
      });
      return itemResponse({ id: target.id, deletedAt: target.deletedAt });
    },
  },
];
