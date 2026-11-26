"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, Coffee, Loader2, Search, Sparkles, X } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { AdminModal, AdminModalBody, AdminModalFooter, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { clientAdminFetch, isPermissionDenied } from "@/lib/auth/client-admin-fetch";
import { useAdminPath } from "@/hooks/useAdminPath";
import { cn, formatPrice } from "@/lib/utils";
import type { AdminMemberCounts, AdminMemberOrder, AdminMemberRow, AdminMemberStats, WelcomeCodeState } from "@/lib/loyalty/admin/member-list";
import type { LoyaltyCouponView } from "@/lib/loyalty/coupons";
import type { LoyaltyLedgerEntry } from "@/lib/loyalty/types";

type Filter = "all" | "active" | "suspended";
type Sort = "newest" | "points";
type Detail = { orders: AdminMemberOrder[]; history: LoyaltyLedgerEntry[]; coupons: LoyaltyCouponView[] };

const PAGE = 30;
const MEMBER_ID = /^[A-Za-z0-9_-]{6,128}$/;
const COFFEE_CARD = 5;
/** The list's place (search, filters, how many shown, the open member, scroll) for "back" from an order. */
export const CLUB_MEMBERS_VIEW_KEY = "mishkat-admin-club-members";

type SavedView = { query: string; filter: Filter; sort: Sort; shown: number; selectedId: string | null; scrollY: number };

function readView(): Partial<SavedView> {
  try {
    return JSON.parse(window.sessionStorage.getItem(CLUB_MEMBERS_VIEW_KEY) || "{}") as Partial<SavedView>;
  } catch {
    return {};
  }
}

function dateText(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Asia/Jerusalem" });
}

const WELCOME_STYLE: Record<WelcomeCodeState, string> = {
  used: "text-emerald-700",
  active: "text-turquoise",
  expired: "text-amber-700",
  none: "text-coffee/50",
};

/**
 * Admin → Club → Members (Admin only). Name and email are shown here only. Orders count and total
 * leave out cancelled orders and card orders never paid. Order links open the admin order in this
 * tab; its "Back" returns here at the same place.
 */
