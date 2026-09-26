import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";

async function deleteCustomField({ id }: { id: string }) {
  const response = await client["custom-field"][":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteCustomField;
