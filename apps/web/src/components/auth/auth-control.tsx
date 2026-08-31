import { signOutFromGoogle } from "@/actions/auth";
import { auth } from "@/auth";
import { ContinueWithGoogleButton } from "@/components/auth/continue-with-google-button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { authContent } from "@/data/auth";

export async function AuthControl() {
  const isConfigured = Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET
  );

  if (!isConfigured) {
    return (
      <ContinueWithGoogleButton
        disabled
        title={authContent.oauthNotConfigured}
      />
    );
  }

  const session = await auth();

  if (!session?.user) {
    return <ContinueWithGoogleButton />;
  }

  const accountName =
    session.user.name ?? session.user.email ?? authContent.googleAccount;

  return (
    <form action={signOutFromGoogle}>
      <Button
        aria-label={`${authContent.signOut}: ${accountName}`}
        className="h-10 rounded-[4px]"
        title={accountName}
        type="submit"
        variant="outline"
      >
        <Avatar size="sm">
          <AvatarImage alt="" src={session.user.image ?? undefined} />
          <AvatarFallback>{accountName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        {authContent.signOut}
      </Button>
    </form>
  );
}
