"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentRow } from "../data/schema";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import { ProcessingStatusBadge } from "./processing-status-badge";
import moment from "moment";
import { useTranslations } from "next-intl";
import type { Column } from "@tanstack/react-table";

const MIME_LABELS: Record<string, { label: string; className: string }> = {
  "application/pdf": { label: "PDF", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  "image/": { label: "IMG", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  "application/vnd.openxmlformats": { label: "DOCX", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
  "application/msword": { label: "DOC", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
  "text/plain": { label: "TXT", className: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200" },
};

function getMimeLabel(mimeType: string) {
  for (const [key, value] of Object.entries(MIME_LABELS)) {
    if (mimeType.startsWith(key)) return value;
  }
  return { label: "FILE", className: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200" };
}

const TYPE_COLORS: Record<string, string> = {
  RECEIPT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  CONTRACT: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  OFFER: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  OTHER: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function TranslatedColumnHeader({
  column,
  labelKey,
}: {
  column: Column<DocumentRow, unknown>;
  labelKey: "date" | "document" | "type" | "account" | "status" | "assignedTo";
}) {
  const t = useTranslations("DocumentsPage");
  return <DataTableColumnHeader column={column} title={t(labelKey)} />;
}

function SelectAllCheckbox({ table }: { table: any }) {
  const t = useTranslations("DocumentsPage");
  return (
    <Checkbox
      checked={table.getIsAllPageRowsSelected()}
      onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      aria-label={t("selectAll")}
    />
  );
}

function SelectRowCheckbox({ row }: { row: any }) {
  const t = useTranslations("DocumentsPage");
  return (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
      aria-label={t("selectRow")}
    />
  );
}

function DocumentCell({ row }: { row: any }) {
  const t = useTranslations("DocumentsPage");
  const mimeLabel = getMimeLabel(row.original.document_file_mimeType);
  const summary = row.original.summary;
  const isProcessing =
    row.original.processing_status === "PROCESSING" ||
    row.original.processing_status === "PENDING";

  return (
    <div className="flex items-start gap-3">
      <Badge variant="outline" className={`text-xs shrink-0 ${mimeLabel.className}`}>
        {mimeLabel.label}
      </Badge>
      <div className="min-w-0">
        <span className="font-medium truncate block">
          {row.getValue("document_name")}
        </span>
        {isProcessing ? (
          <span className="text-xs text-muted-foreground italic">
            {t("generatingSummary")}
          </span>
        ) : summary ? (
          <span className="text-xs text-muted-foreground line-clamp-1">
            {summary}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DocumentTypeCell({ type }: { type: string | null }) {
  const t = useTranslations("DocumentsPage");
  if (!type) return <span className="text-muted-foreground">—</span>;
  const labels: Record<string, "receipt" | "contract" | "offer" | "other"> = {
    RECEIPT: "receipt",
    CONTRACT: "contract",
    OFFER: "offer",
    OTHER: "other",
  };
  return (
    <Badge variant="outline" className={`text-xs ${TYPE_COLORS[type] ?? ""}`}>
      {labels[type] ? t(labels[type]) : type}
    </Badge>
  );
}

function AssignedUserCell({ user }: { user: { name: string | null } | null }) {
  const t = useTranslations("DocumentsPage");
  return <div className="w-[120px] text-sm">{user?.name ?? t("unassigned")}</div>;
}

export const columns: ColumnDef<DocumentRow>[] = [
  {
    id: "select",
    header: ({ table }) => <SelectAllCheckbox table={table} />,
    cell: ({ row }) => <SelectRowCheckbox row={row} />,
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <TranslatedColumnHeader column={column} labelKey="date" />
    ),
    cell: ({ row }) => (
      <div className="w-[80px] text-muted-foreground text-sm">
        {moment(row.getValue("createdAt")).format("YY-MM-DD")}
      </div>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "document_name",
    header: ({ column }) => (
      <TranslatedColumnHeader column={column} labelKey="document" />
    ),
    cell: ({ row }) => <DocumentCell row={row} />,
  },
  {
    accessorKey: "document_system_type",
    header: ({ column }) => (
      <TranslatedColumnHeader column={column} labelKey="type" />
    ),
    cell: ({ row }) => (
      <DocumentTypeCell type={row.getValue("document_system_type") as string | null} />
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: "account",
    header: ({ column }) => (
      <TranslatedColumnHeader column={column} labelKey="account" />
    ),
    cell: ({ row }) => {
      const accounts = row.original.accounts;
      const accountName = accounts?.[0]?.account?.name;
      return accountName ? (
        <span className="text-sm text-primary">{accountName}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  {
    accessorKey: "processing_status",
    header: ({ column }) => (
      <TranslatedColumnHeader column={column} labelKey="status" />
    ),
    cell: ({ row }) => (
      <ProcessingStatusBadge status={row.getValue("processing_status")} />
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "assigned_to_user",
    header: ({ column }) => (
      <TranslatedColumnHeader column={column} labelKey="assignedTo" />
    ),
    cell: ({ row }) => (
      <AssignedUserCell
        user={row.getValue("assigned_to_user") as { name: string | null } | null}
      />
    ),
    enableSorting: false,
  },
  {
    id: "actions",
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
];
