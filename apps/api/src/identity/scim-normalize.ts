// Identity providers don't all send what the SCIM plugin's validators accept.
// These turn the documented variations into the form it reads, before it runs.
// The one that matters most is `active`: the plugin only treats the exact string
// "false" as false, so a provider sending "False" would get a success answer for
// a deactivation that never happened.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function scimBoolean(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return value;
}

// A patch can name an attribute several ways: "userName", "/userName", or as a
// key in the value, at any depth. The plugin applies them all, so everything here
// reads them its way (its normalizePath and applyPatchValue), or what these checks
// see and what it writes would differ.
function attributeName(path: string): string {
  const trimmed = path.trim();
  const bare = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return `/${bare.replaceAll(".", "/")}`;
}

const operationPath = (operation: Json) =>
  typeof operation.path === "string" ? operation.path : "";

const operationName = (operation: Json) =>
  String(operation.op ?? "replace").toLowerCase();

function attributesOf(value: unknown, path: string): [string, unknown][] {
  if (!isObject(value)) return path ? [[attributeName(path), value]] : [];
  return Object.entries(value).flatMap(([key, nested]) =>
    attributesOf(nested, path ? `${path}.${key}` : key),
  );
}

function normalizeValue(value: unknown, path: string): unknown {
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizeValue(nested, path ? `${path}.${key}` : key),
      ]),
    );
  }
  const name = attributeName(path);
  if (name === "/active") return scimBoolean(value);
  if (name === "/userName" && typeof value === "string") {
    return value.trim().toLowerCase();
  }
  return value;
}

// Margaya keeps one address per account, which is also its userName, and the
// plugin reads a patch's address only from userName. A change to the work or
// primary email, or to all of them, is a change of userName, so every check on
// addresses applies to it. Other addresses, such as a home one, have nowhere to
// be kept.
const EMAILS_PATH =
  /^\/?emails(?:\[\s*(type|primary)\s+eq\s+"?([^"\]]*)"?\s*\])?(\.value)?$/i;

type AddressPath = { valueOnly: boolean; filtered: boolean };

function addressPath(path: string): AddressPath | null {
  const match = path.trim().match(EMAILS_PATH);
  if (!match) return null;
  const [, attribute, value = "", valueOnly] = match;
  if (attribute) {
    const wanted =
      attribute.toLowerCase() === "type"
        ? value.toLowerCase() === "work"
        : value.toLowerCase() === "true";
    if (!wanted) return null;
  }
  return { valueOnly: Boolean(valueOnly), filtered: Boolean(attribute) };
}

/**
 * The address an add or replace on an address path sets, or undefined when it
 * sets none this server keeps. Adding to the list without a primary or work
 * address adds one, which isn't the account's; replacing it names the first.
 */
function addressIn(value: unknown, target: AddressPath, isAdd: boolean) {
  if (target.valueOnly) return value;
  const list = Array.isArray(value) ? value : [value];
  const entries = list.filter(isObject);
  if (entries.length === 0) return Array.isArray(value) ? undefined : value;
  const chosen =
    entries.find((email) => scimBoolean(email.primary) === true) ??
    entries.find(
      (email) =>
        typeof email.type === "string" && email.type.toLowerCase() === "work",
    ) ??
    (target.filtered || !isAdd ? entries[0] : undefined);
  return chosen?.value;
}

function normalizeOperation(operation: unknown): unknown {
  if (!isObject(operation)) return operation;
  const path = operationPath(operation);
  const name = operationName(operation);
  // On one-valued attributes the two mean the same (RFC 7644, 3.5.2.1), except
  // that the plugin skips an "add" of the current value without undoing a change
  // made earlier in the same patch. A patch's last write then wouldn't be its
  // result, and the guards read its last write.
  const op = name === "add" ? { op: "replace" } : {};
  if (attributeName(path) === "/displayName") {
    return { ...operation, ...op, path: "name.formatted" };
  }
  const address = addressPath(path);
  if (address && name !== "remove") {
    const value = addressIn(operation.value, address, name === "add");
    if (value === undefined) return operation;
    return {
      ...operation,
      ...op,
      path: "userName",
      value: normalizeValue(value, "userName"),
    };
  }
  const normalized = {
    ...operation,
    ...op,
    value: normalizeValue(operation.value, path),
  };
  if (path || !isObject(normalized.value)) return normalized;

  const value: Json = { ...normalized.value };
  for (const key of Object.keys(value)) {
    if (attributeName(key) === "/displayName") {
      value["name.formatted"] ??= value[key];
      delete value[key];
      continue;
    }
    const target = addressPath(key);
    if (!target) continue;
    const found = addressIn(value[key], target, name === "add");
    delete value[key];
    // As in a full update, the email wins over userName.
    if (found !== undefined) value.userName = normalizeValue(found, "userName");
  }
  return { ...normalized, value };
}

