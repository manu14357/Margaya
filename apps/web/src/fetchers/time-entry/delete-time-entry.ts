import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteTimeEntry(id: string) {
  const response = await client["time-entry"][":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteTimeEntry;
