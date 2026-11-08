import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScimConnectionsSection } from "./scim-connections-section";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  rotate: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

let connections: { baseUrl: string; items: unknown[] };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name !== undefined ? `${key}:${options.name}` : key,
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: m.error },
}));
vi.mock("@/lib/format", () => ({
  formatNumber: (value: number) => String(value),
}));
vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: vi.fn(async () => true),
}));
vi.mock("./instance-page", () => ({
  InstanceLoadState: () => null,
  InstanceSection: ({
    actions,
    children,
  }: {
    actions?: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {actions}
      {children}
    </section>
  ),
}));
vi.mock("@/hooks/queries/instance-admin/use-identity-connections", () => ({
  useScimConnections: () => ({ data: connections }),
}));
vi.mock("@/hooks/queries/instance-admin/use-instance-admin", () => ({
  useInstanceWorkspaces: () => ({
    data: {
      pages: [
        {
          items: [
            { id: "ws-1", name: "Acme" },
            { id: "ws-2", name: "Other" },
          ],
        },
      ],
    },
    hasNextPage: false,
  }),
}));
vi.mock(
  "@/hooks/mutations/instance-admin/use-identity-connection-mutations",
  () => ({
    useCreateScimConnection: () => ({
      mutateAsync: m.create,
      isPending: false,
    }),
    useRotateScimConnectionToken: () => ({ mutateAsync: m.rotate }),
    useDeleteScimConnection: () => ({ mutateAsync: m.remove }),
  }),
);
// A plain select stands in: the popup needs layout jsdom doesn't have.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    onValueChange,
    children,
  }: {
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="workspace"
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const KEY = "instanceAdmin:identity.scim";
const CONNECTION = {
  id: "conn-1",
  name: "Company directory",
  workspaceId: "ws-1",
  workspaceName: "Acme",
  provisionedUsers: 12,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const ISSUED = {
  connection: CONNECTION,
  baseUrl: "https://api.example/api/auth/scim/v2",
  token: "one-time-token",
};

describe("ScimConnectionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connections = { baseUrl: ISSUED.baseUrl, items: [] };
  });
  afterEach(cleanup);

  it("says when nothing is connected", () => {
    render(<ScimConnectionsSection />);
    expect(screen.getByText(`${KEY}.none`)).toBeInTheDocument();
  });

  it("lists connections with the base URL and no token", () => {
    connections = { baseUrl: ISSUED.baseUrl, items: [CONNECTION] };
    render(<ScimConnectionsSection />);
    expect(screen.getByText("Company directory")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByLabelText(`${KEY}.baseUrl`)).toHaveValue(ISSUED.baseUrl);
    expect(screen.queryByLabelText(`${KEY}.token`)).toBeNull();
  });

  it("connects a provider for a workspace and shows its token once", async () => {
    m.create.mockResolvedValue(ISSUED);
    render(<ScimConnectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.connect` }));

    const confirm = screen.getByRole("button", {
      name: `${KEY}.connectConfirm`,
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("instanceAdmin:identity.name"), {
      target: { value: "  Company directory " },
    });
    fireEvent.change(screen.getByLabelText("workspace"), {
      target: { value: "ws-1" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        name: "Company directory",
        workspaceId: "ws-1",
      }),
    );
    expect(await screen.findByLabelText(`${KEY}.token`)).toHaveValue(
      "one-time-token",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:identity.done" }),
    );
    await waitFor(() =>
      expect(screen.queryByDisplayValue("one-time-token")).toBeNull(),
    );
  });

  it("keeps the form open when the server refuses", async () => {
    m.create.mockRejectedValue(new Error("This workspace is scheduled"));
    render(<ScimConnectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.connect` }));
    fireEvent.change(screen.getByLabelText("instanceAdmin:identity.name"), {
      target: { value: "Directory" },
    });
    fireEvent.change(screen.getByLabelText("workspace"), {
      target: { value: "ws-2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: `${KEY}.connectConfirm` }),
    );

    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith("This workspace is scheduled"),
    );
    expect(screen.getByLabelText("instanceAdmin:identity.name")).toHaveValue(
      "Directory",
    );
    expect(screen.queryByLabelText(`${KEY}.token`)).toBeNull();
  });

  it("replaces a token only after confirming, then shows the new one", async () => {
    connections = { baseUrl: ISSUED.baseUrl, items: [CONNECTION] };
    m.rotate.mockResolvedValue({ ...ISSUED, token: "new-token" });
    render(<ScimConnectionsSection />);

    fireEvent.click(screen.getByRole("button", { name: `${KEY}.rotate` }));
    expect(m.rotate).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: `${KEY}.rotateConfirm` }),
    );

    await waitFor(() => expect(m.rotate).toHaveBeenCalledWith("conn-1"));
    expect(await screen.findByLabelText(`${KEY}.token`)).toHaveValue(
      "new-token",
    );
  });

  it("removes a connection only after confirming", async () => {
    connections = { baseUrl: ISSUED.baseUrl, items: [CONNECTION] };
    m.remove.mockResolvedValue({ id: "conn-1", deleted: true });
    render(<ScimConnectionsSection />);

    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:identity.remove" }),
    );
    expect(m.remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(`${KEY}.removeDescription`);
    const buttons = Array.from(dialog.querySelectorAll("button"));
    const confirm = buttons.find(
      (button) => button.textContent === "instanceAdmin:identity.remove",
    );
    if (!confirm) throw new Error("No confirm button");
    fireEvent.click(confirm);

    await waitFor(() => expect(m.remove).toHaveBeenCalledWith("conn-1"));
    expect(m.success).toHaveBeenCalledWith(`${KEY}.removed:Company directory`);
  });
});
