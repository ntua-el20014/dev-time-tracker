import { ipcRenderer } from 'electron';

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
  }

  // Load users from the database
  const users: User[] = await ipcRenderer.invoke('get-all-users');

  // Simple avatar fallback (initials)
  function getAvatar(user: User) {
    if (user.avatar && user.avatar.trim()) {
      return `<img src="${user.avatar}" alt="avatar">`;
    }
    const initials = user.username
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    return `<div class="user-avatar-fallback">${initials}</div>`;
  }

  container.innerHTML = `
    <div>
      <h2>Who is using Dev Time Tracker?</h2>
      <div>
        ${users
          .map(
            user => `
            <div class="user-rect" data-userid="${user.id}" tabindex="0">
              ${getAvatar(user)}
              <div>${user.username}</div>
            </div>
          `
          )
          .join('')}
        <div id="addUserRect" tabindex="0">
          <div>+</div>
          <div>Add User</div>
        </div>
      </div>
    </div>
  `;

  // Click handler for user rectangles
  container.querySelectorAll('.user-rect').forEach(rect => {
    rect.addEventListener('click', () => {
      const userId = Number((rect as HTMLElement).getAttribute('data-userid'));
      // Store userId in localStorage for later retrieval in all tabs
      localStorage.setItem('currentUserId', String(userId));
      if (onUserSelected) {
        onUserSelected(userId);
      }
    });
  });

  // Click handler for add user
  const addUserRect = container.querySelector('#addUserRect');
  if (addUserRect) {
    addUserRect.addEventListener('click', async () => {
      const username = prompt('Enter new username:');
      if (username && username.trim()) {
        await ipcRenderer.invoke('create-user', username.trim(), '');
        renderUserLanding(container, onUserSelected);
      }
    });
  }
}