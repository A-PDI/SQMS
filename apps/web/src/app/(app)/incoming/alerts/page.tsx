"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Page } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiMutation } from "@/lib/hooks";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ErrorAlert } from "@/components/ui/feedback";
type Data = Record<string, any>;
export default function Alerts() {
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [acknowledged, setAcknowledged] = useState("false");
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: ["quality-alerts", q, acknowledged, page],
    queryFn: () =>
      api<Page<Data> & { unacknowledged: number }>("/quality-alerts", {
        query: { q, acknowledged: acknowledged || undefined, page },
      }),
  });
  const ack = useApiMutation(
    (id: string) =>
      api(`/quality-alerts/${id}/acknowledge`, { method: "POST" }),
    {
      invalidate: [["quality-alerts"], ["incoming-alerts"]],
      success: "Alert acknowledged",
    },
  );
  return (
    <>
      <PageHeader
        title="Operational quality alerts"
        description={`${rows.data?.unacknowledged ?? 0} unacknowledged alerts`}
        actions={
          <Link href="/incoming">
            <Button variant="outline">Incoming inspections</Button>
          </Link>
        }
      />
      <div className="mb-4 flex gap-3">
        <Input
          className="max-w-md"
          aria-label="Find quality alerts"
          placeholder="Part, supplier or notes"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          className="max-w-xs"
          aria-label="Acknowledgment status"
          value={acknowledged}
          onChange={(e) => {
            setAcknowledged(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "false", label: "Awaiting review" },
            { value: "true", label: "Acknowledged" },
            { value: "", label: "All alerts" },
          ]}
        />
      </div>
      <ErrorAlert error={rows.error ?? ack.error} />
      <div className="space-y-3">
        {rows.data?.items.map((a) => (
          <section key={a.id} className="rounded border p-4 text-sm">
            <strong>{a.type.replaceAll("_", " ")}</strong>
            <p>
              {a.originalPartNumber} ·{" "}
              {a.originalSupplier || "Unattributed supplier"}
            </p>
            {a.inspection ? (
              <Link className="underline" href={`/incoming/${a.inspection.id}`}>
                {a.inspection.number}
              </Link>
            ) : (
              <p>
                Historical alert; originating inspection is absent from the
                supplied dataset
              </p>
            )}
            <p>{a.notes}</p>
            <p className="text-xs text-muted-foreground">
              {a.acknowledgedAt
                ? `Acknowledged ${new Date(a.acknowledgedAt).toLocaleString()}`
                : "Review pending"}
            </p>
            {!a.acknowledgedAt && can("inspection:write") && (
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                disabled={ack.isPending}
                onClick={() => ack.mutate(a.id)}
              >
                Acknowledge
              </Button>
            )}
          </section>
        ))}
      </div>
      <div className="my-4 flex gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span>
          {rows.data?.total ?? 0} alerts · page {page}
        </span>
        <Button
          variant="outline"
          disabled={!rows.data || page * rows.data.pageSize >= rows.data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
