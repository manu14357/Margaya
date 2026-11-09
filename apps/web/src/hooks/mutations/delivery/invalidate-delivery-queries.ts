import type { QueryClient } from "@tanstack/react-query";
import { deliveryQueryKeys } from "@/hooks/queries/delivery/delivery-query-keys";

/**
 * Forecasts and risk radars after a change to what they read: one project's,
 * or every project's when the change doesn't name its project, plus Home's
 * risks, which read the current cycles of every project the viewer sees.
 * Only mounted queries refetch; the rest reload when they mount again.
 */
export function invalidateDeliveryQueries(
  queryClient: QueryClient,
  projectId?: string,
) {
  queryClient.invalidateQueries({
    queryKey: projectId
      ? deliveryQueryKeys.all(projectId)
      : deliveryQueryKeys.anyProject(),
  });
  queryClient.invalidateQueries({ queryKey: deliveryQueryKeys.anyHome() });
}
