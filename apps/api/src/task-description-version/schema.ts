import { z } from "../openapi";

export const descriptionVersionParam = z.object({
  id: z.string(),
  versionId: z.string(),
});
