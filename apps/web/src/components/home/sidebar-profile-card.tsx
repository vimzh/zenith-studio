import { auth } from "@/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarFooter } from "@/components/ui/sidebar";
import { homeContent } from "@/data/home";

export async function SidebarProfileCard() {
  const isAuthConfigured = Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET
  );
  const user = isAuthConfigured ? (await auth())?.user : null;
  const name =
    user?.name ?? user?.email ?? homeContent.sidebar.profile.accountLabel;
  const detail = user
    ? (user.email ?? homeContent.sidebar.profile.signedInLabel)
    : homeContent.sidebar.profile.signedOutLabel;

  return (
    <SidebarFooter>
      <div className="flex min-w-0 items-center gap-3 rounded-lg bg-sidebar-accent p-2.5">
        <Avatar>
          <AvatarImage alt="" src={user?.image ?? undefined} />
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
