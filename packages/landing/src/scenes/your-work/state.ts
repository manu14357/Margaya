export const YOUR_WORK_TABS = ["assigned", "created", "subscribed"] as const;

export type YourWorkTab = (typeof YOUR_WORK_TABS)[number];

export type YourWorkState = { tab: YourWorkTab };

export type YourWorkAction = { type: "tab"; tab: YourWorkTab };

export function yourWorkReducer(
  state: YourWorkState,
  action: YourWorkAction,
): YourWorkState {
  switch (action.type) {
    case "tab":
      return state.tab === action.tab ? state : { tab: action.tab };
  }
}
