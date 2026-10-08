import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type AppModalProps = {
  open: boolean;
  title?: string | ReactNode;
  description?: string | ReactNode;
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const titleId = useId();
  const descriptionId = useId();

  closeRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusInitial = window.requestAnimationFrame(() => {
      const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable || dialog)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (closeDisabledRef.current || !closeRef.current) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [mounted, open]);

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
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
            <div className="flex-1 min-w-0">
              {title && <h3 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h3>}
              {description && <p id={descriptionId} className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>

            {onClose && (
              <button
                type="button"
                aria-label="Tutup dialog"
                disabled={closeDisabled}
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
                <X className="w-4 h-4" aria-hidden="true" />
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
