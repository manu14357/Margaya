import { eq } from "drizzle-orm";
import db from "../../database";
import { workspaceBillingTable } from "../../database/schema";
import { isBillingEnabled } from "../config";
import { updateSubscriptionSeats } from "../creem-client";
import { billableMemberCount } from "../seats";

export async function syncWorkspaceSeats(workspaceId: string) {
  if (!isBillingEnabled()) {
    return;
  }

  const [billing] = await db
    .select()
    .from(workspaceBillingTable)
    .where(eq(workspaceBillingTable.workspaceId, workspaceId));

  if (
    !billing?.creemSubscriptionId ||
    !billing.creemProductId ||
    billing.plan !== "team" ||
    (billing.status !== "active" && billing.status !== "trialing")
  ) {
    return;
  }

  // Agents are members but never seats.
  const seats = Math.max(1, await billableMemberCount(workspaceId));
  if (seats === billing.seats) {
    return;
  }

  const result = await updateSubscriptionSeats({
    subscriptionId: billing.creemSubscriptionId,
    productId: billing.creemProductId,
    units: seats,
  });

  if (result.ok) {
    await db
      .update(workspaceBillingTable)
      .set({ seats })
      .where(eq(workspaceBillingTable.workspaceId, workspaceId));
  }
}
