import themeLight from '../data/toggle_light.png';
import themeDark from '../data/toggle_dark.png';

export function updateThemeIcon(themeIcon: HTMLImageElement) {
  if (!themeIcon) return;
  if (document.body.classList.contains('light')) {
    themeIcon.src = themeDark;
  } else {
    themeIcon.src = themeLight;
  }
}

export function initTheme() {
  const toggleBtn = document.getElementById('toggleTheme');
  const themeIcon = document.getElementById('themeIcon') as HTMLImageElement;

  if (toggleBtn && themeIcon) {
    toggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('light');
      const isLight = document.body.classList.contains('light');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      updateThemeIcon(themeIcon);
    });

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light');
    }
    updateThemeIcon(themeIcon);
  }
}