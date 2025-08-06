import { ipcRenderer } from "electron";
import { UserRole } from "../../shared/types";
import { showConfirmationModal } from "./Modals";
import { showInAppNotification } from "./Notifications";

interface User {
  id: number;
  username: string;
  avatar: string;
  role: UserRole;
}

export async function renderUserRoleManager(container: HTMLElement) {
  const users: User[] = await ipcRenderer.invoke("get-all-users");

  container.innerHTML = `
    <div class="user-role-manager">
      <p class="info-note">
        Manage user roles and permissions. Only admins can modify user roles.
      </p>
      
      <div class="user-role-table-container">
        <table class="user-role-table">
          <thead>
            <tr>
              <th>Avatar</th>
              <th>Username</th>
              <th>Current Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (user) => `
              <tr data-user-id="${user.id}">
                <td>
                  <div class="user-avatar-cell">
                    ${
                      user.avatar
                        ? `<img src="${user.avatar}" alt="Avatar" class="user-avatar-small">`
                        : `<div class="user-avatar-initials">${user.username
                            .charAt(0)
                            .toUpperCase()}</div>`
                    }
                  </div>
                </td>
                <td class="username-cell">${user.username}</td>
                <td>
                  <span class="role-badge role-${
                    user.role
                  }">${getRoleDisplayName(user.role)}</span>
                </td>
                <td>
                  <div class="user-actions">
                    <div class="role-select-container" data-user-id="${
                      user.id
                    }" data-current-role="${user.role}"></div>
                    <button class="update-role-btn" data-user-id="${user.id}" ${
                  user.id === 1 ? "disabled" : ""
                }>
                      Update
                    </button>
                  </div>
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
      
      <div class="role-descriptions">
        <h4>Role Descriptions:</h4>
        <div class="role-description-grid">
          <div class="role-description">
            <strong>Employee:</strong> Personal time tracking only. Can view and manage their own sessions, usage data, and profile settings.
          </div>
          <div class="role-description">
            <strong>Manager:</strong> Team oversight and basic reporting. Can view team statistics and generate reports for their assigned team members.
          </div>
          <div class="role-description">
            <strong>Admin:</strong> Full system access. Can manage all users, system settings, database operations, and has access to all data.
          </div>
        </div>
      </div>
    </div>
  `;

  // Create custom dropdowns for role selection
  const { createCustomDropdown } = require("./CustomDropdown");
  const roleDropdowns = new Map();

  const roleContainers = container.querySelectorAll(".role-select-container");
  roleContainers.forEach((roleContainer: any) => {
    const userId = parseInt(roleContainer.dataset.userId);
    const currentRole = roleContainer.dataset.currentRole as UserRole;

    const roleDropdown = createCustomDropdown({
      id: `user-role-${userId}`,
      name: `user-role-${userId}`,
      value: currentRole,
      options: [
        { value: UserRole.EMPLOYEE, label: "Employee" },
        { value: UserRole.MANAGER, label: "Manager" },
        { value: UserRole.ADMIN, label: "Admin" },
      ],
    });

    roleContainer.appendChild(roleDropdown.getElement());
    roleDropdowns.set(userId, roleDropdown);
  });

  // Add event listeners for role updates
  const updateButtons = container.querySelectorAll(".update-role-btn");
  updateButtons.forEach((button) => {
    button.addEventListener("click", async (e) => {
      const btn = e.target as HTMLButtonElement;
      const userId = parseInt(btn.dataset.userId!);
      const roleDropdown = roleDropdowns.get(userId);

      if (!roleDropdown) return;

      const newRole = roleDropdown.getValue() as UserRole;
      const currentRole = roleDropdown.config.value as UserRole;

      if (newRole === currentRole) {
        showInAppNotification("No changes made to user role.", 3000);
        return;
      }

      const user = users.find((u) => u.id === userId);
      if (!user) return;

      // Prevent removing the last admin
      if (currentRole === UserRole.ADMIN && newRole !== UserRole.ADMIN) {
        const adminCount = users.filter(
          (u) => u.role === UserRole.ADMIN
        ).length;
        if (adminCount <= 1) {
          showInAppNotification(
            "Cannot remove the last admin. There must be at least one admin user.",
            5000
          );
          roleDropdown.setValue(currentRole); // Reset the dropdown
          return;
        }
      }

      showConfirmationModal({
        title: "Update User Role",
        message: `Are you sure you want to change ${
          user.username
        }'s role from ${getRoleDisplayName(
          currentRole
        )} to ${getRoleDisplayName(newRole)}?`,
        confirmText: "Update Role",
        cancelText: "Cancel",
        onConfirm: async () => {
          try {
            await ipcRenderer.invoke("set-user-role", userId, newRole);

            // Update the UI
            const roleBadge = container.querySelector(
              `tr[data-user-id="${userId}"] .role-badge`
            );
            if (roleBadge) {
              roleBadge.className = `role-badge role-${newRole}`;
              roleBadge.textContent = getRoleDisplayName(newRole);
            }

            // Update the dropdown's internal current value
            roleDropdown.config.value = newRole;
            showInAppNotification(
              `Successfully updated ${
                user.username
              }'s role to ${getRoleDisplayName(newRole)}.`,
              3000
            );
          } catch (error) {
            showInAppNotification(
              "Failed to update user role. Please try again.",
              5000
            );
            roleDropdown.setValue(currentRole); // Reset the dropdown on error
          }
        },
        onCancel: () => {
          roleDropdown.setValue(currentRole); // Reset the dropdown if cancelled
        },
      });
    });
  });
}

function getRoleDisplayName(role: UserRole): string {
  switch (role) {
    case UserRole.ADMIN:
      return "Admin";
    case UserRole.MANAGER:
      return "Manager";
    case UserRole.EMPLOYEE:
      return "Employee";
    default:
      return "Unknown";
  }
}
