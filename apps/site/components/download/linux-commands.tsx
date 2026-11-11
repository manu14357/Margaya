"use client";

import type { DesktopFile, DesktopFileKey } from "@/lib/desktop-release";
import { linuxFileKeys } from "@/lib/desktop-system";
import { CodeBlock, type CodeBlockCopy } from "./code-block";
import { useDesktopPlatform } from "./desktop-platform";

/** File name patterns for the commands before the first release. */
const PATTERNS = {
  x64: {
    appImage: "Margaya_*_amd64.AppImage",
    deb: "Margaya_*_amd64.deb",
    rpm: "Margaya-*.x86_64.rpm",
  },
  arm: {
    appImage: "Margaya_*_aarch64.AppImage",
    deb: "Margaya_*_arm64.deb",
    rpm: "Margaya-*.aarch64.rpm",
  },
};

export type LinuxCommandsCopy = {
  appImage: string;
  deb: string;
  rpm: string;
  opensuse: string;
};

/**
 * One full-width block per way of installing, for the architecture picked
 * in the downloads list, using the release's real file names.
 */
export function LinuxCommands({
  files,
  copy,
  code,
}: {
  files: DesktopFile[];
  copy: LinuxCommandsCopy;
  code: CodeBlockCopy;
}) {
  const { linuxArch } = useDesktopPlatform();
  const keys = linuxFileKeys[linuxArch];
  const name = (key: DesktopFileKey, pattern: string) =>
    files.find((file) => file.key === key)?.name ?? pattern;
  const appImage = name(keys.appImage, PATTERNS[linuxArch].appImage);
  const deb = name(keys.deb, PATTERNS[linuxArch].deb);
  const rpm = name(keys.rpm, PATTERNS[linuxArch].rpm);

  return (
    <div className="flex flex-col gap-3">
      <CodeBlock
        label={copy.appImage}
        lines={[`chmod +x ${appImage}`, `./${appImage}`]}
        copy={code}
      />
      <CodeBlock
        label={copy.deb}
        lines={[`sudo apt install ./${deb}`]}
        copy={code}
      />
      <CodeBlock
        label={copy.rpm}
        lines={[`sudo dnf install ./${rpm}`]}
        copy={code}
      />
      <CodeBlock
        label={copy.opensuse}
        lines={[`sudo zypper install --allow-unsigned-rpm ./${rpm}`]}
        copy={code}
      />
    </div>
  );
}
