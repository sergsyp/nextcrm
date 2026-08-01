"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

const STATUS_CONFIG = {
  PENDING: { labelKey: "pending", className: "bg-muted text-muted-foreground" },
  PROCESSING: { labelKey: "processing", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  READY: { labelKey: "ready", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  FAILED: { labelKey: "failed", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
} as const;

interface ProcessingStatusBadgeProps {
  status: keyof typeof STATUS_CONFIG;
}

export function ProcessingStatusBadge({ status }: ProcessingStatusBadgeProps) {
  const t = useTranslations("DocumentsPage");
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("text-xs", config.className)}>
      {t(config.labelKey)}
    </Badge>
  );
}
