import { HttpError } from "@/lib/http-error";

/** The error a failed API response becomes (its text is the message). */
export async function responseError(response: {
  status: number;
  text(): Promise<string>;
}): Promise<HttpError> {
  return new HttpError(response.status, await response.text());
}
