// Writes packages/email/src/templates/messages.generated.ts from the `emails`
// namespace of i18n/*.json. `pnpm i18n:check` fails when it is out of date.
import fs from "node:fs/promises";
import {
  emailMessagesPath,
  readEmailMessages,
  renderEmailMessages,
} from "./email-messages.mjs";
import { loadLocales } from "./shared.mjs";

const { locales } = await loadLocales();
const { source, missing } = renderEmailMessages(locales);
if (missing) {
  console.error(`No "emails" namespace in: ${missing.join(", ")}.`);
  process.exit(1);
}

if ((await readEmailMessages()) === source) {
  console.log("Email messages are already up to date.");
} else {
  await fs.writeFile(emailMessagesPath, source);
  console.log("Wrote packages/email/src/templates/messages.generated.ts.");
}
