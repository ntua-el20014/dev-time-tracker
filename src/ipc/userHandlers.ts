import { ipcMain } from "electron";
import * as users from "../backend/users";
import { UserRole } from "../../shared/types";

ipcMain.handle("get-or-create-default-users", () => {
  if (users.getAllUsers().length === 0) {
    users.createUser("Default", "", UserRole.ADMIN); // First user is admin
  }
  users.ensureAdminExists(); // Ensure at least one admin exists
  return users.getAllUsers();
});

ipcMain.handle(
  "create-user",
  (_event, username: string, avatar: string, role?: UserRole) =>
    users.createUser(username, avatar, role)
);
ipcMain.handle("get-all-users", () => users.getAllUsers());
ipcMain.handle("set-current-user", (_event, userId: number) =>
  users.setCurrentUser(userId)
);
ipcMain.handle("get-current-user", () => users.getCurrentUser());
ipcMain.handle("delete-user", (_event, userId: number) => {
  users.deleteUser(userId);
  return true;
});
ipcMain.handle("set-user-avatar", (_event, userId: number, avatar: string) => {
  users.setUserAvatar(userId, avatar);
  return true;
});
ipcMain.handle("set-user-role", (_event, userId: number, role: UserRole) => {
  users.setUserRole(userId, role);
  return true;
});
ipcMain.handle("get-user-info", (_event, userId: number) =>
  users.getUserInfo(userId)
);
ipcMain.handle("is-user-admin", (_event, userId: number) =>
  users.isUserAdmin(userId)
);
ipcMain.handle("is-user-manager-or-admin", (_event, userId: number) =>
  users.isUserManagerOrAdmin(userId)
);
