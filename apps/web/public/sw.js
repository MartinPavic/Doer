// Service worker: shows reminder pushes and focuses the app when one is clicked.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload: fall back to defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Doer reminder", {
      body: data.body || "",
      tag: data.reminderId, // a snooze/re-fire replaces the old notification instead of stacking
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins[0];
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