function normalizeEmail(email: unknown): unknown {
  if (!isObject(email) || !("primary" in email)) return email;
  return { ...email, primary: scimBoolean(email.primary) };
}

/** A user resource (create and full update). */
export function normalizeScimUser(body: unknown): unknown {
  if (!isObject(body)) return body;
  const name = isObject(body.name) ? body.name : {};
  return {
    ...body,
    // The plugin refuses a userName with capitals; identity providers send them.
    ...(typeof body.userName === "string"
      ? { userName: body.userName.trim().toLowerCase() }
      : {}),
    ...("active" in body ? { active: scimBoolean(body.active) } : {}),
    ...(Array.isArray(body.emails)
      ? { emails: body.emails.map(normalizeEmail) }
      : {}),
    // The plugin reads only `name`, and would fall back to the email's first part.
    ...(typeof body.displayName === "string" && !name.formatted
      ? { name: { ...name, formatted: body.displayName } }
      : {}),
  };
}

export function normalizeScimPatch(body: unknown): unknown {
  if (!isObject(body) || !Array.isArray(body.Operations)) return body;
  return { ...body, Operations: body.Operations.map(normalizeOperation) };
}

// The attributes the plugin keeps from a patch.
const KEPT_ATTRIBUTES = new Set([
  "/active",
  "/externalId",
  "/userName",
  "/name/formatted",
  "/name/givenName",
  "/name/familyName",
]);

const NAME_ATTRIBUTES = new Set([
  "/name/formatted",
  "/name/givenName",
  "/name/familyName",
]);

// What a remove can take away here: the plugin applies no removal at all, so
// resolveScimPatch turns these into the replacement each one stands for.
const KEPT_REMOVALS = new Set(["/externalId", "/name", ...NAME_ATTRIBUTES]);

/**
 * Why a (normalized) patch's removal can't be done (RFC 7644, 3.5.2.2), or null.
 * Every account has an address, which is its userName, and is either active or
 * not, so neither can become unassigned. Reading a removed `active` as active
 * would let a removal lift a deactivation.
 */
export function scimPatchRemovalRefusal(
  body: unknown,
): { detail: string; scimType: string } | null {
  if (!isObject(body) || !Array.isArray(body.Operations)) return null;
  for (const operation of body.Operations.filter(isObject)) {
    if (operationName(operation) !== "remove") continue;
    const path = operationPath(operation);
    if (!path.trim()) {
      return {
        detail: "A remove operation needs a path",
        scimType: "noTarget",
      };
    }
    if (attributeName(path) === "/userName" || addressPath(path)) {
      return {
        detail:
          "Every account needs its email address, which is also its userName. Replace it instead.",
        scimType: "mutability",
      };
    }
    if (attributeName(path) === "/active") {
      return {
        detail:
          "active can't be removed: every account is either active or not. Set it to true or false.",
        scimType: "mutability",
      };
    }
  }
  return null;
}

/**
 * Whether a (normalized) patch only names attributes this server has nowhere to
 * keep, such as a job title or a phone number. Identity providers send these
 * routinely, and the plugin answers each with a 400, which providers report as a
 * failed sync. Malformed patches return false, so the plugin's validation answers.
 */
export function scimPatchChangesNothing(body: unknown): boolean {
  if (!isObject(body) || !Array.isArray(body.schemas)) return false;
  if (!Array.isArray(body.Operations) || body.Operations.length === 0) {
    return false;
  }
  return body.Operations.every((operation) => {
    if (!isObject(operation)) return false;
    const op = operationName(operation);
    if (op === "remove") {
      return !KEPT_REMOVALS.has(attributeName(operationPath(operation)));
    }
    if (op !== "add" && op !== "replace") return false;
    return !attributesOf(operation.value, operationPath(operation)).some(
      ([name]) => KEPT_ATTRIBUTES.has(name),
    );
  });
}

