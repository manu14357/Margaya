import { Skeleton } from "@/components/ui/skeleton";
import { AuthDivider } from "./divider";

export function SignInFormSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>

      <AuthDivider />

      <div className="space-y-3">
        <div className="space-y-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-full mt-4" />
      </div>

      <div className="text-center">
        <Skeleton className="h-4 w-48 mx-auto" />
      </div>
    </div>
  );
}
