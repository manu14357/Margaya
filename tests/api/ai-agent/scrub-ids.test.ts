import { describe, expect, it } from "vitest";
import {
  idCandidates,
  type KnownEntity,
  scrubIds,
} from "../../../apps/api/src/ai-agent/scrub-ids";

const PAGE = "qwy490mvdt8dtvu555flh6gp";
const TASK = "t5k2mzx8q0w1e4r7y6u3i9op";
const PROJECT = "p0rj3ct7x9c2v5b8n1m4k6jh";
const USER = "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56";
const UNKNOWN = "zz99yy88xx77ww66vv55uu44";
const URL = `/dashboard/workspace/w1/project/${PROJECT}/pages/${PAGE}`;

const known = new Map<string, KnownEntity>([
  [PAGE, { kind: "page", label: "Login page specification", url: URL }],
  [TASK, { kind: "task", label: "WEB-7" }],
  [PROJECT, { kind: "project", label: "Website" }],
  [USER, { kind: "user", label: "Mia" }],
]);

describe("scrubIds", () => {
  it("drops id phrases from a parenthesis and keeps the rest", () => {
    expect(
      scrubIds(
        `Spec written on page: "Login page specification" (task WEB-7, page id ${PAGE}) — consolidated.`,
        known,
      ),
    ).toBe(
      'Spec written on page: "Login page specification" (task WEB-7) — consolidated.',
    );
    expect(scrubIds(`Updated the spec (page id ${PAGE}).`, known)).toBe(
      "Updated the spec.",
    );
    expect(scrubIds(`Done (project id: ${PROJECT}; ${USER}).`, known)).toBe(
      "Done.",
    );
    // A task keeps its key.
    expect(
      scrubIds(`Spec written (task ${TASK}, page id ${PAGE}).`, known),
    ).toBe("Spec written (task WEB-7).");
    expect(scrubIds(`Done (id: ${TASK}).`, known)).toBe("Done (WEB-7).");
  });

  it("replaces ids with links, keys and names", () => {
    expect(scrubIds(`See page id ${PAGE} for details.`, known)).toBe(
      `See page [Login page specification](${URL}) for details.`,
    );
    expect(
      scrubIds(`Task ${TASK} in ${PROJECT}, asked by ${USER}.`, known),
    ).toBe("Task WEB-7 in Website, asked by Mia.");
  });

  it("never touches code, link targets, URLs or tags", () => {
    const text = [
      `Run \`read_page ${PAGE}\` to check.`,
      "```",
      `pageId: ${PAGE}`,
      "```",
      `[the spec](${URL})`,
      `https://example.com/pages/${PAGE}`,
      `<margaya-mention id="${USER}" label="Mia"></margaya-mention>`,
    ].join("\n");
    expect(scrubIds(text, known)).toBe(text);
  });

  it("scrubs a link's text without nesting links", () => {
    expect(scrubIds(`[page ${PAGE}](${URL})`, known)).toBe(
      `[page "Login page specification"](${URL})`,
    );
  });

  it("leaves unknown ids and ordinary words alone", () => {
    const text = `Page id ${UNKNOWN} (id ${UNKNOWN}) and internationalization.`;
    expect(scrubIds(text, known)).toBe(text);
    expect(scrubIds(`Page ${PAGE}`, new Map())).toBe(`Page ${PAGE}`);
  });
});

describe("idCandidates", () => {
  it("finds id-like tokens outside code and link targets only", () => {
    const text = `Page ${PAGE}, \`${TASK}\`, [${USER}](${URL}) and plainword.`;
    expect(idCandidates(text).sort()).toEqual([PAGE, USER].sort());
  });
});
