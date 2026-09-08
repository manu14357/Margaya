import { z } from "../openapi";

export const taskSubscriptionParam = z.object({
  taskId: z.string().min(1),
});
