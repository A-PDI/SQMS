import {
  AlertOctagon,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FolderKanban,
  Gauge,
  GitPullRequestArrow,
  LayoutDashboard,
  Library,
  ListChecks,
  PlusCircle,
  ScrollText,
  Settings,
  ShieldCheck,
  Stamp,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Me } from "@/lib/session";
import { presentUser } from "@/qms/lib/api";
import { NAV_ITEMS, isNavVisible } from "@/qms/lib/nav";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perms?: string[];
  anyPerms?: string[];
  audience?: "internal" | "external";
  original?: boolean;
}
export interface NavSection {
  id: string;
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    id: "home",
    title: "Home",
    icon: LayoutDashboard,
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        perms: ["inspection:read"],
        audience: "internal",
        original: true,
      },
      {
        href: "/portal",
        label: "Supplier portal",
        icon: Building2,
        audience: "external",
      },
      {
        href: "/tasks",
        label: "My tasks",
        icon: CheckSquare,
        perms: ["task:read"],
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: Stamp,
        perms: ["task:read"],
        audience: "internal",
      },
    ],
  },
  {
    id: "inspection",
    title: "Inspection",
    icon: ClipboardCheck,
    items: [
      {
        href: "/inspections",
        label: "Inspections",
        icon: ClipboardList,
        perms: ["inspection:read"],
        audience: "internal",
        original: true,
      },
      {
        href: "/my-inspections",
        label: "My inspections",
        icon: User,
        perms: ["inspection:read"],
        audience: "internal",
        original: true,
      },
      {
        href: "/inspections/new",
        label: "New Inspection",
        icon: PlusCircle,
        perms: ["inspection:write"],
        audience: "internal",
        original: true,
      },
      {
        href: "/admin",
        label: "Forms & catalogue",
        icon: ListChecks,
        perms: ["inspection_plan:manage"],
        audience: "internal",
        original: true,
      },
    ],
  },
  {
    id: "sourcing",
    title: "Sourcing",
    icon: Building2,
    items: [
      {
        href: "/projects",
        label: "Sourcing projects",
        icon: FolderKanban,
        perms: ["project:read"],
        audience: "internal",
      },
      {
        href: "/suppliers",
        label: "Suppliers",
        icon: Building2,
        perms: ["supplier:read"],
        audience: "internal",
      },
      {
        href: "/products",
        label: "Products",
        icon: Boxes,
        perms: ["product:read"],
        audience: "internal",
      },
      {
        href: "/qualifications",
        label: "Qualifications",
        icon: ClipboardCheck,
        perms: ["qualification:read"],
        audience: "internal",
      },
    ],
  },
  {
    id: "documents",
    title: "Documents",
    icon: Library,
    items: [
      {
        href: "/documents",
        label: "Document records",
        icon: FileText,
        perms: ["document:read"],
      },
      {
        href: "/document-types",
        label: "Document library",
        icon: Library,
        perms: ["document:read"],
        audience: "internal",
      },
      {
        href: "/drawings",
        label: "Drawings",
        icon: FileText,
        perms: ["document:read"],
        audience: "internal",
        original: true,
      },
    ],
  },
  {
    id: "quality",
    title: "Change & quality",
    icon: ShieldCheck,
    items: [
      {
        href: "/changes",
        label: "Change requests",
        icon: GitPullRequestArrow,
        perms: ["change:read"],
      },
      {
        href: "/ncrs",
        label: "NCR reports",
        icon: FileText,
        perms: ["ncr:read"],
        audience: "internal",
        original: true,
      },
      {
        href: "/quality/ncrs",
        label: "Nonconformances",
        icon: AlertOctagon,
        perms: ["ncr:read"],
      },
      {
        href: "/quality/scars",
        label: "Corrective actions",
        icon: Wrench,
        perms: ["scar:read"],
      },
      {
        href: "/quality/deviations",
        label: "Deviations",
        icon: ListChecks,
        perms: ["deviation:read"],
      },
      {
        href: "/quality/signals",
        label: "Quality signals",
        icon: AlertOctagon,
        perms: ["ncr:read"],
        audience: "internal",
      },
      {
        href: "/quality-alerts",
        label: "Quality alerts",
        icon: Bell,
        perms: ["inspection:read"],
        audience: "internal",
        original: true,
      },
    ],
  },
  {
    id: "test-lab",
    title: "Test lab",
    icon: Gauge,
    items: [
      {
        href: "/injector-tests",
        label: "Injector tests",
        icon: Gauge,
        perms: ["injector:read"],
        audience: "internal",
        original: true,
      },
      {
        href: "/injector-reports",
        label: "Injector reports",
        icon: BarChart3,
        perms: ["injector:read"],
        audience: "internal",
        original: true,
      },
      {
        href: "/repairs",
        label: "Repair history",
        icon: Wrench,
        perms: ["injector:read"],
        audience: "internal",
      },
    ],
  },
  {
    id: "insights",
    title: "Insights",
    icon: BarChart3,
    items: [
      {
        href: "/reports",
        label: "Reports",
        icon: BarChart3,
        perms: ["report:read"],
        audience: "internal",
        original: true,
      },
      {
        href: "/admin/audit",
        label: "Audit trail",
        icon: ScrollText,
        perms: ["audit:read"],
        audience: "internal",
      },
    ],
  },
  {
    id: "administration",
    title: "Administration",
    icon: Settings,
    items: [
      {
        href: "/system-admin",
        label: "System administration",
        icon: Settings,
        anyPerms: [
          "admin:users",
          "admin:roles",
          "admin:settings",
          "admin:workflows",
          "admin:policies",
        ],
        audience: "internal",
      },
    ],
  },
];

export function navigationFor(me: Me): NavSection[] {
  const permissions = new Set(me.permissions);
  const originalUser = presentUser(me);
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (
        item.audience &&
        (item.audience === "internal") !== (me.userType === "INTERNAL")
      )
        return false;
      if (item.perms && !item.perms.every((p) => permissions.has(p)))
        return false;
      if (item.anyPerms && !item.anyPerms.some((p) => permissions.has(p)))
        return false;
      if (item.original) {
        const original = NAV_ITEMS.find((i) => i.to === item.href);
        if (original && !isNavVisible(original, originalUser)) return false;
      }
      return true;
    }),
  })).filter((section) => section.items.length > 0);
}

/** One active tab, including create/detail routes nested below a list. */
export function activeNavigation(sections: NavSection[], pathname: string) {
  return sections
    .flatMap((section) => section.items.map((item) => ({ section, item })))
    .filter(
      ({ item }) =>
        pathname === item.href ||
        (item.href !== "/" && pathname.startsWith(item.href + "/")),
    )
    .sort((a, b) => b.item.href.length - a.item.href.length)[0];
}
