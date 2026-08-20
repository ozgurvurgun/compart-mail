import { api } from "./api";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function registerPushWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export async function enablePush() {
  if (!("Notification" in window) || !("PushManager" in window)) {
    throw new Error("This browser cannot receive push alerts");
  }
  if (isIos() && !isStandalone()) {
    throw new Error("On iPhone, add Compart Mail to the Home Screen first, then enable alerts.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Alerts were not allowed");
  const registration = await registerPushWorker();
  if (!registration) throw new Error("Could not register the alert worker");
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("/api/push/vapid");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = subscription.toJSON();
  await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  }
}

export async function pushEnabled() {
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  return Boolean(subscription);
}
