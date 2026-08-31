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

type AuthControlProps = {
  appearance?: "default" | "navbar";
  label?: string;
  showGoogleIcon?: boolean;
};

export async function AuthControl({
  appearance,
  label,
  showGoogleIcon,
}: AuthControlProps = {}) {
  const isConfigured = Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET
  );

  if (!isConfigured) {
    return (
      <ContinueWithGoogleButton
        appearance={appearance}
        disabled
        label={label}
        showGoogleIcon={showGoogleIcon}
        title={authContent.oauthNotConfigured}
      />
    );
  }

  const session = await auth();

  if (!session?.user) {
    return (
      <ContinueWithGoogleButton
        appearance={appearance}
        label={label}
        showGoogleIcon={showGoogleIcon}
      />
    );
  }

  const accountName =
    session.user.name ?? session.user.email ?? authContent.googleAccount;

  return (
    <form action={signOutFromGoogle}>
      <Button
        aria-label={`${authContent.signOut}: ${accountName}`}
        className="h-11 rounded-[4px]"
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
