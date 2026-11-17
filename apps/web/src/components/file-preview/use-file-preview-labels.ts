import type { FilePreviewLabels } from "@margaya/file-preview";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * The preview package's strings in the user's language. Its templates use
 * `{name}` placeholders, which it fills itself, so each translation is
 * asked for with the placeholder as the value.
 */
export function useFilePreviewLabels(
  openExternal: string,
): Partial<FilePreviewLabels> {
  const { t, i18n } = useTranslation();
  const language = i18n?.language;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the language decides the strings; `t` follows it
  return useMemo(
    () => ({
      loading: t("common:filePreview.loading"),
      errorTitle: t("common:filePreview.errorTitle"),
      errorBody: t("common:filePreview.errorBody"),
      noPreview: t("common:filePreview.noPreview"),
      tooLarge: t("common:filePreview.tooLarge", { size: "{size}" }),
      truncated: t("common:filePreview.truncated", { size: "{size}" }),
      download: t("common:filePreview.download"),
      openExternal,
      toolbar: t("common:filePreview.toolbar"),
      more: t("common:filePreview.moreTools"),
      zoomIn: t("common:filePreview.zoomIn"),
      zoomOut: t("common:filePreview.zoomOut"),
      zoomReset: t("common:filePreview.resetZoom"),
      fitWidth: t("common:filePreview.fitWidth"),
      fitPage: t("common:filePreview.fitPage"),
      rotate: t("common:filePreview.rotate"),
      fullScreen: t("common:filePreview.fullScreen"),
      exitFullScreen: t("common:filePreview.exitFullScreen"),
      pageNumber: t("common:filePreview.pageNumber"),
      pageCount: t("common:filePreview.pageCount", { total: "{total}" }),
      pageLabel: t("common:filePreview.pageLabel", { page: "{page}" }),
      thumbnails: t("common:filePreview.thumbnails"),
      passwordProtected: t("common:filePreview.passwordProtected"),
      find: t("common:filePreview.find"),
      findPlaceholder: t("common:filePreview.findPlaceholder"),
      findNext: t("common:filePreview.findNext"),
      findPrevious: t("common:filePreview.findPrevious"),
      findCount: t("common:filePreview.position", {
        current: "{current}",
        total: "{total}",
      }),
      findNone: t("common:filePreview.findNone"),
      findClose: t("common:filePreview.findClose"),
      sheets: t("common:filePreview.sheets"),
      rowsTruncated: t("common:filePreview.rowsTruncated", { rows: "{rows}" }),
      previousSlide: t("common:filePreview.previousSlide"),
      nextSlide: t("common:filePreview.nextSlide"),
      slideCount: t("common:filePreview.slideCount", {
        current: "{current}",
        total: "{total}",
      }),
      slideLabel: t("common:filePreview.slideLabel", { number: "{number}" }),
      present: t("common:filePreview.present"),
      exitPresent: t("common:filePreview.exitPresent"),
      plainText: t("common:filePreview.plainText"),
      viewSource: t("common:filePreview.viewSource"),
      viewRendered: t("common:filePreview.viewRendered"),
      htmlNotice: t("common:filePreview.htmlNotice"),
      archiveName: t("common:filePreview.archiveName"),
      archiveSize: t("common:filePreview.archiveSize"),
      archiveModified: t("common:filePreview.archiveModified"),
      archiveItems: t("common:filePreview.archiveItems", { total: "{count}" }),
      archiveBack: t("common:filePreview.archiveBack"),
      archiveUp: t("common:filePreview.archiveUp"),
      archiveRoot: t("common:filePreview.archiveRoot"),
      archiveTooMany: t("common:filePreview.archiveTooMany", {
        limit: "{count}",
      }),
      archiveEntryTooLarge: t("common:filePreview.archiveEntryTooLarge"),
      archiveEncrypted: t("common:filePreview.archiveEncrypted"),
      archiveTooDeep: t("common:filePreview.archiveTooDeep", {
        depth: "{depth}",
      }),
      wireframe: t("common:filePreview.wireframe"),
      resetView: t("common:filePreview.resetView"),
      modelHint: t("common:filePreview.modelHint"),
    }),
    [t, language, openExternal],
  );
}
