import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic check only: no session cookie -> go to /login. Real authentication is the
 * API's SessionGuard (every /api call); a forged or expired cookie still gets a 401 there,
 * and the API clears it.
 *
 * Deliberately no "/login -> /" redirect for cookie holders: the proxy can't tell a valid
 * cookie from a stale one, and bouncing a stale cookie back to "/" caused a redirect loop.
 * The login page asks the API instead.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("pos_session");
  const isLogin = request.nextUrl.pathname === "/login";
  if (!hasSession && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // Pages only: never intercept the API proxy, Next internals, or static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest)$).*)"],
};
