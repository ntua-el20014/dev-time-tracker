export function displayOSInfo(os: string) {
  let osDiv = document.getElementById('os-info') as HTMLDivElement | null;
  if (!osDiv) {
    osDiv = document.createElement('div');
    osDiv.id = 'os-info';
    osDiv.style.position = 'fixed';
    osDiv.style.right = '20px';
    osDiv.style.bottom = '20px';
    osDiv.style.opacity = '0.7';
    osDiv.style.fontSize = '14px';
    document.body.appendChild(osDiv);
  }
  osDiv.textContent = `OS: ${os}`;
}