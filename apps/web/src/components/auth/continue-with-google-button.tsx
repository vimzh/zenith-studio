import { signInWithGoogle } from "@/actions/auth";
import { GoogleIcon } from "@/components/icons/google-icon";
import { Button } from "@/components/ui/button";
import { authContent } from "@/data/auth";
import { cn } from "@/lib/utils";

type ContinueWithGoogleButtonProps = {
  className?: string;
  disabled?: boolean;
  title?: string;
};

export function ContinueWithGoogleButton({
  className,
  disabled,
  title,
}: ContinueWithGoogleButtonProps) {
  return (
    <form
      action={signInWithGoogle}
      className={cn("w-full sm:w-fit", className)}
    >
      <Button
        aria-label={disabled ? authContent.oauthNotConfigured : undefined}
        className="h-10 w-full rounded-[4px]"
        disabled={disabled}
        title={title}
        type="submit"
        variant="outline"
      >
        <GoogleIcon aria-hidden="true" className="size-4" />
        {authContent.continueWithGoogle}
      </Button>
    </form>
  );
}
