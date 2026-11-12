import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

const { AiContentLabel, AiGeneratedBadge } = await import("./ai-content-label");

const provenance = {
  source: "assist" as const,
  feature: "spec_draft",
  model: "model-fast",
  agentId: null,
  agentName: null,
  requestedById: "u1",
  generatedAt: "2026-11-13T10:00:00.000Z",
  editedById: null,
  editedByName: null,
  editedAt: null,
};

afterEach(cleanup);

describe("AiContentLabel", () => {
  it("renders nothing for human-written content", () => {
    const { container } = render(<AiContentLabel provenance={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels AI-written content and says how it was written", () => {
    render(<AiContentLabel provenance={provenance} />);
    expect(screen.getByText("ai:provenance.label")).toBeInTheDocument();
    // The details are in the tooltip and read out to screen readers.
    const details = screen.getByText(/ai:provenance\.byFeature/);
    expect(details).toHaveClass("sr-only");
    expect(details.textContent).toContain("ai:features.spec_draft");
    expect(details.textContent).toContain("model-fast");
  });

  it("names the agent that wrote it", () => {
    render(
      <AiContentLabel
        provenance={{
          ...provenance,
          source: "agent",
          feature: "agent_run",
          agentId: "a1",
          agentName: "Triage bot",
          model: null,
        }}
      />,
    );
    expect(screen.getByText(/ai:provenance\.byAgent/).textContent).toContain(
      "Triage bot",
    );
  });

  it("reads 'Edited by X, originally AI-generated' after a person's change", () => {
    render(
      <AiContentLabel
        provenance={{
          ...provenance,
          editedById: "u2",
          editedByName: "Mia",
          editedAt: "2026-11-13T11:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText(/ai:provenance\.edited/).textContent).toContain(
      "Mia",
    );
    expect(screen.queryByText("ai:provenance.label")).not.toBeInTheDocument();
  });
});

describe("AiGeneratedBadge", () => {
  it("shows the plain label", () => {
    render(<AiGeneratedBadge />);
    expect(screen.getByText("ai:provenance.label")).toBeInTheDocument();
  });
});
