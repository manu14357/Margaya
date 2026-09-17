import getSettings from "../utils/get-settings";

// The instance-wide values public boards depend on (B12 K9, K20). Until the
// instance settings service (B12b) exists they come from the environment;
// B12b registers its effective snapshot with `setPublicBoardInstanceState`.

export type PublicBoardInstanceState = {
  /** `publicBoards.enabled`: off answers 404 on every board. */
  publicBoards: boolean;
  /** `publicBoards.participation`: off makes every board read-only. */
  participation: boolean;
  /** Guest sign-in is effectively available (today's guest access rule). */
  guestAccessActive: boolean;
  instanceName: string;
  signUpAvailable: boolean;
};

function fromEnvironment(): PublicBoardInstanceState {
  const settings = getSettings();
  return {
    publicBoards: process.env.DISABLE_PUBLIC_BOARDS !== "true",
    participation: true,
    guestAccessActive: settings.hasGuestAccess,
    instanceName: process.env.MARGAYA_INSTANCE_NAME?.trim() || "Margaya",
    signUpAvailable:
      !settings.disableRegistration && !settings.disablePasswordRegistration,
  };
}

type Provider = () =>
  | PublicBoardInstanceState
  | Promise<PublicBoardInstanceState>;

let provider: Provider = fromEnvironment;

/** B12b (and tests) plug in the effective instance settings here. */
export function setPublicBoardInstanceState(next: Provider | null) {
  provider = next ?? fromEnvironment;
}

export async function publicBoardInstanceState(): Promise<PublicBoardInstanceState> {
  return provider();
}