export function ClubMembersTab({ tabs }: { tabs: ReactNode }) {
  const t = useT();
  const { dir } = useLocale();
  const adminPath = useAdminPath();
  const { firebaseUser, loading: authLoading } = useAuth();
  const [members, setMembers] = useState<AdminMemberRow[] | null>(null);
  const [counts, setCounts] = useState<AdminMemberCounts | null>(null);
  const [stats, setStats] = useState<Record<string, AdminMemberStats>>({});
  /** "denied": 401/403 (no "Try again"); "failed": the server could not load (with "Try again"). */
  const [error, setError] = useState<"denied" | "failed" | null>(null);
  const saved = useRef<Partial<SavedView>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [shown, setShown] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const restoredScroll = useRef(false);

  // Restore the place left when an order was opened from here.
  useEffect(() => {
    saved.current = readView();
    const v = saved.current;
    if (typeof v.query === "string") setQuery(v.query);
    if (v.filter === "active" || v.filter === "suspended" || v.filter === "all") setFilter(v.filter);
    if (v.sort === "points" || v.sort === "newest") setSort(v.sort);
    if (typeof v.shown === "number" && v.shown >= PAGE) setShown(v.shown);
    if (typeof v.selectedId === "string") setSelectedId(v.selectedId);
    // From Admin → Customers ("club member" badge): ?member=<id> opens that member's details.
    const url = new URL(window.location.href);
    const fromLink = url.searchParams.get("member");
    if (fromLink && MEMBER_ID.test(fromLink)) {
      setSelectedId(fromLink);
      url.searchParams.delete("member");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setMembers(null);
    const result = await clientAdminFetch<{ members: AdminMemberRow[]; counts: AdminMemberCounts }>("/api/admin/club/members", { action: "list" });
    if (result.ok && result.data) {
      setMembers(result.data.members);
      setCounts(result.data.counts);
    } else {
      // A failure is shown as a failure, never as "no club members yet"; no permission only on 401/403.
      setError(isPermissionDenied(result) ? "denied" : "failed");
    }
  }, []);

  // Asked only once the sign-in is restored (opening ?tab=members directly after a reload).
  useEffect(() => {
    if (authLoading || !firebaseUser) return;
    void load();
  }, [load, authLoading, firebaseUser]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (members ?? [])
      .filter((m) => filter === "all" || m.status === filter)
      .filter((m) => !q || m.name.toLocaleLowerCase().includes(q) || m.email.toLocaleLowerCase().includes(q))
      .sort((a, b) => (sort === "points" ? b.balancePoints - a.balancePoints || String(b.joinedAt).localeCompare(String(a.joinedAt)) : String(b.joinedAt ?? "").localeCompare(String(a.joinedAt ?? ""))));
  }, [members, query, filter, sort]);
  const visible = filtered.slice(0, shown);

  // Orders, total and the 10% code: only for the rows on screen.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const missing = visible.map((m) => m.id).filter((id) => !asked.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => asked.current.add(id));
    for (let i = 0; i < missing.length; i += PAGE) {
      const ids = missing.slice(i, i + PAGE);
      void clientAdminFetch<{ stats: Record<string, AdminMemberStats> }>("/api/admin/club/members", { action: "stats", memberIds: ids }).then((result) => {
        if (result.ok && result.data) setStats((s) => ({ ...s, ...result.data!.stats }));
        else ids.forEach((id) => asked.current.delete(id));
      });
    }
  }, [visible]);

  // Back from an order: the same scroll place once the list is there.
  useEffect(() => {
    if (restoredScroll.current || !members) return;
    restoredScroll.current = true;
    const y = saved.current.scrollY;
    if (typeof y === "number" && y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [members]);

  const remember = () => {
    try {
      window.sessionStorage.setItem(CLUB_MEMBERS_VIEW_KEY, JSON.stringify({ query, filter, sort, shown, selectedId, scrollY: window.scrollY } satisfies SavedView));
    } catch {
      // not kept
    }
  };
  // Keep the place up to date while working here (not only when leaving through an order link).
  useEffect(() => {
    if (members) remember();
  });

  const selected = members?.find((m) => m.id === selectedId) ?? null;
  const onStatusChanged = (id: string, status: AdminMemberRow["status"]) =>
    setMembers((list) => (list ?? []).map((m) => (m.id === id ? { ...m, status } : m)));

  const welcomeText = (state: WelcomeCodeState | undefined) => (state ? t(`admin.clubMembers.welcome.${state}`) : "…");

  return (
    <div className="space-y-5" data-club-members>
      <AdminPageHeader title={t("admin.club.title")} subtitle={t("admin.clubMembers.subtitle")} />
      {tabs}

      {counts && (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md" data-club-counters>
          <div className="rounded-2xl bg-warm-white p-4 shadow-soft dark:bg-white/5">
            <p className="text-2xl font-bold text-dark-brown dark:text-warm-white" data-count-total>{counts.total}</p>
            <p className="text-xs text-coffee/60">{t("admin.clubMembers.total")}</p>
          </div>
          <div className="rounded-2xl bg-warm-white p-4 shadow-soft dark:bg-white/5">
            <p className="text-2xl font-bold text-turquoise" data-count-month>+{counts.joinedThisMonth}</p>
            <p className="text-xs text-coffee/60">{t("admin.clubMembers.thisMonth")}</p>
          </div>
          {counts.incomplete > 0 && (
            <p className="col-span-2 text-xs text-coffee/55" data-count-incomplete>
              {t("admin.clubMembers.incomplete").replace("{n}", String(counts.incomplete))}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="relative md:w-80">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder={t("admin.clubMembers.search")}
            className="h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white ps-9 pe-3 text-base lg:text-sm dark:bg-white/5"
            data-members-search
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "active", "suspended"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => {
                setFilter(f);
                setShown(PAGE);
              }}
              className={cn("h-9 rounded-full border px-3 text-sm font-semibold", filter === f ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70")}
              data-members-filter={f}
            >
              {t(`admin.clubMembers.filter.${f}`)}
            </button>
          ))}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label={t("admin.clubMembers.sort")}
            className="h-9 rounded-full border border-beige-dark/40 bg-warm-white px-3 text-base lg:text-sm"
            data-members-sort
          >
            <option value="newest">{t("admin.clubMembers.sort.newest")}</option>
            <option value="points">{t("admin.clubMembers.sort.points")}</option>
          </select>
        </div>
      </div>

      {error ? (
        error === "denied" ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900" data-members-error="denied">
            {t("admin.clubMembers.adminOnly")}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" data-members-error="failed">
            <p>{t("admin.clubMembers.error")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} data-members-retry>
              {t("admin.action.retry")}
            </Button>
          </div>
        )
      ) : members === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-beige-dark/40 p-6 text-center text-sm text-coffee/60" data-members-empty>
          {t(members.length === 0 ? "admin.clubMembers.empty" : "admin.clubMembers.none")}
        </p>
      ) : (
        <>
          {/* Phone: cards. */}
          <ul className="space-y-3 md:hidden" data-members-cards>
            {visible.map((m) => {
              const s = stats[m.id];
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => setSelectedId(m.id)} className="w-full rounded-2xl bg-warm-white p-4 text-start shadow-soft dark:bg-white/5" data-member={m.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-dark-brown dark:text-warm-white">{m.name || "—"}</p>
                        <p className="truncate text-xs text-coffee/60" dir="ltr">{m.email}</p>
                      </div>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-2 text-sm text-coffee/80">
                      {t("admin.clubMembers.pointsShort").replace("{n}", String(m.balancePoints))} · ☕ {m.coffeeCups % COFFEE_CARD}/{COFFEE_CARD} ·{" "}
                      {s ? t("admin.clubMembers.ordersShort").replace("{n}", String(s.orders)) : "…"}
                    </p>
                    <p className="mt-0.5 text-xs text-coffee/60">
                      {s ? formatPrice(s.total) : "…"} · {t("admin.clubMembers.welcomeLabel")}: <span className={s ? WELCOME_STYLE[s.welcome] : ""}>{welcomeText(s?.welcome)}</span>
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Desktop: table. */}
          <div className="hidden overflow-x-auto rounded-2xl bg-warm-white shadow-soft md:block dark:bg-white/5">
            <table className="w-full text-sm" data-members-table>
              <thead className="border-b border-beige-dark/20 text-xs text-coffee/60">
                <tr>
                  {["name", "email", "joined", "points", "coffee", "orders", "total", "welcome", "status"].map((col) => (
                    <th key={col} className="px-3 py-2.5 text-start font-semibold">
                      {t(`admin.clubMembers.col.${col}`)}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => {
                  const s = stats[m.id];
                  return (
                    <tr key={m.id} onClick={() => setSelectedId(m.id)} className="cursor-pointer border-b border-beige-dark/10 last:border-0 hover:bg-beige/30" data-member={m.id}>
                      <td className="px-3 py-2.5 font-semibold">{m.name || "—"}</td>
                      <td className="px-3 py-2.5 text-coffee/70" dir="ltr">{m.email}</td>
                      <td className="px-3 py-2.5">{dateText(m.joinedAt)}</td>
                      <td className="px-3 py-2.5" data-member-points>{m.balancePoints}</td>
                      <td className="px-3 py-2.5">{m.coffeeCups % COFFEE_CARD}/{COFFEE_CARD}</td>
                      <td className="px-3 py-2.5" data-member-orders>{s ? s.orders : "…"}</td>
                      <td className="px-3 py-2.5">{s ? formatPrice(s.total) : "…"}</td>
                      <td className={cn("px-3 py-2.5", s && WELCOME_STYLE[s.welcome])}>{welcomeText(s?.welcome)}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={m.status} /></td>
                      <td className="px-2 py-2.5 text-coffee/40">
                        <ChevronLeft className="h-4 w-4 ltr:rotate-180" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > shown && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => setShown((n) => n + PAGE)} data-members-more>
                {t("admin.clubMembers.more")}
              </Button>
            </div>
          )}
        </>
      )}

      {selected && (
        <MemberDetail
          dir={dir}
          member={selected}
          stats={stats[selected.id]}
          orderHref={(id) => `${adminPath("orders")}?order=${encodeURIComponent(id)}&from=club`}
          onOpenOrder={remember}
          onClose={() => setSelectedId(null)}
          onStatusChanged={onStatusChanged}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdminMemberRow["status"] }) {
  const t = useT();
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600")} data-member-status={status}>
      {t(`admin.clubMembers.status.${status}`)}
    </span>
  );
}

function MemberDetail({
  dir,
  member,
  stats,
  orderHref,
  onOpenOrder,
  onClose,
  onStatusChanged,
}: {
  dir: "rtl" | "ltr";
  member: AdminMemberRow;
  stats: AdminMemberStats | undefined;
  orderHref: (orderId: string) => string;
  onOpenOrder: () => void;
  onClose: () => void;
  onStatusChanged: (id: string, status: AdminMemberRow["status"]) => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [section, setSection] = useState<"orders" | "points" | "coupons">("orders");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setFailed(false);
    void clientAdminFetch<Detail>("/api/admin/club/members", { action: "detail", memberId: member.id }).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setDetail(result.data);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [member.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !confirming && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  const suspend = member.status === "active";
  const runAction = async () => {
    setBusy(true);
    setActionError(null);
    const result = await clientAdminFetch(suspend ? "/api/admin/club/suspend" : "/api/admin/club/resume", { memberId: member.id });
    setBusy(false);
    if (!result.ok) {
      setActionError(t("admin.clubMembers.error"));
      return;
    }
    onStatusChanged(member.id, suspend ? "suspended" : "active");
    setConfirming(false);
  };

  const s = stats;
  const sideClass = dir === "rtl" ? "md:left-auto md:right-0" : "md:right-auto md:left-0";
  return (
    <>
      <div className="fixed inset-0 z-[105] hidden bg-dark-brown/25 md:block" onClick={onClose} aria-hidden />
      <aside
        className={cn("fixed inset-0 z-[106] flex flex-col overflow-y-auto bg-cream md:w-[480px] md:shadow-elevated dark:bg-[#1a1412]", sideClass)}
        role="dialog"
        aria-modal="true"
        aria-label={member.name || member.email}
        data-member-detail={member.id}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-beige-dark/20 bg-cream px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:bg-[#1a1412]">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-lg font-bold text-dark-brown dark:text-warm-white">
              <span className="truncate">{member.name || "—"}</span>
              <StatusBadge status={member.status} />
            </p>
            <p className="truncate text-xs text-coffee/60">
              <span dir="ltr">{member.email}</span> · {t("admin.clubMembers.since").replace("{date}", dateText(member.joinedAt))}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-beige/50" aria-label={t("admin.clubMembers.close")} data-member-close>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-warm-white p-3 shadow-soft dark:bg-white/5">
              <p className="text-xl font-bold">{member.balancePoints}</p>
              <p className="text-[11px] text-coffee/60">{t("admin.clubMembers.col.points")}</p>
            </div>
            <div className="rounded-2xl bg-warm-white p-3 shadow-soft dark:bg-white/5">
              <p className="flex items-center justify-center gap-1 text-xl font-bold">
                <Coffee className="h-4 w-4 text-turquoise" /> {member.coffeeCups % COFFEE_CARD}/{COFFEE_CARD}
              </p>
              <p className="text-[11px] text-coffee/60">{t("admin.clubMembers.col.coffee")}</p>
            </div>
            <div className="rounded-2xl bg-warm-white p-3 shadow-soft dark:bg-white/5">
              <p className="text-xl font-bold">{s ? s.orders : "…"}</p>
              <p className="text-[11px] text-coffee/60">{t("admin.clubMembers.col.orders")}</p>
            </div>
          </div>
          <p className="text-sm text-coffee/75">
            {t("admin.clubMembers.col.total")}: {s ? formatPrice(s.total) : "…"} · {t("admin.clubMembers.welcomeLabel")}:{" "}
            {s ? <span className={WELCOME_STYLE[s.welcome]}>{t(`admin.clubMembers.welcome.${s.welcome}`)}</span> : "…"}
          </p>

          <div className="flex gap-1 rounded-xl bg-beige/40 p-1" role="tablist">
            {(["orders", "points", "coupons"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={section === key}
                onClick={() => setSection(key)}
                className={cn("h-9 flex-1 rounded-lg text-sm font-semibold", section === key ? "bg-warm-white text-turquoise shadow-soft" : "text-coffee/65")}
                data-member-section={key}
              >
                {t(`admin.clubMembers.section.${key}`)}
              </button>
            ))}
          </div>

          {failed ? (
            <p className="text-sm text-red-700">{t("admin.clubMembers.error")}</p>
          ) : !detail ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-turquoise" />
            </div>
          ) : section === "orders" ? (
            detail.orders.length === 0 ? (
              <p className="text-sm text-coffee/60">{t("admin.clubMembers.noOrders")}</p>
            ) : (
              <ul className="space-y-2" data-member-orders-list>
                {detail.orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={orderHref(o.id)}
                      onClick={onOpenOrder}
                      className={cn("flex items-center justify-between gap-2 rounded-xl bg-warm-white px-3 py-2.5 text-sm shadow-soft hover:bg-beige/30 dark:bg-white/5", !o.counted && "opacity-60")}
                      data-member-order={o.orderNumber}
                    >
                      <span className="min-w-0">
                        <span className="font-semibold" dir="ltr">#{o.orderNumber}</span>
                        <span className="block text-xs text-coffee/60">
                          {dateText(o.createdAt)} · {t(`admin.clubMembers.type.${o.orderType}`, o.orderType)} · {t(`admin.clubMembers.orderStatus.${o.status}`, o.status)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 font-semibold">
                        {formatPrice(o.total)}
                        <ChevronLeft className="h-4 w-4 text-coffee/40 ltr:rotate-180" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : section === "points" ? (
            detail.history.length === 0 ? (
              <p className="text-sm text-coffee/60">{t("admin.clubMembers.noPoints")}</p>
            ) : (
              <ul className="space-y-2" data-member-points-list>
                {detail.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 rounded-xl bg-warm-white px-3 py-2.5 text-sm shadow-soft dark:bg-white/5">
                    <span className="min-w-0">
                      <span className="font-semibold">{t(`club.me.kind.${h.kind}`, h.kind)}</span>
                      <span className="block truncate text-xs text-coffee/60">
                        {dateText(h.createdAt)}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </span>
                    </span>
                    <span className={cn("shrink-0 font-semibold", h.points >= 0 ? "text-emerald-700" : "text-red-700")} dir="ltr">
                      {h.points > 0 ? `+${h.points}` : h.points}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : detail.coupons.length === 0 ? (
            <p className="text-sm text-coffee/60">{t("admin.clubMembers.noCoupons")}</p>
          ) : (
            <ul className="space-y-2" data-member-coupons-list>
              {detail.coupons.map((c) => (
                <li key={c.code} className="flex items-center justify-between gap-2 rounded-xl bg-warm-white px-3 py-2.5 text-sm shadow-soft dark:bg-white/5">
                  <span className="min-w-0">
                    <span className="font-mono font-semibold" dir="ltr">{c.code}</span>
                    <span className="block text-xs text-coffee/60">
                      {c.percent}% · {t("admin.clubMembers.until").replace("{date}", dateText(c.expiresAt))}
                    </span>
                  </span>
                  <span className={cn("shrink-0 text-xs font-semibold", WELCOME_STYLE[c.state])}>{t(`admin.clubMembers.welcome.${c.state}`)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-beige-dark/20 pt-4">
            <Button
              type="button"
              variant="outline"
              className={cn("w-full", suspend ? "border-red-200 text-red-700" : "border-emerald-300 text-emerald-700")}
              onClick={() => setConfirming(true)}
              data-member-action={suspend ? "suspend" : "resume"}
            >
              {t(suspend ? "admin.clubMembers.suspend" : "admin.clubMembers.resume")}
            </Button>
          </div>
        </div>
      </aside>

      <AdminModal open={confirming} onOpenChange={(next) => !busy && !next && setConfirming(false)} size="sm">
        <AdminModalHeader onClose={() => setConfirming(false)}>
          <AdminModalTitle>{t(suspend ? "admin.clubMembers.suspendTitle" : "admin.clubMembers.resumeTitle").replace("{name}", member.name || member.email)}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody className="space-y-2" data-member-confirm>
          <p className="flex items-start gap-2 text-sm text-coffee/80">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-turquoise" />
            {t(suspend ? "admin.clubMembers.suspendText" : "admin.clubMembers.resumeText")}
          </p>
          {actionError && <p className="text-sm text-red-700">{actionError}</p>}
        </AdminModalBody>
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
            {t("admin.clubMembers.cancel")}
          </Button>
          <Button
            type="button"
            className={suspend ? "bg-red-600 text-white hover:bg-red-700" : ""}
            disabled={busy}
            onClick={() => void runAction()}
            data-member-confirm-yes
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t(suspend ? "admin.clubMembers.suspend" : "admin.clubMembers.resume")}
          </Button>
        </AdminModalFooter>
      </AdminModal>
    </>
  );
}
