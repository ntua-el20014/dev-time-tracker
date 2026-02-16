import { ScheduledSession } from "@shared/types";
import { safeIpcInvoke } from "./utils";
import { showInAppNotification, showConfirmationModal } from "./components";

// eslint-disable-next-line prefer-const
let currentDate = new Date(); // Needs to be mutable for month navigation
let scheduledSessions: ScheduledSession[] = [];
let calendarListenerAttached = false;

export async function renderCalendar() {
  const calendarContainer = document.getElementById("calendarContent");
  if (!calendarContainer) return;

  // Show loading while scheduled sessions load
  calendarContainer.innerHTML =
    '<div class="tab-loading"><div class="tab-loading-spinner"></div><span class="tab-loading-text">Loading calendar…</span></div>';

  // Load scheduled sessions for current month
  await loadScheduledSessions();

  calendarContainer.innerHTML = `
    <div class="calendar-container">
      <div class="calendar-header">
        <h2>Scheduled Sessions</h2>
        <div class="calendar-controls">
          <button id="prev-month" style="padding: 8px 16px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary); border-radius: 4px; cursor: pointer; transition: all 0.2s ease; font-size: 18px; font-weight: bold;">‹</button>
          <span id="current-month">${currentDate.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}</span>
          <button id="next-month" style="padding: 8px 16px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary); border-radius: 4px; cursor: pointer; transition: all 0.2s ease; font-size: 18px; font-weight: bold;">›</button>
        </div>
        <button id="new-session-btn" class="export-button">+ Schedule Session</button>
      </div>
      
      <div class="calendar-grid">
        ${renderCalendarGrid()}
      </div>
      
      <div class="upcoming-sessions">
        <h3>Upcoming Sessions</h3>
        <div id="upcoming-list">
          ${renderUpcomingSessions()}
        </div>
      </div>
    </div>
  `;

  // Only setup event listeners once to prevent duplicates
  if (!calendarListenerAttached) {
    setupCalendarEventListeners();
    calendarListenerAttached = true;
  }
}

