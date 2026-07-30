"use client";

import { Button } from "@/components/ui/button";
import ModalDocumentView from "../ui/modal-document-view";
import Link from "next/link";

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
  const isInternalDocument =
    typeof document.document_file_url === "string" &&
    document.document_file_url.startsWith("internal://");

  const downloadInternalDocument = () => {
    const blob = new Blob([document.content_text || ""], {
      type: document.document_file_mimeType || "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    const safeName = String(document.document_name || "document")
      .replace(/[<>:"/\\|?*]+/g, "-")
      .trim();

    anchor.href = url;
    anchor.download = `${safeName || "document"}.md`;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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

  if (isInternalDocument) {
    return (
      <ModalDocumentView isOpen={isOpen} onClose={onClose}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-5 text-sm leading-6">
            {document.content_text || "Document content is empty."}
          </div>
          <div className="flex w-full items-center justify-end gap-2 pt-6">
            <Button
              disabled={loading || !document.content_text}
              onClick={downloadInternalDocument}
            >
              Download
            </Button>
            <Button disabled={loading} variant={"outline"} onClick={onClose}>
              Cancel
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
              <p className="text-muted-foreground">No preview available</p>
            )}
          </div>
          <div className="pt-6 space-x-2 flex items-center justify-end w-full ">
            <Button disabled={loading} variant={"outline"} onClick={onClose}>
              Cancel
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
              Cancel
            </Button>
          </div>
        </div>
      </ModalDocumentView>
    );
  } else {
    return (
      <ModalDocumentView isOpen={isOpen} onClose={onClose}>
        <div className="flex flex-col h-full ">
          This format can not be previewed. Please download the file to view it.
          <Button>
            <Link href={document.document_file_url}> Download</Link>
          </Button>
          <div className="pt-6 space-x-2 flex items-center justify-end w-full ">
            <Button disabled={loading} variant={"outline"} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </ModalDocumentView>
    );
  }
};

export default DocumentViewModal;
