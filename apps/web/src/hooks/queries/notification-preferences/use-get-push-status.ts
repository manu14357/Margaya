import { useQuery } from "@tanstack/react-query";
import getPushStatus from "@/fetchers/notification-preferences/get-push-status";
import { getBrowserSubscription } from "@/lib/push";

export const PUSH_STATUS_QUERY_KEY = ["push-status"];

// This browser is on only when the server still lists its subscription: it may
// have been removed from another device, or dropped as dead.
async function getPushStatusForThisDevice() {
  const [status, subscription] = await Promise.all([
    getPushStatus(),
    getBrowserSubscription(),
  ]);
  const isThisDevice = (endpoint: string) =>
    endpoint === subscription?.endpoint;
  return {
    ...status,
    thisDevice:
      status.subscriptions.find((device) => isThisDevice(device.endpoint)) ??
      null,
    otherDevices: status.subscriptions.filter(
      (device) => !isThisDevice(device.endpoint),
    ),
  };
}

function useGetPushStatus() {
  return useQuery({
    queryFn: getPushStatusForThisDevice,
    queryKey: PUSH_STATUS_QUERY_KEY,
  });
}

export default useGetPushStatus;
