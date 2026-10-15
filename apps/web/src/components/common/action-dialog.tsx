"use client";

import { useId, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";

/**
 * Confirmation dialog for a state transition. When `reasonLabel` is set a justification is required and passed to
 * `onConfirm` (it is recorded in the audit trail by the API).
 */
export function ActionDialog({
  trigger,
  title,
  description,
  reasonLabel,
  reasonMin = 5,
  reasonRequired = true,
  confirmLabel = "Confirm",
  confirmVariant = "default",
  children,
  onConfirm,
  disabled,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  reasonLabel?: string;
  reasonMin?: number;
  reasonRequired?: boolean;
  confirmLabel?: string;
  confirmVariant?: ButtonProps["variant"];
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tooShort = !!reasonLabel && reasonRequired && reason.trim().length < reasonMin;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild disabled={disabled}>
        {trigger}
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <div className="space-y-3">
          {error ? <ErrorAlert error={error} /> : null}
          {children}
          {reasonLabel && (
            <Field label={reasonLabel} htmlFor={reasonId} required={reasonRequired} hint={reasonRequired ? `At least ${reasonMin} characters; recorded in the audit trail.` : undefined}>
              <Textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant={confirmVariant} onClick={confirm} loading={busy} disabled={tooShort}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
