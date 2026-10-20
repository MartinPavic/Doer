/**
 * Opt-in crash reporting for the web and desktop UI. Does nothing (and downloads no SDK code) unless a DSN
 * is configured. Privacy: no breadcrumbs (they'd capture task titles typed into inputs and URLs), no user
 * identity, no request bodies, and every event is stripped of its request data before leaving the device.
 */
export async function initErrorReporting(opts: { dsn?: string; release?: string; environment?: string }) {
  if (!opts.dsn) return;
  const Sentry = await import("@sentry/browser");
  Sentry.init({
    dsn: opts.dsn,
    release: opts.release,
    environment: opts.environment,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [Sentry.dedupeIntegration(), Sentry.globalHandlersIntegration(), Sentry.functionToStringIntegration()],
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
}
