const dsn = import.meta.env.VITE_SENTRY_DSN ?? "";

// Start only with a real DSN, which is a URL. env.sh fills the
// "MARGAYA_SENTRY_DSN" placeholder at container start, with "" when unset.
// Vite inlines the placeholder, so the minifier folds away checks it can
// decide from it (such as `dsn &&`); this test survives into the build.
// The SDK, with tracing and session replay, loads only then: imported up
// front it was the largest part of every first page load.
if (/^https?:\/\//.test(dsn)) {
  import("./sentry")
    .then(({ initSentry }) => initSentry(dsn))
    // Reporting is best effort: a failed load must not become an app error.
    .catch(() => {});
}
