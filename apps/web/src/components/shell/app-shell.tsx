"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  KeyRound,
  LogOut,
  Menu,
  Search,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import {
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { presentUser } from "@/qms/lib/api";
import { setSession } from "@/qms/lib/auth";
import ChangePasswordModal from "@/qms-runtime/change-password";
import { isOperationalPath } from "@/qms-runtime/routes";
import { activeNavigation, navigationFor } from "./navigation";

export interface ShellRouting {
  pathname: string;
  navigate: (href: string) => void;
}

function ShellLink({
  href,
  routing,
  children,
  onNavigate,
  ...props
}: {
  href: string;
  routing?: ShellRouting;
  children: ReactNode;
  onNavigate?: () => void;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  if (!routing && !isOperationalPath(href))
    return (
      <Link href={href} onClick={onNavigate} {...props}>
        {children}
      </Link>
    );
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    onNavigate?.();
    if (routing) {
      event.preventDefault();
      routing.navigate(href);
    }
  }
  return (
    <a href={href} onClick={click} {...props}>
      {children}
    </a>
  );
}

/** Shared SQMS organization with the original QMS visual language. */
export function AppShell({
  children,
  routing,
}: {
  children: ReactNode;
  routing?: ShellRouting;
}) {
  const { me, isInternal, logout } = useSession();
  const nextPathname = usePathname();
  const router = useRouter();
  const pathname = routing?.pathname ?? nextPathname;
  const sections = navigationFor(me);
  const active = activeNavigation(sections, pathname);
  const [expanded, setExpanded] = useState(
    () => new Set(["home", active?.section.id ?? "home"]),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [q, setQ] = useState("");
  const contentRef = useRef<HTMLElement>(null);
  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    setSession(presentUser(me), me.csrfToken);
  }, [me]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    setMobileOpen(false);
    setExpanded(
      (previous) => new Set([...previous, active?.section.id ?? "home"]),
    );
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname, active?.section.id]);

  function navigate(href: string) {
    setMobileOpen(false);
    if (routing) routing.navigate(href);
    else if (isOperationalPath(href)) window.location.assign(href);
    else router.push(href);
  }
  async function signOut() {
    setSigningOut(true);
    setSession(null, null);
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }
  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function brand(mobile = false) {
    return (
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <ShellLink
          href={isInternal ? "/" : "/portal"}
          routing={routing}
          onNavigate={() => setMobileOpen(false)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-amber"
          aria-label="PDI Quality Management home"
        >
          <img
            src="/pdi-logo.png"
            alt="PDI"
            className="h-8 w-10 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-wide text-white">
              {me.branding?.shortName ?? "PDI QMS"}
            </p>
            <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-pdi-steel">
              Quality Management
            </p>
          </div>
        </ShellLink>
        {mobile && (
          <Dialog.Close
            className="rounded-lg p-2 text-pdi-steel hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-amber"
            aria-label="Close navigation"
          >
            <X size={19} />
          </Dialog.Close>
        )}
      </div>
    );
  }

  function navigation(prefix: string) {
    return (
      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 py-3"
        aria-label="Main navigation"
      >
        <div className="space-y-1">
          {sections.map((section) => {
            const open = expanded.has(section.id);
            const current = active?.section.id === section.id;
            const Icon = section.icon;
            return (
              <section key={section.id}>
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={open}
                  aria-controls={`${prefix}-${section.id}`}
                  className={cn(
                    "workspace-nav-group flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-amber",
                    current
                      ? "text-pdi-amber-light"
                      : "text-pdi-steel hover:text-white",
                  )}
                >
                  <Icon size={17} className="shrink-0" aria-hidden />
                  <span className="flex-1">{section.title}</span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      "shrink-0 transition-transform",
                      !open && "-rotate-90",
                    )}
                    aria-hidden
                  />
                </button>
                <ul
                  id={`${prefix}-${section.id}`}
                  hidden={!open}
                  className="mb-2 ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-2"
                >
                  {section.items.map((item) => {
                    const selected = active?.item.href === item.href;
                    const ItemIcon = item.icon;
                    return (
                      <li key={item.href}>
                        <ShellLink
                          href={item.href}
                          routing={routing}
                          onNavigate={() => setMobileOpen(false)}
                          aria-current={selected ? "page" : undefined}
                          className={cn(
                            "workspace-nav-link flex min-h-8 items-center gap-2 rounded-r-md border-l-2 px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-amber",
                            selected
                              ? "border-pdi-amber bg-white/10 font-semibold text-white"
                              : "border-transparent text-pdi-steel hover:bg-white/5 hover:text-white",
                          )}
                        >
                          <ItemIcon
                            size={15}
                            className={cn(
                              "shrink-0",
                              selected && "text-pdi-amber-light",
                            )}
                            aria-hidden
                          />
                          {item.label}
                        </ShellLink>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </nav>
    );
  }

  function footer() {
    return (
      <div className="shrink-0 border-t border-white/10 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <p
          className="truncate px-2 text-[11px] text-pdi-steel/70"
          title={me.organization.name}
        >
          {me.organization.name}
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="workspace-nav-link mt-1 flex min-h-9 w-full items-center gap-3 rounded-md px-2 text-sm text-pdi-steel transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-amber disabled:opacity-50"
        >
          <LogOut size={16} aria-hidden />
          {signingOut ? "Signing out…" : "Sign Out"}
        </button>
      </div>
    );
  }

  return (
    <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className="engineering-workspace flex h-dvh min-h-0 overflow-hidden bg-gray-50 print:block print:h-auto print:overflow-visible">
        <a
          href="#page-content"
          className="sr-only z-[70] rounded-lg bg-white p-3 text-pdi-navy focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <aside
          className="hidden w-60 shrink-0 flex-col border-r border-pdi-navy-light bg-gradient-to-b from-pdi-navy to-pdi-navy-light lg:flex print:hidden"
          aria-label="Sidebar"
        >
          {brand()}
          {navigation("desktop")}
          {footer()}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col print:block">
          <header className="shell-topbar z-20 flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 lg:px-5 print:hidden">
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="rounded-lg p-2 text-pdi-navy hover:bg-pdi-frost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-navy lg:hidden"
                aria-label="Open navigation"
              >
                <Menu size={21} />
              </button>
            </Dialog.Trigger>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {active?.section.title ?? "Workspace"}
              </p>
              <p className="truncate text-sm font-semibold text-pdi-navy">
                {active?.item.label ?? "PDI Quality Management"}
              </p>
            </div>
            <form
              className="relative min-w-0 flex-1 lg:ml-4 lg:max-w-sm"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                if (q.trim().length >= 2)
                  navigate(`/search?q=${encodeURIComponent(q.trim())}`);
              }}
            >
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Search the QMS…"
                aria-label="Global search"
                className="workspace-control min-h-9 w-full rounded-md border border-pdi-steel/60 bg-pdi-frost/20 py-1.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-500 focus:border-pdi-navy focus:bg-white focus:ring-1 focus:ring-pdi-navy"
              />
            </form>
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
              <ShellLink
                href="/notifications"
                routing={routing}
                className="workspace-control relative flex min-h-9 min-w-9 items-center justify-center rounded-md p-2 text-pdi-charcoal hover:bg-pdi-frost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-navy"
                aria-label={`Notifications${unread.data?.unread ? `, ${unread.data.unread} unread` : ""}`}
              >
                <Bell size={20} />
                {!!unread.data?.unread && (
                  <span className="absolute right-0 top-0 min-w-4 rounded-full bg-pdi-amber px-1 text-center text-[10px] font-semibold leading-4 text-white">
                    {unread.data.unread > 99 ? "99+" : unread.data.unread}
                  </span>
                )}
              </ShellLink>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="workspace-control flex min-h-9 items-center gap-2 rounded-md p-1 text-pdi-navy hover:bg-pdi-frost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pdi-navy"
                  aria-label="User menu"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-pdi-frost text-xs font-semibold">
                    {me.displayName
                      .split(/\s+/)
                      .map((p) => p[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <span className="hidden max-w-40 truncate text-sm font-medium sm:block">
                    {me.displayName}
                  </span>
                  <ChevronDown size={14} className="hidden sm:block" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{me.email}</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => navigate("/profile")}>
                    <User />
                    Profile & security
                  </DropdownMenuItem>
                  {isInternal && (
                    <DropdownMenuItem onSelect={() => setShowPassword(true)}>
                      <KeyRound />
                      Change password
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => navigate("/notifications")}>
                    <Bell />
                    Notifications
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void signOut()}>
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main
            id="page-content"
            data-operational-screen={routing ? "" : undefined}
            data-dashboard={routing && pathname === "/" ? "" : undefined}
            data-record-list={
              routing &&
              [
                "/inspections",
                "/my-inspections",
                "/ncrs",
                "/drawings",
              ].includes(pathname)
                ? ""
                : undefined
            }
            ref={contentRef}
            tabIndex={-1}
            className={cn(
              "shell-content min-h-0 min-w-0 flex-1 overflow-y-auto focus:outline-none print:overflow-visible print:p-0",
              !routing && "px-4 py-4 lg:px-5",
            )}
          >
            <div
              className={cn(
                "mx-auto w-full print:max-w-none",
                !routing && "max-w-[1400px]",
              )}
            >
              {children}
            </div>
          </main>
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-pdi-navy/50 backdrop-blur-sm lg:hidden print:hidden" />
          <Dialog.Content className="engineering-workspace shell-drawer fixed inset-y-0 left-0 z-50 flex w-72 max-w-[calc(100vw-2.5rem)] flex-col bg-gradient-to-b from-pdi-navy to-pdi-navy-light shadow-2xl focus:outline-none lg:hidden print:hidden">
            <Dialog.Title className="sr-only">Main navigation</Dialog.Title>
            <Dialog.Description className="sr-only">
              Choose a workspace or expand a section to see its pages.
            </Dialog.Description>
            {brand(true)}
            {navigation("mobile")}
            {footer()}
          </Dialog.Content>
        </Dialog.Portal>
      </div>
      {showPassword && (
        <ChangePasswordModal
          onClose={(changed: boolean) => {
            setShowPassword(false);
            if (changed) toast.success("Password updated");
          }}
        />
      )}
    </Dialog.Root>
  );
}
