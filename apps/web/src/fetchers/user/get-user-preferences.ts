import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getUserPreferences() {
  const response = await client.user.preferences.$get();

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getUserPreferences;