function renderCalendarGrid(): string {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const startDate = new Date(firstDay);
  // Start from Monday (1) instead of Sunday (0)
  const dayOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  startDate.setDate(startDate.getDate() - dayOffset);

  const weeks = [];
  const currentWeek = [];

  for (let i = 0; i < 42; i++) {
    // 6 weeks * 7 days
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);

    const isCurrentMonth = date.getMonth() === month;
    const isToday = date.toDateString() === new Date().toDateString();
    const sessionsOnDay = getSessionsForDate(date);

    currentWeek.push({
      date,
      isCurrentMonth,
      isToday,
      sessions: sessionsOnDay,
    });

    if (currentWeek.length === 7) {
      weeks.push([...currentWeek]);
      currentWeek.length = 0;
    }
  }

  return `
    <div class="calendar-header-row">
      <div class="day-header">Mon</div>
      <div class="day-header">Tue</div>
      <div class="day-header">Wed</div>
      <div class="day-header">Thu</div>
      <div class="day-header">Fri</div>
      <div class="day-header">Sat</div>
      <div class="day-header">Sun</div>
    </div>
    ${weeks
      .map(
        (week) => `
      <div class="calendar-week">
        ${week
          .map(
            (day) => `
          <div class="calendar-day ${
            day.isCurrentMonth ? "current-month" : "other-month"
          } ${day.isToday ? "today" : ""}" 
               data-date="${day.date.getFullYear()}-${String(
                 day.date.getMonth() + 1,
               ).padStart(
                 2,
                 "0",
               )}-${String(day.date.getDate()).padStart(2, "0")}">
            <div class="day-number">${day.date.getDate()}</div>
            <div class="day-sessions">
              ${day.sessions
                .map(
                  (session) => `
                <div class="session-indicator ${session.status}" 
                     data-session-id="${session.id}" 
                     title="${session.title}">
                  <span class="session-time">${new Date(
                    session.scheduled_datetime,
                  ).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}</span>
                  <span class="session-title">${session.title}</span>
                </div>
              `,
                )
                .join("")}
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `,
      )
      .join("")}
  `;
}

function renderUpcomingSessions(): string {
  const upcoming = scheduledSessions
    .filter((session) => {
      const sessionDate = new Date(session.scheduled_datetime);
      const now = new Date();
      return (
        sessionDate >= now &&
        (session.status === "pending" || session.status === "notified")
      );
    })
    .sort(
      (a, b) =>
        new Date(a.scheduled_datetime).getTime() -
        new Date(b.scheduled_datetime).getTime(),
    )
    .slice(0, 5);

  if (upcoming.length === 0) {
    return '<p class="no-sessions">No upcoming sessions scheduled</p>';
  }

  return upcoming
    .map(
      (session) => `
    <div class="upcoming-session" data-session-id="${session.id}">
      <div class="session-info">
        <div class="session-title">${session.title}</div>
        <div class="session-datetime">
          ${new Date(session.scheduled_datetime).toLocaleDateString(
            "en-GB",
          )} at 
          ${new Date(session.scheduled_datetime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
        ${
          session.description
            ? `<div class="session-description">${session.description}</div>`
            : ""
        }
        ${
          session.estimated_duration
            ? `<div class="session-duration">Estimated: ${session.estimated_duration} minutes</div>`
            : ""
        }
        ${
          session.tags && session.tags.length > 0
            ? `
          <div class="session-tags">
            ${session.tags
              .map((tag) => `<span class="tag">${tag}</span>`)
              .join("")}
          </div>
        `
            : ""
        }
      </div>
      ${
        session.status === "pending" || session.status === "notified"
          ? `
      <div class="session-actions">
        <button class="export-button session-action-btn" data-action="start" data-session-id="${session.id}">Start Now</button>
        <button class="session-action-btn btn-delete" data-action="delete" data-session-id="${session.id}">Delete</button>
      </div>
      `
          : ""
      }
    </div>
  `,
    )
    .join("");
}

function getSessionsForDate(date: Date): ScheduledSession[] {
  // Use local date format to avoid timezone issues
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;

  return scheduledSessions.filter((session) => {
    // Handle both ISO datetime strings and local datetime strings
    const sessionDatetime = session.scheduled_datetime;
    let sessionDate: string;

    if (sessionDatetime.includes("T") && sessionDatetime.endsWith("Z")) {
      // ISO format with Z (UTC) - convert to local date
      const sessionDateObj = new Date(sessionDatetime);
      sessionDate = `${sessionDateObj.getFullYear()}-${String(
        sessionDateObj.getMonth() + 1,
      ).padStart(2, "0")}-${String(sessionDateObj.getDate()).padStart(2, "0")}`;
    } else if (sessionDatetime.includes("T")) {
      // Local datetime format (YYYY-MM-DDTHH:mm:ss)
      sessionDate = sessionDatetime.split("T")[0];
    } else {
      // Fallback to local date conversion
      const sessionDateObj = new Date(sessionDatetime);
      sessionDate = `${sessionDateObj.getFullYear()}-${String(
        sessionDateObj.getMonth() + 1,
      ).padStart(2, "0")}-${String(sessionDateObj.getDate()).padStart(2, "0")}`;
    }

    return sessionDate === dateStr;
  });
}

async function loadScheduledSessions() {
  try {
    const startOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );
    const endOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0,
    );

    scheduledSessions = await safeIpcInvoke<ScheduledSession[]>(
      "get-scheduled-sessions",
      [
        {
          startDate: startOfMonth.toISOString().split("T")[0],
          endDate: endOfMonth.toISOString().split("T")[0],
        },
      ],
      { fallback: [] },
    );
  } catch (err) {
    showInAppNotification("Error loading scheduled sessions");
    scheduledSessions = [];
  }
}

function setupCalendarEventListeners() {
  const calendarContainer = document.getElementById("calendarContent");
  if (!calendarContainer) return;

  // Use event delegation for all calendar events
  calendarContainer.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    // Month navigation
    if (target.id === "prev-month") {
      currentDate.setMonth(currentDate.getMonth() - 1);
      await renderCalendar();
      return;
    }

    if (target.id === "next-month") {
      currentDate.setMonth(currentDate.getMonth() + 1);
      await renderCalendar();
      return;
    }

    // New session button
    if (target.id === "new-session-btn") {
      showScheduleSessionModal();
      return;
    }

    // Session action buttons
    if (target.classList.contains("session-action-btn")) {
      const action = target.dataset.action;
      const sessionId = target.dataset.sessionId;

      if (action && sessionId) {
        if (action === "start") {
          startScheduledSessionHandler(sessionId);
        } else if (action === "delete") {
          deleteScheduledSessionHandler(sessionId);
        }
      }
      return;
    }

    // Session indicator clicks
    if (target.closest(".session-indicator")) {
      e.stopPropagation();
      const indicator = target.closest(".session-indicator") as HTMLElement;
      const sessionId = indicator.dataset.sessionId;
      if (sessionId) {
        showSessionDetailsModal(sessionId);
      }
      return;
    }

    // Day click to add session
    const calendarDay = target.closest(".calendar-day.current-month");
    if (calendarDay && !target.closest(".session-indicator")) {
      const dateStr = (calendarDay as HTMLElement).dataset.date;
      if (dateStr) {
        showScheduleSessionModal(new Date(dateStr));
      }
    }
  });
}

function showScheduleSessionModal(selectedDate?: Date) {
  const defaultDate = selectedDate || new Date();
  const defaultTime = defaultDate.getHours() < 18 ? "09:00" : "10:00";

  // Create modal HTML
  const modalHTML = `
    <div id="calendarModal" class="active">
      <div class="session-modal-content">
        <button class="modal-close-btn calendar-close-btn">&times;</button>
        <h3>Schedule New Session</h3>
        <form id="calendarModalForm">
          <div style="margin-bottom: 15px;">
            <label for="session-title">Title *</label><br>
            <input type="text" id="session-title" required placeholder="e.g., Morning coding session">
          </div>
          
          <div style="margin-bottom: 15px;">
            <label for="session-description">Description</label><br>
            <textarea id="session-description" placeholder="Optional description..."></textarea>
          </div>
          
          <div style="display: flex; gap: 10px; margin-bottom: 15px;">
            <div style="flex: 1;">
              <label for="session-date">Date *</label><br>
              <input type="date" id="session-date" required value="${
                defaultDate.toISOString().split("T")[0]
              }">
            </div>
            
            <div style="flex: 1;">
              <label for="session-time">Time *</label><br>
              <input type="time" id="session-time" required value="${defaultTime}">
            </div>
          </div>
          
          <div style="margin-bottom: 15px;">
            <label for="estimated-duration">Estimated Duration (minutes)</label><br>
            <input type="number" id="estimated-duration" min="15" max="480" step="15" placeholder="e.g., 120">
          </div>
          
          <div style="margin-bottom: 15px;">
            <label for="session-tags">Tags (comma-separated)</label><br>
            <input type="text" id="session-tags" placeholder="e.g., work, personal, project-name">
          </div>
          
          <div style="margin-bottom: 15px;">
            <label>
              <input type="checkbox" id="recurring-weekly"> 
              Repeat weekly
            </label>
          </div>
          
          <div id="recurrence-options" style="display: none; margin-bottom: 15px;">
            <label for="recurrence-end">Stop repeating after (optional)</label><br>
            <input type="date" id="recurrence-end">
          </div>
          
          <div class="session-modal-actions">
            <button type="button" id="calendarModalCancelBtn" style="padding: 8px 16px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary); border-radius: 4px; cursor: pointer; transition: all 0.2s ease;">Cancel</button>
            <button type="submit" class="export-button">Schedule Session</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // Setup event listeners immediately - no need for requestAnimationFrame
  setupScheduleModalEventListeners();

  // Focus the title input after a short delay to ensure it's ready
  setTimeout(() => {
    const titleInput = document.getElementById(
      "session-title",
    ) as HTMLInputElement;
    if (titleInput) {
      titleInput.blur();
      setTimeout(() => titleInput.focus(), 0);
    }
  }, 10);
}

