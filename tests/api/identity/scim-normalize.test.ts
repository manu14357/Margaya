import { describe, expect, it } from "vitest";
import {
  SCIM_MAX_RESULTS,
  scimPage,
  scimUsersResponse,
} from "../../../apps/api/src/identity/scim-normalize";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

const list = (size: number) => ({
  schemas: [LIST_SCHEMA],
  totalResults: size,
  startIndex: 1,
  itemsPerPage: size,
  Resources: Array.from({ length: size }, (_, index) => ({
    id: `user-${String(index).padStart(4, "0")}`,
    userName: `person${index}@acme.example`,
    schemas: [USER_SCHEMA],
  })),
});

describe("SCIM paging", () => {
  it("holds at most the maximum, however many are asked for", () => {
    const answer = scimUsersResponse(list(SCIM_MAX_RESULTS + 20), {
      count: "100000",
    });
    expect(answer).toMatchObject({
      totalResults: SCIM_MAX_RESULTS + 20,
      startIndex: 1,
      itemsPerPage: SCIM_MAX_RESULTS,
    });

    const rest = scimUsersResponse(list(SCIM_MAX_RESULTS + 20), {
      startIndex: String(SCIM_MAX_RESULTS + 1),
    });
    expect(rest).toMatchObject({ startIndex: SCIM_MAX_RESULTS + 1 });
    expect(rest?.itemsPerPage).toBe(20);
  });

  it("reads startIndex and count as RFC 7644 (3.4.2.4) says", () => {
    expect(scimPage(undefined)).toEqual({
      startIndex: 1,
      count: SCIM_MAX_RESULTS,
    });
    expect(scimPage({ startIndex: "-4", count: "-1" })).toEqual({
      startIndex: 1,
      count: 0,
    });
    expect(scimPage({ startIndex: "3", count: "7" })).toEqual({
      startIndex: 3,
      count: 7,
    });
    expect(scimPage({ count: "ten" })).toBeNull();
    expect(scimPage({ startIndex: ["1", "2"] })).toBeNull();
  });
});
