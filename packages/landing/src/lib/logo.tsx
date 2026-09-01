import { cn } from "./cn";

/**
 * The Margaya wordmark. Both apps serve `/logo-dark.svg` (for light
 * backgrounds) and `/logo-light.svg` (for dark ones) from `public/`.
 */
export function LandingLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img
        src="/logo-dark.svg"
        alt="Margaya"
        width={24}
        height={24}
        className="h-6 w-auto dark:hidden"
      />
      <img
        src="/logo-light.svg"
        alt="Margaya"
        width={24}
        height={24}
        className="hidden h-6 w-auto dark:block"
      />
    </span>
  );
}
