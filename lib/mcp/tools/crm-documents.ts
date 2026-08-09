import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { minioClient, MINIO_BUCKET, MINIO_PUBLIC_URL } from "@/lib/minio";
import { randomUUID } from "crypto";
import { createHash } from "node:crypto";
import {
  paginationSchema,
  paginationArgs,
  listResponse,
  itemResponse,
  notFound,
  validationError,
  softDeleteData,
} from "../helpers";
import { landingContentSchema, landingSlugSchema } from "@/lib/landing/schema";
import {
  hasAdminApproval,
  LANDING_PUBLISH_APPROVAL,
} from "@/lib/email/agent-approval";

// Map entity types to their Prisma junction table accessor names (camelCase, lowercase first)
const ENTITY_LINK_MAP: Record<string, string> = {
  account: "documentsToAccounts",
  contact: "documentsToContacts",
  lead: "documentsToLeads",
  opportunity: "documentsToOpportunities",
  task: "documentsToTasks",
};

const ENTITY_FK_MAP: Record<string, string> = {
  account: "account_id",
  contact: "contact_id",
  lead: "lead_id",
  opportunity: "opportunity_id",
  task: "task_id",
};

export const crmDocumentTools = [
  {
    name: "crm_create_text_document",
    description: "Create a text or structured JSON document directly in the CRM knowledge base",
    schema: z.object({
      document_name: z.string().min(1).max(240),
      content_text: z.string().min(1).max(200_000),
      description: z.string().max(2000).optional(),
      tags: z.record(z.string(), z.unknown()).optional(),
    }),
    async handler(
      args: {
        document_name: string;
        content_text: string;
        description?: string;
        tags?: Record<string, unknown>;
      },
      userId: string
    ) {
      const doc = await prismadb.documents.create({
        data: {
          document_name: args.document_name,
          document_file_mimeType: "text/plain",
          document_file_url: "",
          description: args.description,
          visibility: "shared",
          created_by_user: userId,
          createdBy: userId,
          assigned_user: userId,
          content_text: args.content_text,
          tags: args.tags as any,
          processing_status: "READY",
        },
      });
      return itemResponse(doc);
    },
  },
  {
    name: "crm_search_documents",
    description:
      "Search accessible CRM knowledge documents by text or stable key without downloading every document",
    schema: z.object({
      query: z.string().min(1).max(500).optional(),
      key: z.string().min(1).max(500).optional(),
      limit: z.number().min(1).max(100).default(20),
    }).refine((args) => Boolean(args.query || args.key), {
      message: "query or key is required",
    }),
    async handler(
      args: { query?: string; key?: string; limit: number },
      userId: string
    ) {
      const user = await prismadb.users.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user) notFound("User");
      const access =
        user.role === "admin"
          ? {}
          : { OR: [{ created_by_user: userId }, { assigned_user: userId }] };
      const textFilter = args.query
        ? {
            OR: [
              { document_name: { contains: args.query, mode: "insensitive" as const } },
              { description: { contains: args.query, mode: "insensitive" as const } },
              { content_text: { contains: args.query, mode: "insensitive" as const } },
            ],
          }
        : {};
      const data = await prismadb.documents.findMany({
        where: {
          ...access,
          ...textFilter,
          ...(args.key ? { key: args.key } : {}),
          deletedAt: null,
        },
        select: {
          id: true,
          document_name: true,
          description: true,
          key: true,
          tags: true,
          version: true,
          content_hash: true,
          updatedAt: true,
          assigned_user: true,
        },
        orderBy: { updatedAt: "desc" },
        take: args.limit,
      });
      return listResponse(data, data.length, 0);
    },
  },
  {
    name: "crm_update_text_document",
    description:
      "Safely update a CRM text document with optimistic version checking, revision history, and audit metadata",
    schema: z.object({
      id: z.string().uuid(),
      expectedVersion: z.number().int().min(1),
      content_text: z.string().min(1).max(200_000),
      document_name: z.string().min(1).max(240).optional(),
      description: z.string().max(2000).optional(),
      tags: z.record(z.string(), z.unknown()).optional(),
      changeSummary: z.string().min(1).max(1000),
      changeReason: z.string().min(1).max(2000),
      source: z.string().min(1).max(1000),
    }),
    async handler(
      args: {
        id: string;
        expectedVersion: number;
        content_text: string;
        document_name?: string;
        description?: string;
        tags?: Record<string, unknown>;
        changeSummary: string;
        changeReason: string;
        source: string;
      },
      userId: string
    ) {
      const user = await prismadb.users.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user) notFound("User");
      const existing = await prismadb.documents.findFirst({
        where: {
          id: args.id,
          deletedAt: null,
          ...(user.role === "admin"
            ? {}
            : { OR: [{ created_by_user: userId }, { assigned_user: userId }] }),
        },
      });
      if (!existing) notFound("Document");
      if (existing.version !== args.expectedVersion) {
        throw new Error(
          `CONFLICT: expected version ${args.expectedVersion}, current version ${existing.version}`
        );
      }

      const now = new Date();
      const nextVersion = existing.version + 1;
      const nextHash = createHash("sha256")
        .update(args.content_text)
        .digest("hex");
      const oldTags =
        existing.tags && typeof existing.tags === "object" && !Array.isArray(existing.tags)
          ? (existing.tags as Record<string, unknown>)
          : {};
      const nextTags = {
        ...oldTags,
        ...(args.tags ?? {}),
        knowledgeChange: {
          summary: args.changeSummary,
          reason: args.changeReason,
          source: args.source,
          updatedBy: userId,
          updatedAt: now.toISOString(),
        },
      };

      const updated = await prismadb.$transaction(async (tx) => {
        await tx.documents.create({
          data: {
            v: existing.v,
            document_name: `${existing.document_name} — версия ${existing.version}`,
            description: existing.description,
            document_file_mimeType: existing.document_file_mimeType,
            document_file_url: existing.document_file_url,
            key: existing.key
              ? `${existing.key}.history.v${existing.version}`
              : `history/${existing.id}/v${existing.version}`,
            size: existing.size,
            content_text: existing.content_text,
            content_hash: existing.content_hash,
            summary: existing.summary,
            processing_status: existing.processing_status,
            status: "SUPERSEDED",
            visibility: existing.visibility,
            tags: {
              ...oldTags,
              kind: "knowledge-revision",
              canonicalDocumentId: existing.id,
              supersededAt: now.toISOString(),
              supersededBy: userId,
            },
            assigned_user: existing.assigned_user,
            created_by_user: userId,
            createdBy: userId,
            version: existing.version,
            parent_document_id: existing.id,
          },
        });
        const result = await tx.documents.updateMany({
          where: {
            id: existing.id,
            version: args.expectedVersion,
            deletedAt: null,
          },
          data: {
            document_name: args.document_name ?? existing.document_name,
            description: args.description ?? existing.description,
            content_text: args.content_text,
            content_hash: nextHash,
            size: Buffer.byteLength(args.content_text),
            tags: nextTags as any,
            processing_status: "READY",
            version: nextVersion,
            updatedAt: now,
          },
        });
        if (result.count !== 1) {
          throw new Error("CONFLICT: document changed during update");
        }
        await (tx as any).crm_AuditLog.create({
          data: {
            entityType: "document",
            entityId: existing.id,
            action: "updated",
            userId,
            changes: [
              { field: "version", old: existing.version, new: nextVersion },
              { field: "content_hash", old: existing.content_hash, new: nextHash },
              { field: "changeSummary", old: null, new: args.changeSummary },
              { field: "changeReason", old: null, new: args.changeReason },
              { field: "source", old: null, new: args.source },
            ],
          },
        });
        return tx.documents.findUniqueOrThrow({ where: { id: existing.id } });
      });
      return itemResponse(updated);
    },
  },
  {
    name: "crm_publish_landing",
    description:
      "Publish a structured CRM text document as a public landing page after an administrator approves the linked task",
    schema: z.object({
      documentId: z.string().uuid(),
      approvalTaskId: z.string().uuid(),
      slug: landingSlugSchema,
    }),
    async handler(
      args: { documentId: string; approvalTaskId: string; slug: string },
      userId: string
    ) {
      const doc = await prismadb.documents.findFirst({
        where: {
          id: args.documentId,
          created_by_user: userId,
          deletedAt: null,
          tasks: { some: { task_id: args.approvalTaskId } },
        },
      });
      if (!doc?.content_text) notFound("Document");
      landingContentSchema.parse(JSON.parse(doc.content_text));

      const approval = await prismadb.tasks.findFirst({
        where: { id: args.approvalTaskId, user: userId },
        select: {
          comments: {
            include: { assigned_user: { select: { role: true } } },
          },
        },
      });
      if (
        !approval ||
        !hasAdminApproval(approval.comments, LANDING_PUBLISH_APPROVAL)
      ) {
        throw new Error("APPROVAL_REQUIRED");
      }

      const conflict = await prismadb.documents.findFirst({
        where: {
          id: { not: doc.id },
          deletedAt: null,
          tags: { path: ["landing", "slug"], equals: args.slug },
        },
        select: { id: true },
      });
      if (conflict) throw new Error("CONFLICT: landing slug already exists");

      const oldTags =
        doc.tags && typeof doc.tags === "object" && !Array.isArray(doc.tags)
          ? (doc.tags as Record<string, unknown>)
          : {};
      const updated = await prismadb.documents.update({
        where: { id: doc.id },
        data: {
          tags: {
            ...oldTags,
            landing: {
              slug: args.slug,
              status: "published",
              publishedAt: new Date().toISOString(),
              approvedTaskId: args.approvalTaskId,
            },
          },
          status: "PUBLISHED",
        },
      });
      return itemResponse({
        id: updated.id,
        slug: args.slug,
        url: `/l/${args.slug}`,
      });
    },
  },
  {
    name: "crm_list_documents",
    description: "List documents, optionally filtered by linked entity type and ID",
    schema: z.object({
      entityType: z
        .enum(["account", "contact", "lead", "opportunity", "task"])
        .optional(),
      entityId: z.string().uuid().optional(),
      ...paginationSchema,
    }),
    async handler(
      args: {
        entityType?: string;
        entityId?: string;
        limit: number;
        offset: number;
      },
      userId: string
    ) {
      const where: any = {
        created_by_user: userId,
        deletedAt: null,
      };
      if (args.entityType && args.entityId) {
        const relation =
          args.entityType === "account"
            ? "accounts"
            : args.entityType === "contact"
            ? "contacts"
            : args.entityType === "lead"
            ? "leads"
            : args.entityType === "opportunity"
            ? "opportunities"
            : "tasks";
        where[relation] = {
          some: { [ENTITY_FK_MAP[args.entityType]]: args.entityId },
        };
      }
      const [data, total] = await Promise.all([
        prismadb.documents.findMany({
          where,
          ...paginationArgs(args),
          orderBy: { createdAt: "desc" },
        }),
        prismadb.documents.count({ where }),
      ]);
      return listResponse(data, total, args.offset);
    },
  },
  {
    name: "crm_get_document",
    description: "Get a single document by ID",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, userId: string) {
      const user = await prismadb.users.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user) notFound("User");
      const doc = await prismadb.documents.findFirst({
        where: {
          id: args.id,
          deletedAt: null,
          ...(user.role === "admin"
            ? {}
            : { OR: [{ created_by_user: userId }, { assigned_user: userId }] }),
        },
        include: {
          accounts: true,
          contacts: true,
          leads: true,
          opportunities: true,
          tasks: true,
        },
      });
      if (!doc) notFound("Document");
      return itemResponse(doc);
    },
  },
  {
    name: "crm_create_document",
    description: "Create a document record and get a presigned upload URL",
    schema: z.object({
      document_name: z.string().min(1),
      contentType: z.string().min(1),
      description: z.string().optional(),
      visibility: z.string().optional(),
    }),
    async handler(
      args: {
        document_name: string;
        contentType: string;
        description?: string;
        visibility?: string;
      },
      userId: string
    ) {
      const ext = args.document_name.includes(".")
        ? args.document_name.split(".").pop()?.trim() || "bin"
        : "bin";
      const key = `documents/${randomUUID()}.${ext}`;
      const fileUrl = `${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${key}`;

      const doc = await prismadb.documents.create({
        data: {
          document_name: args.document_name,
          document_file_mimeType: args.contentType,
          document_file_url: fileUrl,
          key,
          description: args.description,
          visibility: args.visibility,
          created_by_user: userId,
          createdBy: userId,
          processing_status: "PENDING",
        },
      });

      const command = new PutObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key,
        ContentType: args.contentType,
      });
      const presignedUrl = await getSignedUrl(minioClient, command, { expiresIn: 600 });

      return itemResponse({ ...doc, presignedUrl, expiresIn: 600 });
    },
  },
  {
    name: "crm_get_upload_url",
    description: "Get a presigned upload URL for an existing document",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, userId: string) {
      const doc = await prismadb.documents.findFirst({
        where: { id: args.id, created_by_user: userId },
      });
      if (!doc) notFound("Document");
      if (!doc.key) validationError("Document has no storage key");
      const command = new PutObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: doc.key!,
        ContentType: doc.document_file_mimeType,
      });
      const presignedUrl = await getSignedUrl(minioClient, command, { expiresIn: 600 });
      return itemResponse({ id: doc.id, url: presignedUrl, expiresIn: 600 });
    },
  },
  {
    name: "crm_get_download_url",
    description: "Get a presigned download URL for a document",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, userId: string) {
      const doc = await prismadb.documents.findFirst({
        where: { id: args.id, created_by_user: userId },
      });
      if (!doc) notFound("Document");
      if (!doc.key) validationError("Document has no storage key");
      const command = new GetObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: doc.key!,
      });
      const presignedUrl = await getSignedUrl(minioClient, command, { expiresIn: 3600 });
      return itemResponse({ id: doc.id, url: presignedUrl, expiresIn: 3600 });
    },
  },
  {
    name: "crm_link_document",
    description:
      "Link a document to an entity (account, contact, lead, opportunity, or task)",
    schema: z.object({
      document_id: z.string().uuid(),
      entityType: z.enum(["account", "contact", "lead", "opportunity", "task"]),
      entityId: z.string().uuid(),
    }),
    async handler(
      args: { document_id: string; entityType: string; entityId: string },
      userId: string
    ) {
      const doc = await prismadb.documents.findFirst({
        where: { id: args.document_id, created_by_user: userId },
      });
      if (!doc) notFound("Document");

      const table = ENTITY_LINK_MAP[args.entityType];
      const fk = ENTITY_FK_MAP[args.entityType];
      if (!table || !fk) validationError(`Invalid entity type: ${args.entityType}`);

      await (prismadb as any)[table].create({
        data: { document_id: args.document_id, [fk]: args.entityId },
      });

      return itemResponse({
        document_id: args.document_id,
        entityType: args.entityType,
        entityId: args.entityId,
      });
    },
  },
  {
    name: "crm_unlink_document",
    description: "Remove a document link from an entity",
    schema: z.object({
      document_id: z.string().uuid(),
      entityType: z.enum(["account", "contact", "lead", "opportunity", "task"]),
      entityId: z.string().uuid(),
    }),
    async handler(
      args: { document_id: string; entityType: string; entityId: string },
      userId: string
    ) {
      const doc = await prismadb.documents.findFirst({
        where: { id: args.document_id, created_by_user: userId },
      });
      if (!doc) notFound("Document");

      const table = ENTITY_LINK_MAP[args.entityType];
      const fk = ENTITY_FK_MAP[args.entityType];
      if (!table || !fk) validationError(`Invalid entity type: ${args.entityType}`);

      await (prismadb as any)[table].delete({
        where: {
          [`document_id_${fk}`]: {
            document_id: args.document_id,
            [fk]: args.entityId,
          },
        },
      });

      return itemResponse({
        document_id: args.document_id,
        entityType: args.entityType,
        entityId: args.entityId,
        unlinked: true,
      });
    },
  },
  {
    name: "crm_delete_document",
    description: "Soft-delete a document (sets status to DELETED)",
    schema: z.object({ id: z.string().uuid() }),
    async handler(args: { id: string }, userId: string) {
      const existing = await prismadb.documents.findFirst({
        where: { id: args.id, created_by_user: userId, deletedAt: null },
      });
      if (!existing) notFound("Document");
      const doc = await prismadb.documents.update({
        where: { id: args.id },
        data: softDeleteData(userId),
      });
      return itemResponse({ id: doc.id, deletedAt: doc.deletedAt });
    },
  },
];
