export const APP_VERSION = __APP_VERSION__;

export const CHANGELOG_URL =
  "https://github.com/manu14357/Margaya/blob/main/CHANGELOG.md";

/** The running version, linking to the changelog (used in the Help menu). */
export function VersionDisplay({ className }: { className?: string }) {
  return (
    <a
      href={CHANGELOG_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "font-mono text-muted-foreground text-xs transition-colors duration-200 hover:text-foreground"
      }
    >
      v{APP_VERSION}
    </a>
  );
}
