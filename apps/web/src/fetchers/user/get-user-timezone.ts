import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getUserTimezone() {
  const response = await client.user.timezone.$get();

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getUserTimezone;
