import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SamlConnectionsSection } from "./saml-connections-section";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

let items: unknown[] = [];

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
  formatDateMedium: (value: string) => value,
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
  useSamlConnections: () => ({ data: { items } }),
  useSamlConnectionDraft: (enabled: boolean) => ({
    data: enabled
      ? {
          key: "draftkey1234",
          acsUrl: "https://api.example/acs/draft",
          entityId: "https://api.example/metadata/draft",
        }
      : undefined,
  }),
}));
vi.mock(
  "@/hooks/mutations/instance-admin/use-identity-connection-mutations",
  () => ({
    useCreateSamlConnection: () => ({
      mutateAsync: m.create,
      isPending: false,
    }),
    useUpdateSamlConnection: () => ({
      mutateAsync: m.update,
      isPending: false,
    }),
    useDeleteSamlConnection: () => ({ mutateAsync: m.remove }),
  }),
);

const KEY = "instanceAdmin:identity.saml";
const NEXT_YEAR = new Date(Date.now() + 365 * 86_400_000).toISOString();
const CONNECTION = {
  id: "conn-1",
  name: "Company sign-in",
  domains: ["acme.example", "acme.test"],
  issuer: "https://idp.example/entity",
  entryPoint: "https://idp.example/sso",
  certificateFingerprint: "AB:CD",
  certificateExpiresAt: NEXT_YEAR,
  acsUrl: "https://api.example/acs/conn",
  entityId: "https://api.example/metadata/conn",
  metadataUrl: "https://api.example/metadata/conn",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const label = (name: string) => screen.getByLabelText(`${KEY}.${name}`);
const type = (element: HTMLElement, value: string) =>
  fireEvent.change(element, { target: { value } });

function fillRequired() {
  type(screen.getByLabelText("instanceAdmin:identity.name"), "Company sign-in");
  type(label("domains"), "Acme.example, acme.test");
  type(label("issuer"), "https://idp.example/entity");
  type(label("entryPoint"), "https://idp.example/sso");
  type(label("certificate"), "-----BEGIN CERTIFICATE-----");
}

describe("SamlConnectionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items = [];
  });
  afterEach(cleanup);

  it("says when nothing is connected", () => {
    render(<SamlConnectionsSection />);
    expect(screen.getByText(`${KEY}.none`)).toBeInTheDocument();
  });

  it("gives the addresses first and sends back their key when connecting", async () => {
    m.create.mockResolvedValue(CONNECTION);
    render(<SamlConnectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.connect` }));

    expect(await screen.findByLabelText(`${KEY}.acsUrl`)).toHaveValue(
      "https://api.example/acs/draft",
    );
    expect(label("entityId")).toHaveValue("https://api.example/metadata/draft");

    const confirm = screen.getByRole("button", {
      name: `${KEY}.connectConfirm`,
    });
    expect(confirm).toBeDisabled();
    fillRequired();
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        name: "Company sign-in",
        domains: ["acme.example", "acme.test"],
        issuer: "https://idp.example/entity",
        entryPoint: "https://idp.example/sso",
        certificate: "-----BEGIN CERTIFICATE-----",
        key: "draftkey1234",
      }),
    );
    expect(m.success).toHaveBeenCalledWith(`${KEY}.connected`);
  });

  it("explains a bad domain or sign-on address and holds the form", async () => {
    render(<SamlConnectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.connect` }));
    await screen.findByLabelText(`${KEY}.acsUrl`);
    fillRequired();
    type(label("domains"), "not a domain");
    expect(screen.getByText(`${KEY}.domainsInvalid`)).toBeInTheDocument();
    type(label("domains"), "acme.example");
    type(label("entryPoint"), "http://idp.example/sso");
    expect(screen.getByText(`${KEY}.entryPointInvalid`)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${KEY}.connectConfirm` }),
    ).toBeDisabled();
  });

  it("keeps the form open and shows why when the server refuses", async () => {
    m.create.mockRejectedValue(new Error("That certificate has expired."));
    render(<SamlConnectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.connect` }));
    await screen.findByLabelText(`${KEY}.acsUrl`);
    fillRequired();
    fireEvent.click(
      screen.getByRole("button", { name: `${KEY}.connectConfirm` }),
    );

    await waitFor(() =>
      expect(m.error).toHaveBeenCalledWith("That certificate has expired."),
    );
    expect(label("issuer")).toHaveValue("https://idp.example/entity");
    expect(m.success).not.toHaveBeenCalled();
  });

  it("sends only what changed, and keeps the certificate when none is pasted", async () => {
    items = [CONNECTION];
    m.update.mockResolvedValue(CONNECTION);
    render(<SamlConnectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.edit` }));

    expect(await screen.findByLabelText(`${KEY}.acsUrl`)).toHaveValue(
      "https://api.example/acs/conn",
    );
    type(label("entryPoint"), "https://idp.example/new");
    fireEvent.click(screen.getByRole("button", { name: "instanceAdmin:save" }));

    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        id: "conn-1",
        entryPoint: "https://idp.example/new",
      }),
    );
  });

  it("replaces the certificate when one is pasted", async () => {
    items = [CONNECTION];
    m.update.mockResolvedValue(CONNECTION);
    render(<SamlConnectionsSection />);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.edit` }));
    await screen.findByLabelText(`${KEY}.acsUrl`);
    type(label("certificate"), "new certificate");
    fireEvent.click(screen.getByRole("button", { name: "instanceAdmin:save" }));

    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        id: "conn-1",
        certificate: "new certificate",
      }),
    );
  });

  it("warns in words when a certificate has expired or soon will", () => {
    items = [
      {
        ...CONNECTION,
        id: "gone",
        certificateExpiresAt: "2020-01-01T00:00:00Z",
      },
      {
        ...CONNECTION,
        id: "soon",
        certificateExpiresAt: new Date(
          Date.now() + 5 * 86_400_000,
        ).toISOString(),
      },
    ];
    render(<SamlConnectionsSection />);
    expect(screen.getByText(`${KEY}.certificateExpired`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.certificateExpiring`)).toBeInTheDocument();
  });

  it("removes a connection only after confirming", async () => {
    items = [CONNECTION];
    m.remove.mockResolvedValue({ id: "conn-1", deleted: true });
    render(<SamlConnectionsSection />);
    fireEvent.click(
      screen.getByRole("button", { name: "instanceAdmin:identity.remove" }),
    );
    expect(m.remove).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "instanceAdmin:identity.remove",
    );
    if (!confirm) throw new Error("No confirm button");
    fireEvent.click(confirm);

    await waitFor(() => expect(m.remove).toHaveBeenCalledWith("conn-1"));
    expect(m.success).toHaveBeenCalledWith(`${KEY}.removed:Company sign-in`);
  });
});
