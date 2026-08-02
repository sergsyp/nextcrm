"use client";

import { Dialog, DialogContent } from "./dialog-document-view";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

export default function ModalDocumentView({
  isOpen,
  onClose,
  children,
}: ModalProps) {
  const onChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onChange}>
      <DialogContent className="h-[calc(100dvh-1rem)] min-h-0 w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden p-4 sm:h-4/5 sm:w-full sm:max-w-5xl sm:p-6">
        <div className="h-full min-h-0 min-w-0 py-8 sm:py-10">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
