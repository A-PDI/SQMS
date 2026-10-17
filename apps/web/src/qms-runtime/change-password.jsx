"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter } from "../components/ui/dialog";
import api from "../qms/lib/api";

/** Retains the original local-password fields, validation and API contract. */
export default function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    if (form.next.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (form.next !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      await api.patch("/auth/password", {
        current_password: form.current,
        new_password: form.next,
      });
      onClose(true);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to change password");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose(false);
      }}
    >
      <DialogContent
        title="Change Password"
        description="Update the password for your local account."
        className="max-w-sm rounded-2xl"
        onOpenAutoFocus={event => {
          event.preventDefault();
          document.getElementById("password-current")?.focus();
        }}
      >
        <form onSubmit={submit} className="space-y-3">
          {[
            ["current", "Current Password", "current-password"],
            ["next", "New Password (min 8 characters)", "new-password"],
            ["confirm", "Confirm New Password", "new-password"],
          ].map(([key, label, autocomplete]) => (
            <div key={key}>
              <label
                htmlFor={`password-${key}`}
                className="mb-1 block text-xs font-medium text-gray-500"
              >
                {label}
              </label>
              <input
                id={`password-${key}`}
                type="password"
                required
                autoComplete={autocomplete}
                value={form[key]}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    [key]: event.target.value,
                  }))
                }
                className="min-h-10 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-pdi-navy"
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="text-xs text-pdi-red">
              {error}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              disabled={saving}
              onClick={() => onClose(false)}
              className="min-h-10 rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-10 rounded-lg bg-pdi-navy px-4 py-2 text-sm text-white hover:bg-pdi-navy-light disabled:opacity-50"
            >
              {saving ? "Saving…" : "Update Password"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
