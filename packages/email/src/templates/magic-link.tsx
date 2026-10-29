import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { emailCopy } from "./copy";
import { EmailShell, styles } from "./shell";

void React;

export type MagicLinkEmailProps = {
  magicLink: string;
  locale?: string | null;
};

const MagicLinkEmail = ({ magicLink, locale }: MagicLinkEmailProps) => {
  const copy = emailCopy(locale).magicLink;

  return (
    <EmailShell
      preview={copy.preview}
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <Section>
        <Link style={styles.button} href={magicLink}>
          {copy.cta}
        </Link>
        <Text style={styles.paragraph}>{copy.expiry}</Text>
        <Text style={styles.muted}>{copy.ignore}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

MagicLinkEmail.PreviewProps = {
  magicLink: "https://margaya.app",
  locale: "en-US",
} as MagicLinkEmailProps;

export default MagicLinkEmail;
