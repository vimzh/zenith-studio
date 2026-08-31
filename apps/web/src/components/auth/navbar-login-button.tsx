import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavbarLoginButtonProps = ComponentProps<typeof Button>;

export function NavbarLoginButton({
  className,
  ...props
}: NavbarLoginButtonProps) {
  return (
    <Button
      {...props}
      className={cn(
        "h-11 rounded-[3px] border-primary bg-primary px-4 font-mono text-base text-primary-foreground shadow-none transition-colors hover:border-foreground hover:bg-foreground hover:text-background",
        className
      )}
      variant="outline"
    />
  );
}
