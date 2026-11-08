import { useQuery } from "@tanstack/react-query";
import {
  draftSamlConnection,
  listSamlConnections,
  listScimConnections,
} from "@/fetchers/instance-admin/identity-connections";

export const identityConnectionKeys = {
  all: ["instance-admin", "identity"] as const,
  scim: () => ["instance-admin", "identity", "scim"] as const,
  saml: () => ["instance-admin", "identity", "saml"] as const,
  samlDraft: () => ["instance-admin", "identity", "saml-draft"] as const,
};

export function useScimConnections() {
  return useQuery({
    queryKey: identityConnectionKeys.scim(),
    queryFn: listScimConnections,
    refetchOnWindowFocus: true,
  });
}

export function useSamlConnections() {
  return useQuery({
    queryKey: identityConnectionKeys.saml(),
    queryFn: listSamlConnections,
    refetchOnWindowFocus: true,
  });
}

/**
 * Addresses for the identity provider's setup, before the connection exists.
 * Kept until the connection is made, so they stay the ones the admin copied.
 */
export function useSamlConnectionDraft(enabled: boolean) {
  return useQuery({
    queryKey: identityConnectionKeys.samlDraft(),
    queryFn: draftSamlConnection,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
