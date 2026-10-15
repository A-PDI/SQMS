"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon,
  BarChart3,
  Bell,
  Boxes,
  CheckSquare,
  ClipboardCheck,
  FileStack,
  FileText,
  FolderKanban,
  GitPullRequestArrow,
  LayoutDashboard,
  Library,
  ListChecks,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Stamp,
  User,
  Wrench,
  Building2,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perms?: string[];
  anyPerms?: string[];
  internal?: boolean;
  external?: boolean;
}

const SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, perms: ["report:read"], internal: true },
      { href: "/portal", label: "Supplier portal", icon: Building2, external: true },
      { href: "/approvals", label: "Approvals", icon: Stamp, perms: ["task:read"], internal: true },
      { href: "/tasks", label: "Tasks", icon: CheckSquare, perms: ["task:read"] },
    ],
  },
  {
    title: "Sourcing",
    items: [
      { href: "/projects", label: "Sourcing projects", icon: FolderKanban, perms: ["project:read"], internal: true },
      { href: "/suppliers", label: "Suppliers", icon: Building2, perms: ["supplier:read"], internal: true },
      { href: "/products", label: "Products", icon: Boxes, perms: ["product:read"], internal: true },
      { href: "/qualifications", label: "Qualifications", icon: ClipboardCheck, perms: ["qualification:read"], internal: true },
    ],
  },
  {
    title: "Documents",
    items: [
      { href: "/documents", label: "Document records", icon: FileText, perms: ["document:read"] },
      { href: "/document-types", label: "Document library", icon: Library, perms: ["document:read"], internal: true },
    ],
  },
  {
    title: "Change & quality",
    items: [
      { href: "/changes", label: "Change requests", icon: GitPullRequestArrow, perms: ["change:read"] },
      { href: "/quality/ncrs", label: "Nonconformances", icon: AlertOctagon, perms: ["ncr:read"] },
      { href: "/quality/scars", label: "Corrective actions", icon: Wrench, perms: ["scar:read"] },
      { href: "/quality/deviations", label: "Deviations", icon: ListChecks, perms: ["deviation:read"] },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, perms: ["report:read"], internal: true },
      { href: "/admin/audit", label: "Audit trail", icon: ScrollText, perms: ["audit:read"], internal: true },
    ],
  },
  {
    title: "Administration",
    items: [{ href: "/admin", label: "Administration", icon: Settings, anyPerms: ["admin:users", "admin:roles", "admin:settings", "admin:workflows", "admin:policies"], internal: true }],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/admin") return pathname === "/admin" || (pathname.startsWith("/admin/") && !pathname.startsWith("/admin/audit"));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, can, canAny, isInternal, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const unread = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api<{ unread: number }>("/notifications/unread-count"), refetchInterval: 60_000 });
  const brand = me.branding?.shortName ?? "SQMS";

  const visible = (i: NavItem) => (i.internal ? isInternal : true) && (i.external ? !isInternal : true) && (!i.perms || can(...i.perms)) && (!i.anyPerms || canAny(...i.anyPerms));

  const nav = (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main">
      {SECTIONS.map((s, idx) => {
        const items = s.items.filter(visible);
        if (!items.length) return null;
        return (
          <div key={idx}>
            {s.title && <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">{s.title}</p>}
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white", isActive(pathname, i.href) && "bg-white/15 font-medium text-white")}
                    aria-current={isActive(pathname, i.href) ? "page" : undefined}
                  >
                    <i.icon className="size-4" />
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={cn("fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-primary text-primary-foreground transition-transform lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
        <Link href="/" className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
          <span className="flex size-7 items-center justify-center rounded bg-white/15 text-xs font-bold">{brand.slice(0, 2)}</span>
          <span className="truncate text-sm font-semibold">{me.branding?.productName ?? "Supplier Quality Management"}</span>
        </Link>
        {nav}
        <div className="border-t border-white/10 px-4 py-2 text-[11px] text-white/50">
          <ShieldCheck className="mr-1 inline size-3" />
          {me.organization.name}
          {!me.features.supplierPortal && isInternal && <span className="block">Supplier portal: disabled</span>}
        </div>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-surface px-4">
          <button className="rounded p-1.5 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <form
            className="relative max-w-xl flex-1"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search suppliers, parts, projects, documents, NCRs..."
              className="h-9 w-full rounded-md border bg-muted/50 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:bg-surface"
              aria-label="Global search"
            />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/notifications" className="relative rounded-md p-2 hover:bg-muted" aria-label={`Notifications${unread.data?.unread ? `, ${unread.data.unread} unread` : ""}`}>
              <Bell className="size-5" />
              {!!unread.data?.unread && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread.data.unread > 99 ? "99+" : unread.data.unread}</span>}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted" aria-label="User menu">
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {me.displayName
                    .split(/\s+/)
                    .map((p) => p[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="hidden text-left text-xs leading-tight sm:block">
                  <span className="block font-medium">{me.displayName}</span>
                  <span className="block text-muted-foreground">{me.roles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ")}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{me.email}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => router.push("/profile")}>
                  <User /> Profile & security
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/notifications")}>
                  <Bell /> Notifications
                </DropdownMenuItem>
                {isInternal && (
                  <DropdownMenuItem onSelect={() => router.push("/document-types")}>
                    <FileStack /> Document library
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
