import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CreateSource,
  EMPTY_FORM,
  type SetupForm,
  type Suggestion,
} from "./create-flow-model";
import { DEFAULT_PROJECT_FEATURES } from "./project-features";
import {
  ProjectSetupFields,
  type SetupCapabilities,
} from "./project-setup-fields";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./project-icon-picker", () => ({ ProjectIconPicker: () => null }));

const suggestion = (change: Partial<Suggestion> = {}): Suggestion => ({
  name: "HR requests",
  key: "HR",
  icon: "Users",
  features: { ...DEFAULT_PROJECT_FEATURES, intake: true, cycles: false },
  visibility: "restricted",
  sampleTaskCount: 6,
  hasLabels: true,
  templateId: "hr-service-desk",
  ...change,
});

const capabilities = (
  change: Partial<SetupCapabilities> = {},
): SetupCapabilities => ({
  canCreateTasks: true,
  canCreateLabels: true,
  aiAvailable: false,
  ...change,
});

function Harness({
  source = { kind: "template", id: "hr-service-desk" },
  caps = capabilities(),
  hint = suggestion(),
  onFeatureSpy = vi.fn(),
}: {
  source?: CreateSource;
  caps?: SetupCapabilities;
  hint?: Suggestion;
  onFeatureSpy?: (key: string, value: boolean) => void;
}) {
  const [form, setForm] = useState<SetupForm>(EMPTY_FORM);
  const [keyOpen, setKeyOpen] = useState(false);
  return (
    <ProjectSetupFields
      form={form}
      suggestion={hint}
      source={source}
      sampleData={form.sampleData ?? false}
      onChange={(change) => setForm((value) => ({ ...value, ...change }))}
      onFeature={(key, value) => {
        onFeatureSpy(key, value);
        setForm((current) => ({
          ...current,
          features: { ...current.features, [key]: value },
        }));
      }}
      capabilities={caps}
      errors={{}}
      keyConflict={null}
      keyOpen={keyOpen}
      onKeyOpen={setKeyOpen}
    />
  );
}

afterEach(cleanup);

describe("ProjectSetupFields", () => {
  it("prefills the template's name and preselects Restricted when suggested", () => {
    render(<Harness />);
    expect(
      screen.getByLabelText("common:modals.createProject.projectName"),
    ).toHaveValue("HR requests");
    const restricted = screen.getByRole("radio", {
      name: /common:modals.createProject.setup.privacyRestricted\b/,
    });
    expect(restricted).toBeChecked();
    expect(
      screen.getByText("common:modals.createProject.setup.privacySuggested"),
    ).toBeInTheDocument();
  });

  it("starts Open when the template does not suggest privacy", () => {
    render(<Harness hint={suggestion({ visibility: "open" })} />);
    expect(
      screen.getByRole("radio", {
        name: /common:modals.createProject.setup.privacyOpen\b/,
      }),
    ).toBeChecked();
  });

  it("toggles features that stay on", () => {
    const onFeatureSpy = vi.fn();
    render(<Harness onFeatureSpy={onFeatureSpy} />);
    fireEvent.click(
      screen.getByText("common:modals.createProject.setup.featuresTitle"),
    );
    const intake = screen.getByRole("switch", {
      name: "settings:projectFeatures.items.intake.title",
    });
    expect(intake).toBeChecked();
    fireEvent.click(intake);
    expect(onFeatureSpy).toHaveBeenCalledWith("intake", false);
    expect(intake).not.toBeChecked();
    // AI only shows while workspace AI is on.
    expect(
      screen.queryByRole("switch", {
        name: "settings:projectFeatures.items.ai.title",
      }),
    ).toBeNull();
  });

  it("shows the AI switch when AI is available", () => {
    render(<Harness caps={capabilities({ aiAvailable: true })} />);
    fireEvent.click(
      screen.getByText("common:modals.createProject.setup.featuresTitle"),
    );
    expect(
      screen.getByRole("switch", {
        name: "settings:projectFeatures.items.ai.title",
      }),
    ).toBeInTheDocument();
  });

  it("offers example tasks off by default, only with task:create", () => {
    const { unmount } = render(<Harness />);
    const examples = screen.getByRole("switch", {
      name: "common:modals.createProject.setup.examples",
    });
    expect(examples).not.toBeChecked();
    fireEvent.click(examples);
    expect(examples).toBeChecked();
    unmount();

    render(<Harness caps={capabilities({ canCreateTasks: false })} />);
    expect(
      screen.queryByRole("switch", {
        name: "common:modals.createProject.setup.examples",
      }),
    ).toBeNull();
  });

  it("hides example tasks for templates without them and for project copies", () => {
    const { unmount } = render(
      <Harness hint={suggestion({ sampleTaskCount: 0 })} />,
    );
    expect(
      screen.queryByText("common:modals.createProject.setup.examples"),
    ).toBeNull();
    unmount();
    render(<Harness source={{ kind: "project", id: "p" }} />);
    expect(
      screen.queryByText("common:modals.createProject.setup.examples"),
    ).toBeNull();
    expect(
      screen.getByText("common:modals.createProject.includeTemplates"),
    ).toBeInTheDocument();
  });

  it("notes skipped labels without label:create", () => {
    render(<Harness caps={capabilities({ canCreateLabels: false })} />);
    expect(
      screen.getByText("common:modals.createProject.setup.labelsSkipped"),
    ).toBeInTheDocument();
  });

  it("opens the key editor and derives the key from a typed name", () => {
    render(<Harness />);
    fireEvent.change(
      screen.getByLabelText("common:modals.createProject.projectName"),
      { target: { value: "People Ops" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "common:modals.createProject.setup.keyChange",
      }),
    );
    expect(
      screen.getByLabelText("common:modals.createProject.setup.keyLabel"),
    ).toHaveValue("PO");
  });
});
