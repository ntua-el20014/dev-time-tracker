export function showNotification(message: string, durationMs = 3500) {
  // Remove any existing notification
  let notif = document.getElementById(
    "custom-notification"
  ) as HTMLDivElement | null;
  if (notif) notif.remove();

  notif = document.createElement("div");
  notif.id = "custom-notification";
  notif.textContent = message;
  notif.className = "custom-notification"; // Use CSS class for styling

  document.body.appendChild(notif);

  // Play system notification sound (if possible)
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Dev Time Tracker", { body: message });
    } else {
      // Fallback: play a short beep using Web Audio API
      const audioCtxCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new audioCtxCtor();
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.15);
      o.onended = () => ctx.close();
    }
  } catch {
    // Fallback if sound cannot be played
  }

  setTimeout(() => {
    notif!.style.opacity = "0";
    setTimeout(() => notif?.remove(), 350);
  }, durationMs);
}

export function showInAppNotification(message: string, durationMs = 3500) {
  // Remove any existing notification
  let notif = document.getElementById(
    "custom-notification"
  ) as HTMLDivElement | null;
  if (notif) notif.remove();

  notif = document.createElement("div");
  notif.id = "custom-notification";
  notif.textContent = message;
  notif.className = "custom-notification"; // Use CSS class for styling

  document.body.appendChild(notif);

  setTimeout(() => {
    notif!.style.opacity = "0";
    setTimeout(() => notif?.remove(), 350);
  }, durationMs);
}
