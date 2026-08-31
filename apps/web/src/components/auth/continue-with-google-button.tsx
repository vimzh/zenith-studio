import { signInWithGoogle } from "@/actions/auth";
import { GoogleIcon } from "@/components/icons/google-icon";
import { NavbarLoginButton } from "@/components/auth/navbar-login-button";
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
  const AuthButton = appearance === "navbar" ? NavbarLoginButton : Button;

  return (
    <form
      action={signInWithGoogle}
      className={cn("w-full sm:w-fit", className)}
    >
      <AuthButton
        aria-label={disabled ? authContent.oauthNotConfigured : undefined}
        className={
          appearance === "navbar" ? "w-full" : "h-11 w-full rounded-[4px]"
        }
        disabled={disabled}
        title={title}
        type="submit"
        variant="outline"
      >
        {showGoogleIcon && (
          <GoogleIcon aria-hidden="true" className="size-4" />
        )}
        {label}
      </AuthButton>
    </form>
  );
}
