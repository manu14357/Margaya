import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function stopTimeEntry(id: string) {
  const response = await client["time-entry"][":id"].stop.$post({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default stopTimeEntry;
