/**
 * A light "logged in to the club" marker cookie the header can read, next to the real session
 * (which is httpOnly). It holds no data ("1"), proves nothing, and only switches the header
 * button to "My card"; /club/me still checks the real session.
 */

export const CLUB_HINT_COOKIE = "mkh_club_in";

export function hasClubHint(cookieString: string | undefined = typeof document !== "undefined" ? document.cookie : ""): boolean {
  return (cookieString ?? "").split(";").some((part) => part.trim() === `${CLUB_HINT_COOKIE}=1`);
}

/** Cookie options for setting (maxAge > 0) or clearing (maxAge 0) the marker. */
export function clubHintCookie(maxAgeSeconds: number) {
  return {
    name: CLUB_HINT_COOKIE,
    value: maxAgeSeconds > 0 ? "1" : "",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
