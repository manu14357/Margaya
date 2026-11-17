import { useT } from "../lib/i18n";
import type { QuickAddAttachment, QuickAddNotice } from "../lib/ipc";

function formatSize(bytes: number) {
  const locale = document.documentElement.lang || undefined;
  const [value, unit] =
    bytes >= 1024 * 1024
      ? [bytes / (1024 * 1024), "megabyte"]
      : [Math.max(bytes / 1024, 0.1), "kilobyte"];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
  }).format(value);
}

/** Files waiting to be attached to the new task, each removable. */
export function QuickAddAttachments({
  attachments,
  onRemove,
}: {
  attachments: QuickAddAttachment[];
  onRemove: (id: string) => void;
}) {
  const t = useT();
  if (attachments.length === 0) return null;
  return (
    <div className="stack attachments-block">
      <ul className="attachments" aria-label={t("quickAdd.attachments")}>
        {attachments.map((attachment) => (
          <li key={attachment.id} className="attachment">
            {attachment.preview ? (
              <img
                className="attachment-preview"
                src={attachment.preview}
                alt={t("quickAdd.previewAlt", { name: attachment.name })}
              />
            ) : null}
            <span className="attachment-name grow" title={attachment.name}>
              {attachment.name}
            </span>
            <span className="muted">{formatSize(attachment.size)}</span>
            <button
              type="button"
              className="chip-remove"
              aria-label={t("quickAdd.removeAttachment", {
                name: attachment.name,
              })}
              onClick={() => onRemove(attachment.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">{t("quickAdd.uploadHint")}</p>
    </div>
  );
}

const ERROR_NOTICES = new Set(["screenPermission", "screenshotFailed"]);

/** Why something from the screenshot, clipboard or Send to was left out. */
export function QuickAddNotices({ notices }: { notices: QuickAddNotice[] }) {
  const t = useT();
  if (notices.length === 0) return null;
  const noticeText = ({ kind, name = "" }: QuickAddNotice) => {
    switch (kind) {
      case "titleTrimmed":
        return t("quickAdd.notices.titleTrimmed");
      case "descriptionTrimmed":
        return t("quickAdd.notices.descriptionTrimmed");
      case "tooLarge":
        return t("quickAdd.notices.tooLarge", { name });
      case "tooMany":
        return t("quickAdd.notices.tooMany");
      case "notAFile":
        return t("quickAdd.notices.notAFile", { name });
      case "unreadable":
        return t("quickAdd.notices.unreadable", { name });
      case "clipboardEmpty":
        return t("quickAdd.notices.clipboardEmpty");
      case "screenPermission":
        return t("quickAdd.notices.screenPermission");
      case "screenshotFailed":
        return t("quickAdd.notices.screenshotFailed");
    }
  };
  return (
    <div className="stack">
      {notices.map((notice, index) => (
        <p
          // Notices come as one list per update and never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={`${notice.kind}-${index}`}
          className={
            ERROR_NOTICES.has(notice.kind) ? "message error" : "message warning"
          }
          role={ERROR_NOTICES.has(notice.kind) ? "alert" : "status"}
        >
          {noticeText(notice)}
        </p>
      ))}
    </div>
  );
}
