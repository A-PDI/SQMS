import { Injectable } from "@nestjs/common";
import { QmsService } from "./qms.service";
import type { Row } from "./qms-presenters";
// SQLite %W: Monday-based week, with the days before the first Monday in week 00.
function week(value: string) {
  const d = new Date(value),
    year = d.getUTCFullYear(),
    day = Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86400000);
  const first = (8 - new Date(Date.UTC(year, 0, 1)).getUTCDay()) % 7;
  return `${year}-W${String(day < first ? 0 : Math.floor((day - first) / 7) + 1).padStart(2, "0")}`;
}
@Injectable()
export class QmsMetricsService {
  constructor(readonly qms: QmsService) {}
  async stats() {
    const rows = await this.qms.allInspections(),
      now = new Date(),
      month = now.toISOString().slice(0, 7);
    const count = (key: string) =>
      Object.entries(
        rows.reduce((a: Row, r) => {
          const label = r[key] || "";
          a[label] = (a[label] || 0) + 1;
          return a;
        }, {}),
      ).map(([k, v]) => ({ [key]: k, count: v }));
    const activity = await this.qms.db.client.activityEvent.findMany({
      where: { entityType: "INCOMING_INSPECTION" },
      orderBy: { occurredAt: "desc" },
      take: 50,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      total_inspections: rows.length,
      open_inspections: rows.filter((r) =>
        ["draft", "partially_complete"].includes(r.status),
      ).length,
      completed_this_month: rows.filter(
        (r) => r.status === "complete" && r.completed_at?.startsWith(month),
      ).length,
      open_ncrs: await this.qms.db.client.nonconformance.count({
        where: { status: "OPEN", archivedAt: null },
      }),
      by_component_type: count("component_type").sort(
        (a, b) => b.count - a.count,
      ),
      by_status: count("status").sort((a, b) =>
        String(a.status).localeCompare(String(b.status)),
      ),
      recent_activity: activity
        .filter((a) => byId.has(a.entityId))
        .slice(0, 10)
        .map((a) => ({
          ...byId.get(a.entityId),
          action_type: a.verb,
          actor_name: a.actorName,
          created_at: a.occurredAt.toISOString(),
        })),
      recent_inspections: rows
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 10),
    };
  }
  async chart(q: Row) {
    const period = ["week", "year"].includes(q.period) ? q.period : "month",
      range = Math.max(1, Math.min(100, parseInt(q.range) || 6));
    const since =
        Date.now() -
        range *
          (period === "week" ? 7 : period === "year" ? 365 : 30) *
          86400000,
      groups = new Map<string, Row>();
    for (const r of await this.qms.allInspections())
      if (new Date(r.created_at).getTime() >= since) {
        const key =
            period === "week"
              ? week(r.created_at)
              : r.created_at.slice(0, period === "year" ? 4 : 7),
          id = `${key}:${r.component_type}`;
        const group = groups.get(id) || {
          period: key,
          component_type: r.component_type,
          count: 0,
        };
        group.count++;
        groups.set(id, group);
      }
    return {
      rows: [...groups.values()].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
      period,
      range,
    };
  }
  async alerts() {
    const rows = await this.qms.allInspections(),
      today = new Date().toISOString().slice(0, 10);
    return {
      past_due: rows
        .filter(
          (r) => r.status !== "complete" && r.due_date && r.due_date < today,
        )
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 20),
      short_duration: rows
        .filter((r) => r.status === "complete" && r.completed_at)
        .map(
          (r): Row => ({
            ...r,
            duration_minutes: Math.floor(
              (new Date(r.completed_at).getTime() -
                new Date(r.created_at).getTime()) /
                60000,
            ),
          }),
        )
        .filter((r) => r.duration_minutes < 15)
        .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
        .slice(0, 20),
    };
  }
  async fireRing() {
    const result = [];
    for (const row of await this.qms.allInspections()) {
      if (row.status !== "complete" || row.component_type !== "cylinder_head")
        continue;
      const { template } = await this.qms.detail(row.id),
        sd = row.section_data || {},
        sections = sd.__admin_sections || template.sections || {};
      const key = Object.keys(sections).find(
        (k) => sections[k]?.section_type === "groove_specs",
      );
      if (!key) continue;
      const ids = (sections[key].items || [])
        .filter(
          (i: Row) =>
            i.entry === true ||
            (i.entry === undefined &&
              /wire protrusion/i.test(i.measurement || "")),
        )
        .map((i: Row) => i.id);
      const items = sd.__items?.length ? sd.__items : [sd];
      if (
        items.some((item: Row) =>
          (item[key]?.measurements || []).some(
            (m: Row) =>
              ids.includes(m.id) &&
              Array.isArray(m.cylinders) &&
              m.cylinders.some((c: any) => String(c ?? "").trim() !== ""),
          ),
        )
      )
        continue;
      result.push(row);
    }
    return {
      inspections: result.sort((a, b) =>
        b.completed_at.localeCompare(a.completed_at),
      ),
    };
  }
  async report(body: Row) {
    const q = { ...body };
    for (const key of Object.keys(q))
      if (q[key] === "All" || q[key] == null || q[key] === "") delete q[key];
    if (q.status)
      q.status = ["open", "draft"].includes(String(q.status).toLowerCase())
        ? "draft"
        : ["complete", "completed"].includes(String(q.status).toLowerCase())
          ? "complete"
          : q.status;
    const all = await this.qms.allInspections();
    const details: Row[] = this.qms
      .filterInspections(all, {
        ...q,
        date_from: undefined,
        date_to: undefined,
      })
      .filter(
        (r) =>
          (!q.date_from || r.created_at >= q.date_from) &&
          (!q.date_to || r.created_at.slice(0, 10) <= q.date_to.slice(0, 10)),
      )
      .map((r) => ({ ...r, started_at: r.created_at }));
    const blank = (label?: string) => ({
      ...(label !== undefined ? { label } : {}),
      count: 0,
      total: 0,
      complete: 0,
      draft: 0,
      pass: 0,
      fail: 0,
      accepted: 0,
    });
    const groups = new Map<string, Row>(),
      totals = blank();
    for (const r of details) {
      const label =
        q.group_by === "month"
          ? r.created_at.slice(0, 7)
          : q.group_by === "week"
            ? week(r.created_at)
            : q.group_by === "assigned_to"
              ? r.assigned_to_name || "Unassigned"
              : ["component_type", "status", "disposition"].includes(q.group_by)
                ? r[q.group_by] || "Pending"
                : "All";
      const group = groups.get(label) || blank(label);
      for (const g of [group, totals]) {
        g.count++;
        g.total++;
        if (r.status === "complete") g.complete++;
        if (r.status === "draft") g.draft++;
        if (r.disposition === "PASS") g.pass++;
        if (r.disposition === "FAIL") g.fail++;
        if (r.disposition === "ACCEPTED") g.accepted++;
      }
      groups.set(label, group);
    }
    return {
      rows: [...groups.values()].sort(
        (a, b) =>
          (["month", "week"].includes(q.group_by) ? -1 : 1) *
          a.label.localeCompare(b.label),
      ),
      totals,
      details,
      filters_applied: body,
    };
  }
}
