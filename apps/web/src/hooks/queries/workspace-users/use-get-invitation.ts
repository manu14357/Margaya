import { useQuery } from "@tanstack/react-query";
import { AUTH_READ, authClient } from "@/lib/auth-client";

type GetInvitationRequest = {
  invitationId: string;
};

function useGetInvitation({ invitationId }: GetInvitationRequest) {
  return useQuery({
    queryKey: ["invitation", invitationId],
    enabled: !!invitationId,
    queryFn: async () => {
      const { data, error } = await authClient.organization.getInvitation({
        query: {
          id: invitationId,
        },
        fetchOptions: AUTH_READ,
      });

      if (error) {
        throw new Error(error.message || "Failed to get invitation");
      }

      return data;
    },
  });
}

export default useGetInvitation;