function setupScheduleModalEventListeners() {
  // Handle recurring checkbox
  const recurringCheckbox = document.getElementById(
    "recurring-weekly",
  ) as HTMLInputElement;
  const recurrenceOptions = document.getElementById("recurrence-options");

  if (recurringCheckbox) {
    recurringCheckbox.addEventListener("change", () => {
      if (recurrenceOptions) {
        recurrenceOptions.style.display = recurringCheckbox.checked
          ? "block"
          : "none";
      }
    });
  }

  // Handle cancel
  const cancelBtn = document.getElementById("calendarModalCancelBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeModal);
  }

  // Handle close button
  const closeBtn = document.querySelector(".calendar-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
  }

  // Handle modal backdrop click
  const modal = document.getElementById("calendarModal");
  if (modal) {
    modal.addEventListener("click", (e: Event) => {
      if (e.target === e.currentTarget) closeModal();
    });
  }

  // Handle form submission
  const form = document.getElementById("calendarModalForm");
  if (form) {
    form.addEventListener("submit", async (e: Event) => {
      e.preventDefault();
      await handleScheduleSessionSubmit();
    });
  }
}

async function handleScheduleSessionSubmit() {
  const title = (
    document.getElementById("session-title") as HTMLInputElement
  ).value.trim();
  const description = (
    document.getElementById("session-description") as HTMLTextAreaElement
  ).value.trim();
  const date = (document.getElementById("session-date") as HTMLInputElement)
    .value;
  const time = (document.getElementById("session-time") as HTMLInputElement)
    .value;
  const estimatedDuration = (
    document.getElementById("estimated-duration") as HTMLInputElement
  ).value;
  const tagsInput = (
    document.getElementById("session-tags") as HTMLInputElement
  ).value.trim();
  const isRecurring = (
    document.getElementById("recurring-weekly") as HTMLInputElement
  ).checked;
  const recurrenceEnd = (
    document.getElementById("recurrence-end") as HTMLInputElement
  ).value;

  // Basic validation
  if (!title) {
    showInAppNotification("Please enter a session title");
    return;
  }

  if (!date || !time) {
    showInAppNotification("Please select a date and time");
    return;
  }

  // Create datetime without timezone conversion issues
  const scheduled_datetime = `${date}T${time}:00`;

  // Check if the scheduled time is in the past
  if (new Date(scheduled_datetime) < new Date()) {
    showInAppNotification("Cannot schedule sessions in the past");
    return;
  }

  const tags = tagsInput
    ? tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  const scheduledSession: Omit<
    ScheduledSession,
    "id" | "created_at" | "user_id"
  > = {
    title,
    description: description || undefined,
    scheduled_datetime,
    estimated_duration: estimatedDuration
      ? parseInt(estimatedDuration)
      : undefined,
    recurrence_type: isRecurring ? "weekly" : "none",
    recurrence_data: isRecurring
      ? {
          dayOfWeek:
            new Date(scheduled_datetime).getDay() === 0
              ? 7
              : new Date(scheduled_datetime).getDay(), // Convert Sunday (0) to 7, keep others as is
          endDate: recurrenceEnd || undefined,
        }
      : undefined,
    status: "pending",
    tags,
  };

  try {
    const sessionId = await safeIpcInvoke(
      "create-scheduled-session",
      [scheduledSession],
      { fallback: null },
    );
    if (sessionId) {
      closeModal();
      showInAppNotification("Session scheduled successfully!");
      await renderCalendar();
    } else {
      showInAppNotification("Failed to schedule session");
    }
  } catch (err) {
    showInAppNotification("Error scheduling session");
  }
}

