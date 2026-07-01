import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type AppModalProps = {
  open: boolean;
  title?: string;
  description?: string;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  closeDisabled?: boolean;
  closeOnContentClick?: boolean;
  maxWidthClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AppModal({
  open,
  title,
  description,
  onClose,
  closeOnBackdrop = true,
  closeDisabled = false,
  closeOnContentClick = false,
  maxWidthClassName = "max-w-md",
  children,
  footer,
}: AppModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-black/50 p-2 sm:p-4 overflow-y-auto"
      onMouseDown={() => {
        if (!closeOnBackdrop || closeDisabled) return;
        onClose?.();
      }}
    >
      <div
        className={`w-full ${maxWidthClassName} rounded-2xl bg-white shadow-2xl overflow-hidden my-4 sm:my-0`}
        onMouseDown={(e) => {
          if (closeOnContentClick && closeOnBackdrop && !closeDisabled) {
            onClose?.();
          } else {
            e.stopPropagation();
          }
        }}
      >
        {(title || description || onClose) && (
          <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
            <div>
              {title && <h3 className="text-lg font-semibold text-slate-900">{title}</h3>}
              {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>

            {onClose && (
              <button
                type="button"
                onClick={() => {
                  if (closeDisabled) return;
                  onClose();
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  closeDisabled
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="px-6 py-5">{children}</div>

        {footer && <div className="border-t px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}