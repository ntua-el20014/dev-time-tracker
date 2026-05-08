type SidebarNotif = {
  id: string;
  title?: string;
  message: string;
  ts: number;
};

const NOTIF_CONTAINER_ID = "notificationSidebar";
const BELL_ID = "notifBell";

let notifs: SidebarNotif[] = [];

function ensureContainer(): HTMLDivElement {
  let c = document.getElementById(NOTIF_CONTAINER_ID) as HTMLDivElement | null;
  if (!c) {
    c = document.createElement("div");
    c.id = NOTIF_CONTAINER_ID;
    c.className = "notification-sidebar";
    document.body.appendChild(c);
  }
  return c;
}

function render() {
  const container = ensureContainer();
  container.innerHTML = `
    <div class="ns-header">
      <div class="ns-title">Notifications</div>
      <button id="ns-close" class="ns-close">×</button>
    </div>
    <div id="ns-list" class="ns-list"></div>
  `;

  const list = container.querySelector("#ns-list") as HTMLDivElement;
  notifs.forEach((n) => {
    const item = document.createElement("div");
    item.className = "ns-item";
    item.dataset.id = n.id;
    item.innerHTML = `
      <div class="ns-item-body">
        <div class="ns-item-title">${n.title ?? ""}</div>
        <div class="ns-item-message">${n.message}</div>
      </div>
      <button class="ns-item-close" aria-label="Dismiss">×</button>
    `;
    list.appendChild(item);
    const closeBtn = item.querySelector(".ns-item-close") as HTMLButtonElement;
    closeBtn.addEventListener("click", () => {
      dismiss(n.id);
    });
  });

  const close = container.querySelector("#ns-close") as HTMLButtonElement;
  close.addEventListener("click", () => toggle(false));
}

export function initNotificationSidebar() {
  // Wire bell button
  const bell = document.getElementById(BELL_ID) as HTMLButtonElement | null;
  if (bell) {
    bell.addEventListener("click", () => toggle());
  }
  // Ensure container exists but hidden
  const container = ensureContainer();
  container.style.display = "none";
}

export function toggle(force?: boolean) {
  const container = ensureContainer();
  const isOpen =
    container.style.display !== "none" && container.style.display !== "";
  const shouldOpen = typeof force === "boolean" ? force : !isOpen;
  container.style.display = shouldOpen ? "block" : "none";
  if (shouldOpen) render();
}

export function dismiss(id: string) {
  notifs = notifs.filter((n) => n.id !== id);
  render();
}

export function addSidebarNotification(payload: {
  title?: string;
  message: string;
}) {
  const id = `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const n = {
    id,
    title: payload.title,
    message: payload.message,
    ts: Date.now(),
  };
  // new ones on top
  notifs = [n, ...notifs];
  const container = ensureContainer();
  // If sidebar open, re-render to show new item; otherwise keep hidden
  if (container.style.display === "block") render();
}

export function clearAll() {
  notifs = [];
  render();
}

export function getNotifications(): SidebarNotif[] {
  return [...notifs];
}

export default {
  initNotificationSidebar,
  addSidebarNotification,
  toggle,
  dismiss,
  clearAll,
  getNotifications,
};
