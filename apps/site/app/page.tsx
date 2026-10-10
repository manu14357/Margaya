import { LandingPage } from "@margaya/landing";
import { faqJsonLd, JsonLd } from "@/components/landing/json-ld";
import { SiteLandingProviders } from "@/components/landing/site-landing";
import { landing } from "@/lib/landing";

export default function HomePage() {
  return (
    <>
      <JsonLd data={faqJsonLd(Object.values(landing.home.faq.items))} />
      <SiteLandingProviders localized>
        <LandingPage />
      </SiteLandingProviders>
    </>
  );
}
