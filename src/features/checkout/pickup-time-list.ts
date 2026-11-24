/** How many pickup times the open list shows: 6 at a time ("Show more" adds 6). Pure. */

export const PICKUP_TIMES_PAGE = 6;

/**
 * Times to show when the list opens: the first page, or enough whole pages to include
 * the selected time (so a chosen 18:30 is visible when the list is reopened).
 */
export function initialVisibleTimes(total: number, selectedIndex: number, page = PICKUP_TIMES_PAGE): number {
  if (total <= 0) return 0;
  const needed = selectedIndex >= 0 ? Math.ceil((selectedIndex + 1) / page) * page : page;
  return Math.min(total, Math.max(page, needed));
}

/** Times to show after one more "Show more". */
export function moreVisibleTimes(current: number, total: number, page = PICKUP_TIMES_PAGE): number {
  return Math.min(total, current + page);
}
