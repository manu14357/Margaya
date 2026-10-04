import { Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type LockedCalloutProps = { children: React.ReactNode };

/** Explains why controls are read-only (global lock, env-managed group). */
export function LockedCallout({ children }: LockedCalloutProps) {
  return (
    <Alert variant="warning">
      <Lock />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
