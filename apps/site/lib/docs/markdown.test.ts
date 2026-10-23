import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCodeMeta } from "./highlight";
import { renderDocMarkdown } from "./markdown";

afterEach(() => {
  vi.restoreAllMocks();
});

function render(markdown: string) {
  return renderDocMarkdown(markdown, { source: "test" }).html;
}

describe("callouts", () => {
  it("renders a titled, icon-led note for each kind", () => {
    for (const [tag, label] of [
      ["Note", "Note"],
      ["Info", "Info"],
      ["Tip", "Tip"],
      ["Check", "Success"],
      ["Warning", "Warning"],
      ["Danger", "Danger"],
    ]) {
      const html = render(`<${tag}>\nBody text.\n</${tag}>`);
      expect(html).toContain(
        `class="docs-callout docs-callout-${tag?.toLowerCase()}" role="note" aria-label="${label}"`,
      );
      expect(html).toContain(`<span>${label}</span>`);
      expect(html).toContain("<svg");
      expect(html).toContain("<p>Body text.</p>");
    }
  });

  it("gives Danger its own destructive style, not the warning one", () => {
    const html = render("<Danger>\nCareful.\n</Danger>");
    expect(html).toContain("docs-callout-danger");
    expect(html).not.toContain("docs-callout-warning");
  });

  it("uses a title attribute when one is given", () => {
    const html = render('<Warning title="Back up first">\nText\n</Warning>');
    expect(html).toContain("<span>Back up first</span>");
    expect(html).toContain('aria-label="Back up first"');
  });
});

describe("unknown components", () => {
  it("keeps their content and warns at build time", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = render('<Mystery kind="x">\nStill here.\n</Mystery>');
    expect(html).toContain("<p>Still here.</p>");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown MDX component <Mystery>"),
    );
  });

  it("leaves tag-like text inside inline code alone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = render("Use `<API URL>/api/auth` here.");
    expect(html).toContain("<code>&lt;API URL&gt;/api/auth</code>");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("headings", () => {
  it("adds an anchor link and collects the h2/h3 outline", () => {
    const { html, headings } = renderDocMarkdown(
      "## Set up\n\n### Set up\n\n#### Detail",
    );
    expect(html).toContain(
      '<h2 id="set-up">Set up<a class="docs-anchor" href="#set-up" aria-label="Link to this section">#</a></h2>',
    );
    expect(html).toContain('<h3 id="set-up-1">');
    expect(html).toContain('href="#detail"');
    expect(headings).toEqual([
      { id: "set-up", text: "Set up", depth: 2 },
      { id: "set-up-1", text: "Set up", depth: 3 },
    ]);
  });
});

describe("code blocks", () => {
  it("parses language, title and highlighted lines from the fence", () => {
    expect(parseCodeMeta('nginx title="margaya.conf" {1,3-4}')).toEqual({
      language: "nginx",
      title: "margaya.conf",
      lines: new Set([1, 3, 4]),
    });
    expect(parseCodeMeta("bash install.sh")).toMatchObject({
      language: "bash",
      title: "install.sh",
    });
  });

  it("highlights with dual-theme variables and adds a copy button", () => {
    const html = render("```bash\necho hello\n```");
    expect(html).toContain('class="docs-code" data-lang="bash"');
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
    expect(html).toContain('<span class="docs-code-lang">bash</span>');
    expect(html).toContain('data-copy aria-label="Copy code"');
  });

  it("shows a title bar for titled fences and marks highlighted lines", () => {
    const html = render("```yaml compose.yaml {2}\na: 1\nb: 2\n```");
    expect(html).toContain('<span class="docs-code-title">compose.yaml</span>');
    expect(html).toContain('class="line highlighted"');
  });

  it("escapes unknown languages as plain text", () => {
    const html = render("```mystery\n<b>x</b>\n```");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("does not treat indented component bodies as code", () => {
    const html = render('<Card title="A">\n    Indented body text.\n</Card>');
    expect(html).not.toContain("<pre");
    expect(html).toContain("Indented body text.");
  });
});

describe("code groups and tabs", () => {
  it("turns a CodeGroup into accessible tabs over its fences", () => {
    const html = render(
      "<CodeGroup>\n```bash cURL\ncurl x\n```\n\n```python Python\nprint(1)\n```\n</CodeGroup>",
    );
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>cURL</);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Python</);
    // Both panels are in the HTML, so the content reads without scripts.
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(html).toContain('data-tab-panel="cURL" data-active');
  });

  it("renders each Tab body as MDX", () => {
    const html = render(
      '<Tabs>\n<Tab title="Docker">\nRun **docker**.\n</Tab>\n<Tab title="Helm">\nRun helm.\n</Tab>\n</Tabs>',
    );
    expect(html).toContain(">Docker</button>");
    expect(html).toContain("<strong>docker</strong>");
    expect(html).toContain('data-tab-panel="Helm"');
  });
});

describe("cards and frames", () => {
  it("renders an icon tile, a stretched link and a call to action", () => {
    const html = render(
      '<CardGroup cols={3}>\n<Card title="Install" icon="rocket" href="/core/index" cta="Get started">\nBody\n</Card>\n</CardGroup>',
    );
    expect(html).toContain('<div class="docs-card-group" data-cols="3">');
    expect(html).toContain('<span class="docs-card-icon"><svg');
    expect(html).toContain(
      '<a class="docs-card-link" href="/core/index">Install</a>',
    );
    expect(html).toContain("Get started");
  });

  it("captions a frame", () => {
    const html = render(
      '<Frame caption="The board">\n![Board](/board.png)\n</Frame>',
    );
    expect(html).toContain('<figure class="docs-frame">');
    expect(html).toContain("<figcaption>The board</figcaption>");
  });

  it("renders Kbd inline", () => {
    expect(render("Press <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>.")).toContain(
      "<p>Press <kbd>Ctrl</kbd> + <kbd>K</kbd>.</p>",
    );
  });
});