/** The address a user resource ends up with: what the plugin will store. */
export function scimResourceEmail(body: unknown): string | null {
  if (!isObject(body)) return null;
  const emails = Array.isArray(body.emails) ? body.emails.filter(isObject) : [];
  const chosen = emails.find((email) => email.primary === true) ?? emails[0];
  const value = chosen?.value ?? body.userName;
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

type NameParts = {
  formatted?: string;
  givenName?: string;
  familyName?: string;
};

// The plugin's getUserFullName: the formatted name, else the given and family
// names, else the address.
function fullName(email: string, name: NameParts): string {
  const formatted = name.formatted?.trim() ?? "";
  if (formatted) return formatted;
  if (name.givenName && name.familyName) {
    return `${name.givenName} ${name.familyName}`;
  }
  return name.givenName || name.familyName || email;
}

/**
 * The given and family names of an account's one name. Margaya keeps a single
 * name, so these are read from it: the first word, and the rest. A name that is
 * the account's address is the plugin's stand-in for no name, and has neither.
 */
export function scimNameParts(
  name: string,
  email: string,
): { givenName?: string; familyName?: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || name === email) return {};
  const [givenName, ...rest] = words;
  return rest.length > 0
    ? { givenName, familyName: rest.join(" ") }
    : { givenName };
}

/**
 * The name a (normalized) user resource gives the account: what the plugin will
 * store, which is the address when it has no name. Null when the plugin's
 * validation refuses the name anyway.
 */
export function scimResourceName(body: unknown): string | null {
  if (!isObject(body)) return null;
  const email = scimResourceEmail(body) ?? "";
  if (body.name === undefined) return email;
  if (!isObject(body.name)) return null;
  const { formatted, givenName, familyName } = body.name;
  const parts = [formatted, givenName, familyName];
  if (parts.some((part) => part !== undefined && typeof part !== "string")) {
    return null;
  }
  return fullName(email, body.name as NameParts);
}

type Account = { name: string; email: string };

/**
 * The name a (normalized) patch leaves the account with, or null when it names
 * none. resolveScimPatch writes exactly this, so the guards and the write agree.
 * A part replaces that part of the current name (RFC 7644, 3.5.2.3: parts a
 * value doesn't name stay), a formatted name replaces all of it, and a removed
 * name leaves the account named after its address, as the plugin does for a
 * person provisioned without one.
 */
export function scimPatchName(body: unknown, current: Account): string | null {
  if (!isObject(body) || !Array.isArray(body.Operations)) return null;
  const email = scimPatchEffects(body).email ?? current.email;
  const partsOf = (name: string) =>
    name === current.email ? {} : scimNameParts(name, email);
  let name: string | null = null;
  for (const operation of body.Operations.filter(isObject)) {
    const op = operationName(operation);
    const now = name ?? current.name;
    if (op === "remove") {
      const target = attributeName(operationPath(operation));
      if (target === "/name" || target === "/name/formatted") name = email;
      if (target === "/name/givenName") {
        name = fullName(email, { familyName: partsOf(now).familyName });
      }
      if (target === "/name/familyName") {
        name = fullName(email, { givenName: partsOf(now).givenName });
      }
      continue;
    }
    if (op !== "add" && op !== "replace") continue;
    const parts: NameParts = {};
    const attributes = attributesOf(operation.value, operationPath(operation));
    for (const [attribute, value] of attributes) {
      // scimPatchEffects refuses a name that isn't a string.
      if (typeof value !== "string") continue;
      if (attribute === "/name/formatted") parts.formatted = value;
      if (attribute === "/name/givenName") parts.givenName = value;
      if (attribute === "/name/familyName") parts.familyName = value;
    }
    if (Object.keys(parts).length === 0) continue;
    if (parts.formatted?.trim()) {
      name = parts.formatted.trim();
    } else if (
      parts.givenName === undefined &&
      parts.familyName === undefined
    ) {
      name = email;
    } else {
      const kept = partsOf(now);
      name = fullName(email, {
        givenName: parts.givenName ?? kept.givenName,
        familyName: parts.familyName ?? kept.familyName,
      });
    }
  }
  return name;
}

/**
 * What a (normalized) patch changes that the guards care about. `invalid` is a
 * value the plugin would misread: to it, anything but false means active, so a
 * garbled deactivation would answer success and reactivate the person. A name
 * that isn't a string would be stored as whatever it turns into.
 */
