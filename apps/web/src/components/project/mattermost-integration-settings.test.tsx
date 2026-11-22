import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MattermostIntegrationSettings } from "./mattermost-integration-settings";

const m = vi.hoisted(() => ({
  integration: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock(
  "@/hooks/queries/mattermost-integration/use-get-mattermost-integration",
  () => ({ default: () => ({ data: m.integration, isLoading: false }) }),
);

vi.mock(
  "@/hooks/mutations/mattermost-integration/use-mattermost-integration",
  () => {
    const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
    return {
      useCreateMattermostIntegration: mutation,
      useUpdateMattermostIntegration: mutation,
      useDeleteMattermostIntegration: mutation,
    };
  },
);

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("MattermostIntegrationSettings webhook field", () => {
  afterEach(cleanup);

  it("asks for a URL before the integration is connected", () => {
    m.integration = null;
    render(<MattermostIntegrationSettings projectId="project-1" />);
    const input = screen.getByLabelText(
      "settings:mattermostIntegration.webhookLabel",
    );
    expect(input).toHaveAttribute(
      "placeholder",
      "settings:mattermostIntegration.webhookPlaceholder",
    );
    expect(
      screen.getByText("settings:mattermostIntegration.webhookHint"),
    ).toBeInTheDocument();
  });

  it("shows the saved URL as set and hidden once connected", () => {
    m.integration = {
      id: "i-1",
      projectId: "project-1",
      webhookConfigured: true,
      maskedWebhookUrl: "https://chat.example.com/hooks/••••",
      channelName: null,
      isActive: true,
      events: {},
    };
    render(<MattermostIntegrationSettings projectId="project-1" />);
    const input = screen.getByLabelText(
      "settings:mattermostIntegration.webhookLabel",
    );
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute(
      "placeholder",
      "https://chat.example.com/hooks/••••",
    );
    expect(
      screen.getByText(
        'settings:mattermostIntegration.webhookHintConfigured {"masked":"https://chat.example.com/hooks/••••"}',
      ),
    ).toBeInTheDocument();
  });
});
