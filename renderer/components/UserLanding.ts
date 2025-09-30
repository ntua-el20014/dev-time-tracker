import { ipcRenderer } from "electron";
import { showModal, showConfirmationModal } from "./Modals";
import { UserRole } from "../../shared/types";

/**
 * User Landing Page UI
 * Shows all users as rectangles with avatar and name, plus an add button.
 */
export async function renderUserLanding(
  container: HTMLElement,
  onUserSelected?: (userId: number) => void
) {
  interface User {
    id: number;
    username: string;
    avatar?: string;
    role: UserRole;
  }

  // Load users from the database
  const users: User[] = await ipcRenderer.invoke("get-all-users");

  // Simple avatar fallback (initials)
  function getAvatar(user: User) {
    if (user.avatar && user.avatar.trim()) {
      return `<img src="${user.avatar}" alt="avatar" class="user-avatar-img">`;
    }
    const initials = user.username
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
    return `<div class="user-avatar-fallback">${initials}</div>`;
  }

  function getRoleBadge(role: UserRole): string {
    const roleMap = {
      [UserRole.ADMIN]: { text: "Admin", class: "admin" },
      [UserRole.MANAGER]: { text: "Manager", class: "manager" },
      [UserRole.EMPLOYEE]: { text: "Employee", class: "employee" },
    };
    const roleInfo = roleMap[role];
    return `<span class="user-role-badge ${roleInfo.class}">${roleInfo.text}</span>`;
  }

  container.innerHTML = `
    <div>
      <h2>Who is using Dev Time Tracker?</h2>
      <div>
        ${users
          .map(
            (user) => `
            <div class="user-rect" data-userid="${user.id}" tabindex="0">
              ${getAvatar(user)}
              <div class="user-info">
                <div class="username">${user.username}</div>
                ${getRoleBadge(user.role)}
              </div>
            </div>
          `
          )
          .join("")}
        <div id="addUserRect" tabindex="0">
          <div>+</div>
          <div>Add User</div>
        </div>
        <div id="deleteUserRect" tabindex="0" style="background:var(--bg);color:#d32f2f;font-size:2em;font-weight:bold;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div>&#128465;</div>
          <div style="font-size:0.95em;color:#888;">Delete User</div>
        </div>
      </div>
    </div>
  `;

  // Click handler for user rectangles
  container.querySelectorAll(".user-rect").forEach((rect) => {
    rect.addEventListener("click", () => {
      const userId = Number((rect as HTMLElement).getAttribute("data-userid"));
      // Store userId in localStorage for later retrieval in all tabs
      localStorage.setItem("currentUserId", String(userId));
      if (onUserSelected) {
        onUserSelected(userId);
      }
    });
  });

  // Click handler for add user
  const addUserRect = container.querySelector("#addUserRect");
  // Add User
  if (addUserRect) {
    addUserRect.addEventListener("click", async () => {
      showModal({
        title: "Add New User",
        fields: [
          {
            name: "username",
            label: "Username",
            type: "text",
            required: true,
          },
          {
            name: "email",
            label: "Email",
            type: "text",
            required: true,
          },
          {
            name: "password",
            label: "Password",
            type: "text",
            required: true,
          },
        ],
        submitText: "Add",
        onSubmit: async (values) => {
          const { username, email, password } = values;
          if (username?.trim() && email?.trim() && password) {
            await ipcRenderer.invoke("create-user", {
              username: username.trim(),
              email: email.trim(),
              password: password,
              avatar: "",
            });
          }
          setTimeout(() => {
            renderUserLanding(container, onUserSelected);
            setTimeout(() => {
              // Try to focus the Add User input if it exists
              const modalInput = document.querySelector(
                '#customModal input[name="username"]'
              ) as HTMLInputElement;
              if (modalInput) {
                modalInput.blur();
                setTimeout(() => modalInput.focus(), 0);
              }
            }, 100);
          }, 0);
        },
      });
    });
  }

  // Delete User
  const deleteUserRect = container.querySelector("#deleteUserRect");
  if (deleteUserRect) {
    deleteUserRect.addEventListener("click", async () => {
      const users: User[] = await ipcRenderer.invoke("get-all-users");
      const deletableUsers = users.filter((u) => u.id !== 1);
      if (deletableUsers.length === 0) {
        alert("No users to delete (default user cannot be deleted).");
        return;
      }

      showModal({
        title: "Delete User",
        fields: [], // No input fields
        submitText: "", // No submit button
        cancelText: "Cancel",
        onSubmit: () => {
          return;
        },
        onCancel: () => {
          // Modal will be closed automatically by the showModal function
          return;
        },
      });

      setTimeout(() => {
        const form = document.getElementById("customModalForm");
        if (!form) return;

        // Render user bubbles
        form.innerHTML = `
          <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:16px 0;">
            ${deletableUsers
              .map(
                (u) => `
              <div class="delete-user-bubble" data-userid="${u.id}" style="
                display:flex;align-items:center;gap:8px;
                background:var(--row-hover);
                color:#222;
                border-radius:16px;
                padding:8px 16px;
                cursor:pointer;
                font-size:1.1em;
                transition:background 0.15s;
              ">
                <span style="font-weight:bold;">${u.username}</span>
              </div>
            `
              )
              .join("")}
          </div>
          <div style="text-align:center;color:#888;font-size:0.95em;">Click a user to delete</div>
          <div style="text-align:center;margin-top:16px;">
            <button type="button" id="customModalCancelBtn" class="">Cancel</button>
          </div>
        `;

        // Attach click handlers
        form.querySelectorAll(".delete-user-bubble").forEach((bubble) => {
          bubble.addEventListener("click", async () => {
            const userId = Number((bubble as HTMLElement).dataset.userid);
            const user = deletableUsers.find((u) => u.id === userId);
            if (!user) return;
            showConfirmationModal({
              title: "Delete User",
              message: `Are you sure you want to delete user "${user.username}"? This cannot be undone.`,
              confirmText: "Delete",
              confirmClass: "btn-delete",
              onConfirm: async () => {
                await ipcRenderer.invoke("delete-user", userId);
                if (localStorage.getItem("currentUserId") === String(userId)) {
                  localStorage.removeItem("currentUserId");
                }
                // Close the modal using the close button (which will trigger onCancel)
                const modal = document.getElementById("customModal");
                const closeBtn = modal?.querySelector(
                  ".modal-close-btn"
                ) as HTMLButtonElement;
                closeBtn?.click();
                renderUserLanding(container, onUserSelected);
              },
            });
          });
        });

        const cancelBtn = form.querySelector(
          "#customModalCancelBtn"
        ) as HTMLButtonElement;
        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            // Close the modal using the close button (which will trigger onCancel)
            const modal = document.getElementById("customModal");
            const closeBtn = modal?.querySelector(
              ".modal-close-btn"
            ) as HTMLButtonElement;
            closeBtn?.click();
            renderUserLanding(container, onUserSelected);
          });
        }
      }, 0);
    });
  }
}
