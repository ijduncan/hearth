const worker = globalThis;

worker.addEventListener("install", () => {
  worker.skipWaiting();
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener("push", (event) => {
  const fallback = {
    title: "Hearth",
    body: "A quiet moment to check in with yourself.",
    url: "/",
    tag: "hearth-evening-reminder",
  };
  let payload = fallback;

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: typeof parsed.title === "string" ? parsed.title.slice(0, 80) : fallback.title,
        body: typeof parsed.body === "string" ? parsed.body.slice(0, 240) : fallback.body,
        url: typeof parsed.url === "string" ? parsed.url : fallback.url,
        tag: typeof parsed.tag === "string" ? parsed.tag.slice(0, 80) : fallback.tag,
      };
    } catch {
      payload = fallback;
    }
  }

  let destination = new URL(payload.url, worker.location.origin);
  if (destination.origin !== worker.location.origin) {
    destination = new URL("/", worker.location.origin);
  }

  event.waitUntil(
    worker.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/hearth-192.png",
      badge: "/icons/hearth-badge-96.png",
      tag: payload.tag,
      renotify: false,
      data: { url: destination.href },
    })
  );
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();

  let destination = new URL(event.notification.data?.url || "/", worker.location.origin);
  if (destination.origin !== worker.location.origin) {
    destination = new URL("/", worker.location.origin);
  }

  event.waitUntil(
    worker.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        const destinationClient = clientList.find((client) => {
          try {
            return new URL(client.url).href === destination.href;
          } catch {
            return false;
          }
        });
        if (destinationClient) {
          try {
            return await destinationClient.focus();
          } catch {
            // An installed WebKit app can briefly expose an inert WindowClient.
          }
        }

        const existingClient = clientList.find((client) => {
          try {
            return new URL(client.url).origin === worker.location.origin;
          } catch {
            return false;
          }
        });

        if (existingClient) {
          try {
            const navigatedClient = await existingClient.navigate(destination.href);
            if (navigatedClient) return navigatedClient.focus();
          } catch {
            // Some installed WebKit apps reject WindowClient.navigate().
          }

          try {
            const openedClient = await worker.clients.openWindow(destination.href);
            if (openedClient) return openedClient;
          } catch {
            // Focusing the existing app is still better than a dead tap target.
          }

          try {
            return await existingClient.focus();
          } catch {
            return undefined;
          }
        }

        return worker.clients.openWindow(destination.href);
      })
  );
});
