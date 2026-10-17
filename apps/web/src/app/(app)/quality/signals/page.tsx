"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Page } from "@/lib/api";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ErrorAlert } from "@/components/ui/feedback";
type Data = Record<string, any>;
export default function Signals() {
  const [status, setStatus] = useState("CANDIDATE");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["quality-signals", status, page],
    queryFn: () =>
      api<Page<Data>>("/quality-signals", {
        query: { status: status || undefined, page },
      }),
  });
  return (
    <>
      <PageHeader
        title="Quality signals"
        description="Historical defect candidates, human-confirmed recurrence and reasoned dismissals"
      />
      <Select
        aria-label="Quality signal status"
        className="mb-4 max-w-xs"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
        options={[
          { value: "", label: "All decisions" },
          ...["CANDIDATE", "CONFIRMED", "DISMISSED"].map((value) => ({
            value,
            label: value,
          })),
        ]}
      />
      <ErrorAlert error={query.error} />
      <div className="space-y-3">
        {query.data?.items.map((r) => (
          <section className="rounded border p-4 text-sm" key={r.id}>
            <strong>{r.status}</strong>
            <p>
              <Link
                className="underline"
                href={`/quality/ncrs/${r.currentNcr.id}`}
              >
                {r.currentNcr.number} · {r.currentNcr.title}
              </Link>{" "}
              · {r.currentNcr.source}
            </p>
            <p>
              Historical:{" "}
              <Link
                className="underline"
                href={`/quality/ncrs/${r.historicalNcr.id}`}
              >
                {r.historicalNcr.number} · {r.historicalNcr.title}
              </Link>{" "}
              · {r.historicalNcr.source} · {r.historicalNcr.status}
            </p>
            {(r.explanation.lines ?? []).map((l: Data, i: number) => (
              <p className="mt-2" key={i}>
                Current{" "}
                {l.currentCondition ?? "condition requires source review"} ·
                historical {l.historicalCondition} ·{" "}
                {l.revisionCompatible
                  ? "revision comparison compatible"
                  : "engineering compatibility review required"}
              </p>
            ))}
            <p>{r.reason}</p>
            <Link
              className="mt-2 inline-block underline"
              href={`/quality/ncrs/${r.currentNcr.id}`}
            >
              Compare evidence & review
            </Link>
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
          {query.data?.total ?? 0} signals · page {page}
        </span>
        <Button
          variant="outline"
          disabled={
            !query.data || page * query.data.pageSize >= query.data.total
          }
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
