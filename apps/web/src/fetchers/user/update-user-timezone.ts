import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function updateUserTimezone(timezone: string | null) {
  const response = await client.user.timezone.$put({ json: { timezone } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateUserTimezone;
