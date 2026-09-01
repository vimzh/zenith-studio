import { signInWithGoogle } from "@/actions/auth";
import { GoogleIcon } from "@/components/icons/google-icon";
import { Button } from "@/components/ui/button";
import { authContent } from "@/data/auth";
import { cn } from "@/lib/utils";

type ContinueWithGoogleButtonProps = {
  className?: string;
  disabled?: boolean;
  appearance?: "default" | "navbar";
  label?: string;
  showGoogleIcon?: boolean;
  title?: string;
};

export function ContinueWithGoogleButton({
  className,
  disabled,
  appearance = "default",
  label = authContent.continueWithGoogle,
  showGoogleIcon = true,
  title,
}: ContinueWithGoogleButtonProps) {
  return (
    <form
      action={signInWithGoogle}
      className={cn("w-full sm:w-fit", className)}
    >
      <Button
        aria-label={disabled ? authContent.oauthNotConfigured : undefined}
        className={cn(
          "h-11 w-full px-4 text-base shadow-none",
          appearance === "navbar" &&
            "rounded-md border-primary bg-primary text-primary-foreground hover:border-foreground hover:bg-foreground hover:text-background"
        )}
        disabled={disabled}
        title={title}
        type="submit"
        variant="outline"
      >
        {showGoogleIcon && (
          <GoogleIcon aria-hidden="true" className="size-4" />
        )}
        {label}
      </Button>
    </form>
  );
}
