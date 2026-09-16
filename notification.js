const FOREVER_VAPID_PUBLIC_KEY = "BOn9dRXe6WDprYPc-wawn-i6qiyk3nq8Q1IMQQWHdUamphdeKm5knvBpaGtt6sTm4uEN66PYl42MtWKADocfipk";

let notificationUser = null;
let notificationButton = null;
let notificationInitialized = false;

function notificationBase64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function ensureNotificationStyles() {
  if (document.getElementById("forever-notification-styles")) return;
  const style = document.createElement("style");
  style.id = "forever-notification-styles";
  style.textContent = `
    .forever-notification-button { position: relative; }
    .forever-notification-button.is-enabled svg { stroke-width: 2.4; }
    .forever-notification-button.is-loading { opacity: .65; pointer-events: none; }
    .forever-notification-button .notification-dot { position:absolute; right:7px; top:7px; width:7px; height:7px; border-radius:50%; background:#2f6fed; box-shadow:0 0 0 2px var(--sidebar-bg, #fff); }
  `;
  document.head.appendChild(style);
}

function createNotificationButton() {
  if (notificationButton?.isConnected) return notificationButton;
  const logout = document.getElementById("logout-button");
  if (!logout?.parentElement) return null;
  ensureNotificationStyles();

  notificationButton = document.createElement("button");
  notificationButton.id = "notification-button";
  notificationButton.type = "button";
  notificationButton.className = "icon-button forever-notification-button";
  notificationButton.title = "Enable notifications";
  notificationButton.setAttribute("aria-label", "Enable notifications");
  notificationButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>`;
  notificationButton.addEventListener("click", enableForeverNotifications);
  logout.parentElement.insertBefore(notificationButton, logout);
  return notificationButton;
}

async function savePushSubscription(subscription) {
  const json = subscription.toJSON();
  if (!notificationUser || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Push subscription is incomplete.");
  }

  const { error } = await db.from("push_subscriptions").upsert({
    user_id: notificationUser.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString()
  }, { onConflict: "endpoint" });

  if (error) throw error;
}

async function refreshNotificationButton() {
  const button = createNotificationButton();
  if (!button) return;

  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    button.title = "Notifications are not supported in this browser";
    button.setAttribute("aria-label", "Notifications are not supported in this browser");
    button.disabled = true;
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const enabled = Notification.permission === "granted" && Boolean(subscription);
    button.classList.toggle("is-enabled", enabled);
    button.title = enabled ? "Notifications enabled" : "Enable notifications";
    button.setAttribute("aria-label", enabled ? "Notifications enabled" : "Enable notifications");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>${enabled ? '<span class="notification-dot"></span>' : ''}`;
  } catch (error) {
    console.warn("Forever notification state unavailable:", error);
  }
}

async function enableForeverNotifications() {
  const button = createNotificationButton();
  if (!button || button.disabled || !notificationUser) return;

  button.classList.add("is-loading");
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("Push notifications are not supported on this device/browser.");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied" ? "Notifications are blocked. Enable them in your browser or iPhone settings." : "Notification permission was not granted.");
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: notificationBase64UrlToUint8Array(FOREVER_VAPID_PUBLIC_KEY)
      });
    }

    await savePushSubscription(subscription);
    await refreshNotificationButton();
  } catch (error) {
    console.warn("Forever notifications could not be enabled:", error);
    alert(error.message || "Forever could not enable notifications.");
  } finally {
    button.classList.remove("is-loading");
  }
}

async function initializeForeverNotifications() {
  if (notificationInitialized) return;
  notificationInitialized = true;

  const { data: { session } } = await db.auth.getSession();
  notificationUser = session?.user || null;
  if (notificationUser) {
    createNotificationButton();
    await refreshNotificationButton();
  }

  db.auth.onAuthStateChange(async (_event, sessionData) => {
    notificationUser = sessionData?.user || null;
    if (notificationUser) {
      createNotificationButton();
      await refreshNotificationButton();
    } else if (notificationButton) {
      notificationButton.remove();
      notificationButton = null;
    }
  });
}

window.addEventListener("load", () => {
  initializeForeverNotifications().catch((error) => console.warn("Forever notifications init failed:", error));
});
