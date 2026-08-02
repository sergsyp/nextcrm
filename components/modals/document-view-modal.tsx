"use client";

import { Button } from "@/components/ui/button";
import ModalDocumentView from "../ui/modal-document-view";
import { useTranslations } from "next-intl";

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  document: any;
}

const DocumentViewModal = ({
  isOpen,
  onClose,
  loading,
  document,
}: AlertModalProps) => {
  const t = useTranslations("DocumentsPage");
  const isInternalDocument =
    typeof document.document_file_url === "string" &&
    document.document_file_url.startsWith("internal://");
  const hasTextContent =
    typeof document.content_text === "string" &&
    document.content_text.trim().length > 0;

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    const safeName = String(document.document_name || "document")
      .replace(/[<>:"/\\|?*]+/g, "-")
      .trim();
    const extension = document.document_file_mimeType === "text/plain" ? ".txt" : ".md";

    anchor.href = url;
    anchor.download = `${safeName || "document"}${extension}`;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadInternalDocument = () => {
    downloadBlob(new Blob([document.content_text || ""], {
      type: document.document_file_mimeType || "text/markdown",
    }));
  };

  const downloadExternalDocument = async () => {
    if (!document.document_file_url) return;
    const response = await fetch(document.document_file_url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    downloadBlob(await response.blob());
  };

  const imageTypes = [
    "application/png",
    "application/jpg",
    "application/jpeg",
    "application/gif",
    "images/png",
    "images/jpg",
    "images/jpeg",
    "images/gif",
    "image/png",
    "image/jpg",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ];

  if (hasTextContent || isInternalDocument) {
    return (
      <ModalDocumentView isOpen={isOpen} onClose={onClose}>
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <div className="min-h-0 min-w-0 max-w-full flex-1 touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-4 text-sm leading-6 [overflow-wrap:anywhere] [-webkit-overflow-scrolling:touch] sm:p-5">
            {document.content_text || t("emptyContent")}
          </div>
          <div className="flex w-full flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              disabled={loading || !document.content_text}
              onClick={downloadInternalDocument}
            >
              {t("download")}
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={loading}
              variant={"outline"}
              onClick={onClose}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      </ModalDocumentView>
    );
  }

  if (imageTypes.includes(document.document_file_mimeType)) {
    const imageUrl = document.document_file_url || "";
    return (
      <ModalDocumentView isOpen={isOpen} onClose={onClose}>
        <div className="flex flex-col h-full ">
          <div className="relative h-full p-10">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Image preview" src={imageUrl} className="object-contain w-full h-full" />
            ) : (
              <p className="text-muted-foreground">{t("noPreview")}</p>
            )}
          </div>
          <div className="pt-6 space-x-2 flex items-center justify-end w-full ">
            <Button disabled={loading} variant={"outline"} onClick={onClose}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      </ModalDocumentView>
    );
  }

  if (document.document_file_mimeType === "application/pdf") {
    return (
      <ModalDocumentView isOpen={isOpen} onClose={onClose}>
        <div className="flex flex-col h-full ">
          <embed
            style={{
              width: "100%",
              height: "100%",
            }}
            type="application/pdf"
            src={document.document_file_url}
          />
          <div className="pt-6 space-x-2 flex items-center justify-end w-full ">
            <Button disabled={loading} variant={"outline"} onClick={onClose}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      </ModalDocumentView>
    );
  } else {
    return (
      <ModalDocumentView isOpen={isOpen} onClose={onClose}>
        <div className="flex flex-col h-full ">
          {t("previewUnavailable")}
          <Button disabled={loading || !document.document_file_url} onClick={downloadExternalDocument}>
            {t("download")}
          </Button>
          <div className="pt-6 space-x-2 flex items-center justify-end w-full ">
            <Button disabled={loading} variant={"outline"} onClick={onClose}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      </ModalDocumentView>
    );
  }
};

export default DocumentViewModal;