async function showSessionDetailsModal(sessionId: string | number) {
  const session = scheduledSessions.find(
    (s) => String(s.id) === String(sessionId),
  );
  if (!session) return;

  const sessionDate = new Date(session.scheduled_datetime);

  const modalHTML = `
    <div id="calendarDetailsModal" class="active">
      <div class="session-modal-content">
        <button class="modal-close-btn calendar-details-close-btn">&times;</button>
        <h3>Session Details</h3>
        <div>
          <p><strong>Title:</strong> ${session.title}</p>
          ${
            session.description
              ? `<p><strong>Description:</strong> ${session.description}</p>`
              : ""
          }
          <p><strong>Date & Time:</strong> ${sessionDate.toLocaleDateString(
            "en-GB",
          )} at ${sessionDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}</p>
          ${
            session.estimated_duration
              ? `<p><strong>Estimated Duration:</strong> ${session.estimated_duration} minutes</p>`
              : ""
          }
          ${
            session.tags && session.tags.length > 0
              ? `<p><strong>Tags:</strong> ${session.tags.join(", ")}</p>`
              : ""
          }
          <p><strong>Status:</strong> ${session.status}</p>
          ${
            session.recurrence_type === "weekly"
              ? "<p><strong>Recurrence:</strong> Weekly</p>"
              : ""
          }
        </div>
        
        <div class="session-modal-actions">
          <button type="button" id="calendarDetailsModalCancelBtn" class="btn-cancel">Close</button>
          ${
            session.status === "pending" || session.status === "notified"
              ? `<button type="button" id="start-session-details" class="btn-confirm">Start Now</button>
                 <button type="button" id="delete-session-details" class="btn-delete">Delete</button>`
              : ""
          }
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // Wait a moment for the DOM to be ready, then setup event listeners
  setTimeout(() => {
    setupSessionDetailsModalEventListeners(sessionId);
  }, 50);
}

function setupSessionDetailsModalEventListeners(sessionId: string | number) {
  // Handle buttons
  const cancelBtn = document.getElementById("calendarDetailsModalCancelBtn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", closeModal);
  }

  const startBtn = document.getElementById("start-session-details");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startScheduledSessionHandler(sessionId);
    });
  }

  const deleteBtn = document.getElementById("delete-session-details");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      deleteScheduledSessionHandler(sessionId);
    });
  }

  // Handle close button
  const closeBtn = document.querySelector(".calendar-details-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
  }

  const detailsModal = document.getElementById("calendarDetailsModal");
  if (detailsModal) {
    detailsModal.addEventListener("click", (e: Event) => {
      if (e.target === e.currentTarget) closeModal();
    });
  }
}

// Helper functions for session actions
async function startScheduledSessionHandler(sessionId: string | number) {
  const session = scheduledSessions.find(
    (s) => String(s.id) === String(sessionId),
  );
  if (!session) {
    showInAppNotification("Session not found");
    return;
  }

  // Close any existing modals first
  const detailsModal = document.getElementById("calendarDetailsModal");
  if (detailsModal) {
    detailsModal.remove();
  }

  // Wait a moment for the modal to be removed, then show confirmation
  setTimeout(() => {
    showConfirmationModal({
      title: "Start Session",
      message: `Are you sure you want to start "${session.title}" now?`,
      confirmText: "Yes, Start",
      onConfirm: async () => {
        // User confirmed - proceed with starting the session
        await startSession(sessionId, session);
      },
    });
  }, 100);
}

async function startSession(
  sessionId: string | number,
  session: ScheduledSession,
) {
  // Close modal and refresh calendar to ensure clean state
  closeModal();

  // Re-render calendar to reset any potential state issues
  await renderCalendar();

  // Wait for calendar re-render and modal cleanup to complete
  setTimeout(() => {
    // Re-setup record and pause buttons to ensure fresh event listeners
    if ((window as any).setupRecordAndPauseBtns) {
      (window as any).setupRecordAndPauseBtns();
    }

    // Wait for button setup, then trigger the record button
    setTimeout(() => {
      const recordBtn = document.getElementById(
        "recordBtn",
      ) as HTMLButtonElement;
      if (recordBtn) {
        recordBtn.click();
        showInAppNotification(`Started session: ${session.title}`);

        // Optionally mark the scheduled session as completed
        (async () => {
          try {
            await safeIpcInvoke(
              "update-scheduled-session",
              [
                sessionId,
                {
                  status: "completed",
                },
              ],
              { fallback: null },
            );
            // Re-render calendar after status update to show changes
            await renderCalendar();
          } catch (err) {
            // Silent fail - the session start is more important than updating status
          }
        })();
      } else {
        showInAppNotification("Could not find record button");
      }
    }, 150);
  }, 200); // Increased timeout to allow calendar re-render to complete
}

async function deleteScheduledSessionHandler(sessionId: string | number) {
  const session = scheduledSessions.find(
    (s) => String(s.id) === String(sessionId),
  );
  if (!session) {
    showInAppNotification("Session not found");
    return;
  }

  // Close any existing modals first
  const detailsModal = document.getElementById("calendarDetailsModal");
  if (detailsModal) {
    detailsModal.remove();
  }

  // Wait a moment for the modal to be removed, then show confirmation
  setTimeout(() => {
    showConfirmationModal({
      title: "Delete Session",
      message: `Are you sure you want to delete the scheduled session "${session.title}"?`,
      confirmText: "Yes, Delete",
      confirmClass: "btn-delete",
      confirmStyle: {
        background: "#dc3545",
        color: "white",
        border: "none",
      },
      onConfirm: async () => {
        // User confirmed - proceed with deletion
        try {
          const success = await safeIpcInvoke(
            "delete-scheduled-session",
            [sessionId],
            { fallback: false },
          );
          if (success) {
            showInAppNotification("Session deleted successfully");
            closeModal();
            await renderCalendar();
          } else {
            showInAppNotification("Failed to delete session");
          }
        } catch (err) {
          showInAppNotification("Error deleting session");
        }
      },
    });
  }, 100);
}

function closeModal() {
  const modals = document.querySelectorAll(
    "#calendarModal, #calendarDetailsModal, #confirmationModal",
  );
  modals.forEach((modal) => {
    modal.remove();
  });

  // Don't modify document.body styles as they might be needed for other modals
  // The global modal system should handle body styles appropriately
}

/*
Usage examples for the reusable confirmation modal:

1. Basic confirmation:
showConfirmationModal({
  message: "Are you sure you want to continue?",
  onConfirm: () => { console.log("Confirmed!"); }
});

2. Custom title and buttons:
showConfirmationModal({
  title: "Delete Item",
  message: "This action cannot be undone.",
  confirmText: "Delete",
  cancelText: "Keep",
  onConfirm: () => { deleteItem(); },
  onCancel: () => { console.log("Cancelled"); }
});

3. Custom styling (like delete button):
showConfirmationModal({
  title: "Warning",
  message: "This will permanently delete your data.",
  confirmText: "Delete",
  confirmStyle: {
    background: "#dc3545",
    color: "white",
    border: "none"
  },
  onConfirm: async () => { await deleteData(); }
});
*/

export function cleanupCalendar() {
  // Reset the event listeners flag so they can be re-setup if needed
  calendarListenerAttached = false;
  closeModal();
}