export function scimPatchEffects(body: unknown): {
  active: boolean | null;
  email: string | null;
  invalid: boolean;
} {
  const effects = {
    active: null as boolean | null,
    email: null as string | null,
    invalid: false,
  };
  if (!isObject(body) || !Array.isArray(body.Operations)) return effects;
  for (const operation of body.Operations.filter(isObject)) {
    const op = operationName(operation);
    if (op !== "add" && op !== "replace") continue;
    const attributes = attributesOf(operation.value, operationPath(operation));
    for (const [name, value] of attributes) {
      if (name === "/active") {
        if (typeof value === "boolean") effects.active = value;
        else effects.invalid = true;
      }
      if (name === "/userName") {
        if (typeof value === "string") effects.email = value;
        else effects.invalid = true;
      }
      if (NAME_ATTRIBUTES.has(name) && typeof value !== "string") {
        effects.invalid = true;
      }
    }
  }
  return effects;
}

/**
 * The (normalized, allowed) patch the plugin should apply. Operations it can't
 * apply as RFC 7644 means them are written as replacements at the end, where its
 * last write wins: the name as scimPatchName works it out, and, for an account
 * without an externalId, the address the plugin keeps in its place. That stand-in
 * follows the address, so adding the person again is still recognised, and a
 * name that is the address follows it too.
 */
export function resolveScimPatch(
  body: unknown,
  account: Account & { accountId: string },
): unknown {
  if (!isObject(body) || !Array.isArray(body.Operations)) return body;
  const email = scimPatchEffects(body).email ?? account.email;
  const named = scimPatchName(body, account);
  const name =
    named ??
    (account.name === account.email && email !== account.email ? email : null);

  let externalId = account.accountId !== account.email;
  let removed = false;
  for (const operation of body.Operations.filter(isObject)) {
    const op = operationName(operation);
    const path = operationPath(operation);
    if (op === "remove" && attributeName(path) === "/externalId") {
      externalId = false;
      removed = true;
    }
    if (
      (op === "add" || op === "replace") &&
      attributesOf(operation.value, path).some(([n]) => n === "/externalId")
    ) {
      externalId = true;
    }
  }

  const replacements: Json[] = [];
  if (name !== null) {
    replacements.push({ op: "replace", path: "name.formatted", value: name });
  }
  if (!externalId && (removed || account.accountId !== email)) {
    replacements.push({ op: "replace", path: "externalId", value: email });
  }
  if (replacements.length === 0) return body;
  return { ...body, Operations: [...body.Operations, ...replacements] };
}

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

const isUserResource = (value: unknown): value is Json =>
  isObject(value) &&
  typeof value.id === "string" &&
  Array.isArray(value.schemas) &&
  value.schemas.includes(USER_SCHEMA);

/**
 * A user resource as RFC 7643 reads it. The plugin reports the address it keeps
 * in place of a missing externalId, and of a missing name, as if the provider had
 * sent them; those read as unassigned here. The name gets its parts.
 */
function userView(resource: Json): Json {
  const view = { ...resource };
  const userName = typeof view.userName === "string" ? view.userName : "";
  if (typeof view.externalId !== "string" || view.externalId === userName) {
    delete view.externalId;
  }
  const formatted = isObject(view.name) ? view.name.formatted : undefined;
  if (typeof formatted !== "string" || !formatted || formatted === userName) {
    delete view.name;
    delete view.displayName;
  } else {
    view.name = { formatted, ...scimNameParts(formatted, userName) };
  }
  return view;
}

// Attributes always returned (RFC 7643, 3.1 and 7.: "id" is "always"), so
// neither parameter changes them.
const ALWAYS_RETURNED = new Set(["id", "schemas"]);
const CORE_USER_URN = `${USER_SCHEMA.toLowerCase()}:`;

type AttributePath = { name: string; sub: string | null };

/**
 * An attributes or excludedAttributes parameter (RFC 7644, 3.9): names separated
 * by commas, compared without case (RFC 7643, 2.1), optionally with the core
 * schema's URN in front and a sub-attribute after a dot.
 */
function attributeList(value: unknown): AttributePath[] {
  const text = Array.isArray(value) ? value.join(",") : value;
  if (typeof text !== "string") return [];
  return text
    .split(",")
    .map((item) => {
      let name = item.trim().toLowerCase();
      if (name.startsWith(CORE_USER_URN))
        name = name.slice(CORE_USER_URN.length);
      const dot = name.indexOf(".");
      return dot < 0
        ? { name, sub: null }
        : { name: name.slice(0, dot), sub: name.slice(dot + 1) };
    })
    .filter((path) => path.name);
}

