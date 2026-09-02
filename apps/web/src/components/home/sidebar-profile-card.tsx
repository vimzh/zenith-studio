import { auth } from "@/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarFooter } from "@/components/ui/sidebar";
import { homeContent } from "@/data/home";

/**
 * The signed-in identity shown at the foot of the sidebar.
 *
 * Deliberately **not** async. It sits inside `Sidebar`, which is a client
 * component, and an async component rendered in that subtree is treated as an
 * async Client Component — which React rejects. That threw during hydration and
 * took the whole page's error handling with it: six "suspended by an uncached
 * promise" errors, a TypeError out of react-dom, and
 * "Router action dispatched before initialization", which in turn made the first
 * Ctrl+K after a page load do nothing.
 *
 * So the awaiting happens at the route boundary instead: `AppShell` calls
 * {@link loadProfileUser} and passes the result down. Same behaviour, no async
 * component below a client one.
 */

export interface ProfileUser {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly image?: string | null;
}

/**
 * Resolves the signed-in user, or null when auth is not configured.
 *
 * The config guard matters: `auth()` throws without `AUTH_SECRET`, and this app
 * is deliberately usable with no login at all.
 */
export async function loadProfileUser(): Promise<ProfileUser | null> {
  const isAuthConfigured = Boolean(
    process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
  );
  if (!isAuthConfigured) return null;
  return (await auth())?.user ?? null;
}

export function SidebarProfileCard({ user }: { user: ProfileUser | null }) {
  if (user === null) return null;

  const name = user.name ?? user.email ?? homeContent.sidebar.profile.signedInLabel;
  const detail = user.email ?? homeContent.sidebar.profile.signedInLabel;

  return (
    <SidebarFooter>
      <div className="flex min-w-0 items-center gap-3 rounded-lg bg-sidebar-accent p-2.5">
        <Avatar>
          <AvatarImage alt="" src={user.image ?? undefined} />
          <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </SidebarFooter>
  );
}
