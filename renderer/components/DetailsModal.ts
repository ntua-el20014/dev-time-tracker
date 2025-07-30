import { ipcRenderer } from "electron";
import { formatTimeSpent } from "../../src/utils/timeFormat";
import { escapeHtml, getCurrentUserId, prettyDate, prettyTime } from "../utils";

export interface DetailsModalConfig {
  type: "app-date" | "session";
  data: {
    app?: string;
    date?: string;
    sessionId?: number;
    title?: string;
  };
  onClose?: () => void;
}

export function showDetailsModal(config: DetailsModalConfig) {
  // Remove any existing modal
  const existingModal = document.querySelector(".details-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal backdrop
  const backdrop = document.createElement("div");
  backdrop.className = "details-modal-backdrop";

  // Create modal container
  const modal = document.createElement("div");
  modal.className = "details-modal";

  // Create modal content
  const modalContent = document.createElement("div");
  modalContent.className = "details-modal-content";

  // Create header
  const header = document.createElement("div");
  header.className = "details-modal-header";

  const title = document.createElement("h2");
  if (config.type === "app-date") {
    title.textContent = `${config.data.app} - ${prettyDate(
      config.data.date || ""
    )}`;
  } else {
    title.textContent = `Session: ${config.data.title || "Untitled"}`;
  }

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.className = "details-modal-close";
  closeBtn.onclick = () => {
    backdrop.remove();
    config.onClose?.();
  };

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Create loading indicator
  const loading = document.createElement("div");
  loading.className = "details-modal-loading";
  loading.textContent = "Loading details...";

  modalContent.appendChild(header);
  modalContent.appendChild(loading);
  modal.appendChild(modalContent);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Load and display data
  loadDetailsData(config, modalContent, loading);

  // Close on backdrop click
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      backdrop.remove();
      config.onClose?.();
    }
  });

  // Close on escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      backdrop.remove();
      config.onClose?.();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

async function loadDetailsData(
  config: DetailsModalConfig,
  modalContent: HTMLElement,
  loading: HTMLElement
) {
  try {
    let detailsData: any = null;

    if (config.type === "app-date") {
      detailsData = await ipcRenderer.invoke(
        "get-usage-details-for-app-date",
        getCurrentUserId(),
        config.data.app,
        config.data.date
      );
    } else if (config.type === "session") {
      detailsData = await ipcRenderer.invoke(
        "get-usage-details-for-session",
        getCurrentUserId(),
        config.data.sessionId
      );
    }

    // Remove loading indicator
    loading.remove();

    // Create details content
    const details = document.createElement("div");
    details.className = "details-modal-body";

    if (config.type === "app-date" && Array.isArray(detailsData)) {
      renderAppDateDetails(
        details,
        detailsData,
        config.data.app || "",
        config.data.date || ""
      );
    } else if (config.type === "session" && detailsData) {
      renderSessionDetails(details, detailsData);
    } else {
      details.innerHTML = "<p>No details found.</p>";
    }

    modalContent.appendChild(details);
  } catch (error) {
    loading.textContent = "Failed to load details.";
    // Error logging removed for lint compliance
  }
}

function renderAppDateDetails(
  container: HTMLElement,
  data: any[],
  app: string,
  date: string
) {
  if (!data || data.length === 0) {
    container.innerHTML = `<p>No activity recorded for ${app} on ${prettyDate(
      date
    )}.</p>`;
    return;
  }

  // Group by language
  const grouped: { [language: string]: any[] } = {};
  data.forEach((entry) => {
    const lang = entry.language || "Unknown";
    if (!grouped[lang]) grouped[lang] = [];
    grouped[lang].push(entry);
  });

  const content = document.createElement("div");

  // Summary info
  const summary = document.createElement("div");
  summary.className = "details-summary";
  summary.innerHTML = `
    <p><strong>Total activities:</strong> ${data.length}</p>
    <p><strong>Languages used:</strong> ${Object.keys(grouped).join(", ")}</p>
    <p><strong>Time range:</strong> ${data[0]?.time} - ${
    data[data.length - 1]?.time
  }</p>
  `;
  content.appendChild(summary);

  // Detailed timeline
  const timeline = document.createElement("div");
  timeline.className = "details-timeline";

  const timelineTitle = document.createElement("h3");
  timelineTitle.textContent = "Activity Timeline";
  timeline.appendChild(timelineTitle);

  const table = document.createElement("table");
  table.className = "details-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Time</th>
        <th>Language</th>
        <th>File/Title</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  if (tbody) {
    data.forEach((entry) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${entry.time}</td>
        <td>${escapeHtml(entry.language || "Unknown")}</td>
        <td>${escapeHtml(entry.title)}</td>
      `;
      tbody.appendChild(row);
    });
  }

  timeline.appendChild(table);
  content.appendChild(timeline);
  container.appendChild(content);
}

function renderSessionDetails(container: HTMLElement, data: any) {
  if (!data || !data.session) {
    container.innerHTML = "<p>No session details found.</p>";
    return;
  }

  const { session, usage } = data;

  const content = document.createElement("div");

  // Session info
  const sessionInfo = document.createElement("div");
  sessionInfo.className = "details-session-info";

  const startTime = new Date(session.start_time);
  const endTime = new Date(startTime.getTime() + session.duration * 1000);

  sessionInfo.innerHTML = `
    <h3>Session Information</h3>
    <p><strong>Title:</strong> ${escapeHtml(session.title)}</p>
    <p><strong>Description:</strong> ${escapeHtml(
      session.description || "No description"
    )}</p>
    <p><strong>Start Time:</strong> ${prettyTime(session.start_time)}</p>
    <p><strong>Duration:</strong> ${formatTimeSpent(session.duration)}</p>
    <p><strong>End Time:</strong> ${prettyTime(endTime.toISOString())}</p>
  `;
  content.appendChild(sessionInfo);

  // Usage during session
  if (usage && usage.length > 0) {
    const usageSection = document.createElement("div");
    usageSection.className = "details-usage";

    const usageTitle = document.createElement("h3");
    usageTitle.textContent = "Activity During Session";
    usageSection.appendChild(usageTitle);

    // Group by app
    const grouped: { [app: string]: any[] } = {};
    usage.forEach((entry: any) => {
      if (!grouped[entry.app]) grouped[entry.app] = [];
      grouped[entry.app].push(entry);
    });

    const summary = document.createElement("div");
    summary.className = "details-summary";
    summary.innerHTML = `
      <p><strong>Total activities:</strong> ${usage.length}</p>
      <p><strong>Applications used:</strong> ${Object.keys(grouped).join(
        ", "
      )}</p>
    `;
    usageSection.appendChild(summary);

    const table = document.createElement("table");
    table.className = "details-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Time</th>
          <th>Application</th>
          <th>Language</th>
          <th>File/Title</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    if (tbody) {
      usage.forEach((entry: any) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${entry.time}</td>
          <td>${escapeHtml(entry.app)}</td>
          <td>${escapeHtml(entry.language || "Unknown")}</td>
          <td>${escapeHtml(entry.title)}</td>
        `;
        tbody.appendChild(row);
      });
    }

    usageSection.appendChild(table);
    content.appendChild(usageSection);
  } else {
    const noUsage = document.createElement("p");
    noUsage.textContent = "No activity recorded during this session.";
    content.appendChild(noUsage);
  }

  container.appendChild(content);
}
