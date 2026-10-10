import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/legal-page";
import { privacyPolicy } from "@/lib/legal/privacy";
import { termsOfService } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: termsOfService.metaTitle,
  description: termsOfService.metaDescription,
  alternates: { canonical: termsOfService.path },
};

export default function TermsPage() {
  return (
    <LegalPage
      document={termsOfService}
      related={{ label: privacyPolicy.title, href: privacyPolicy.path }}
    />
  );
}
