import { ipcRenderer } from 'electron';
import './index.css';

ipcRenderer.invoke('get-logs').then(logs => {
  const tbody = document.querySelector('#logTable tbody');
  logs.forEach(log => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${log.app}</td><td>${log.title}</td><td>${log.timestamp}</td>`;
    if (tbody) {
      tbody.appendChild(row);
    }
  });
});
