import { ipcMain } from 'electron';
import * as users from '../backend/users';

ipcMain.handle('get-or-create-default-users', () => {
  if (users.getAllUsers().length === 0) {
    users.createUser('Default');
  }
  return users.getAllUsers();
});

ipcMain.handle('create-user', (_event, username: string, avatar: string) => users.createUser(username, avatar));
ipcMain.handle('get-all-users', () => users.getAllUsers());
ipcMain.handle('set-current-user', (_event, userId: number) => users.setCurrentUser(userId));
ipcMain.handle('get-current-user', () => users.getCurrentUser());
ipcMain.handle('delete-user', (_event, userId: number) => {
  users.deleteUser(userId);
  return true;
});
ipcMain.handle('set-user-avatar', (_event, userId: number, avatar: string) => {
  users.setUserAvatar(userId, avatar);
  return true;
});
ipcMain.handle('get-user-info', (_event, userId: number) => users.getUserInfo(userId));