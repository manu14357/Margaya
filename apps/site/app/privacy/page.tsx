import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/legal-page";
import { privacyPolicy } from "@/lib/legal/privacy";
import { termsOfService } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: privacyPolicy.metaTitle,
  description: privacyPolicy.metaDescription,
  alternates: { canonical: privacyPolicy.path },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      document={privacyPolicy}
      related={{ label: termsOfService.title, href: termsOfService.path }}
    />
  );
}