function subAttributes(value: unknown, subs: Set<string>, keep: boolean) {
  const pick = (item: unknown) =>
    isObject(item)
      ? Object.fromEntries(
          Object.entries(item).filter(
            ([key]) => subs.has(key.toLowerCase()) === keep,
          ),
        )
      : item;
  const empty = (item: unknown) => isObject(item) && !Object.keys(item).length;
  if (Array.isArray(value)) {
    const items = value.map(pick).filter((item) => !empty(item));
    return items.length ? items : undefined;
  }
  const picked = pick(value);
  return empty(picked) ? undefined : picked;
}

const subsOf = (paths: AttributePath[]) =>
  new Set(paths.flatMap((path) => (path.sub === null ? [] : [path.sub])));

function project(
  resource: Json,
  attributes: AttributePath[],
  excluded: AttributePath[],
): Json {
  const result: Json = {};
  for (const [key, value] of Object.entries(resource)) {
    const lower = key.toLowerCase();
    if (ALWAYS_RETURNED.has(lower)) {
      result[key] = value;
      continue;
    }
    let kept: unknown = value;
    if (attributes.length > 0) {
      const named = attributes.filter((path) => path.name === lower);
      if (named.length === 0) continue;
      if (named.every((path) => path.sub !== null)) {
        kept = subAttributes(kept, subsOf(named), true);
      }
    }
    const dropped = excluded.filter((path) => path.name === lower);
    if (dropped.some((path) => path.sub === null)) continue;
    if (dropped.length > 0) kept = subAttributes(kept, subsOf(dropped), false);
    if (kept !== undefined) result[key] = kept;
  }
  return result;
}

/** The most people one list answer holds, announced as filter.maxResults. */
export const SCIM_MAX_RESULTS = 500;

type Page = { startIndex: number; count: number };

/**
 * The page a list request asks for (RFC 7644, 3.4.2.4), or null when startIndex
 * or count isn't a whole number. A startIndex below 1 reads as 1 and a negative
 * count as 0. Without a count, or above the maximum, a page holds the maximum.
 */
export function scimPage(
  query: Record<string, unknown> | undefined,
): Page | null {
  const read = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\s*-?\d+\s*$/.test(value)) return null;
    return Number(value);
  };
  const startIndex = read(query?.startIndex, 1);
  const count = read(query?.count, SCIM_MAX_RESULTS);
  if (startIndex === null || count === null) return null;
  return {
    startIndex: Math.max(1, startIndex),
    count: Math.min(SCIM_MAX_RESULTS, Math.max(0, count)),
  };
}

const byId = (a: Json, b: Json) =>
  a.id === b.id ? 0 : String(a.id) < String(b.id) ? -1 : 1;

/**
 * What a response from /Users should say instead of what the plugin returned, or
 * undefined to leave it as it is: each user resource as userView reads it, with
 * only the attributes the request asks for (RFC 7644, 3.4.2.5 and 3.9). The
 * plugin lists everyone it finds, in no set order, so a list is ordered by id
 * and cut to the page asked for here.
 */
export function scimUsersResponse(
  returned: unknown,
  query: Record<string, unknown> | undefined,
): Json | undefined {
  const attributes = attributeList(query?.attributes);
  const excluded = attributeList(query?.excludedAttributes);
  const shape = (resource: Json) =>
    project(userView(resource), attributes, excluded);
  if (isUserResource(returned)) return shape(returned);
  if (
    isObject(returned) &&
    Array.isArray(returned.schemas) &&
    returned.schemas.includes(LIST_SCHEMA) &&
    Array.isArray(returned.Resources)
  ) {
    const page = scimPage(query) ?? { startIndex: 1, count: SCIM_MAX_RESULTS };
    const users = returned.Resources.filter(isUserResource).sort(byId);
    const first = page.startIndex - 1;
    const resources = users.slice(first, first + page.count).map(shape);
    return {
      ...returned,
      totalResults: users.length,
      startIndex: page.startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }
  return undefined;
}

/** The plugin's ServiceProviderConfig, with the page size RFC 7643 (5.) asks for. */
export function scimServiceProviderConfig(returned: unknown): Json | undefined {
  if (!isObject(returned)) return undefined;
  const filter = isObject(returned.filter) ? returned.filter : {};
  return { ...returned, filter: { ...filter, maxResults: SCIM_MAX_RESULTS } };
}
