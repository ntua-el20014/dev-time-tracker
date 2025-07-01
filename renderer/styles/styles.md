# CSS File Structure

This project’s CSS is modularized by feature/component for maintainability:

---

## base.css

- CSS variables (`:root`)
- Body, headings, general typography
- Global elements (e.g. `#os-info`, `#recordBtn`, notification)
- Accent color, theme variables

## layout.css

- Main container and layout (`.container`, `.header`)
- Tab bar and tab content (`.tab-bar`, `.tab`, `.tab-content`)

## table.css

- All table styles (`table`, `.summary-table`, `th`, `td`, etc.)
- Table row hover, icons, and edit button
- Summary date headers
- Filter buttons (`.summary-filter-btn`)
- Details container

## modal.css

- Modal overlay and content (`#customModal`, `.session-modal-content`)
- Modal form and actions (`#customModalForm`, `.session-modal-actions`)
- Modal buttons (`#customModalCancelBtn`)

## calendar.css

- Calendar widget and grid (`.calendar-widget`, `.calendar-header`, `.calendar-grid`)
- Calendar day labels, cells, and dates

## timeline.css

- Timeline chart container and bars (`.timeline-container`, `.timeline-chart`, `.timeline-bar`)
- Timeline day labels and hours

## profile.css

- Profile tab sidebar/menu buttons (`.profile-chapter-btn`)
- Tag color chip and color grid picker (`.tag-color-chip`, `.color-grid-picker`)
- Logout button

## theme.css

- Theme toggle button (`button#toggleTheme`)
- Theme-specific overrides

## dashboard.css

- Dashboard tab layout and quick stats
- Bubble styles for language/editor/session/streak
- Calendar and charts in dashboard

## users.css

- User landing page, user selection, avatars

## charts.css

- Chart components and visualization styles
- Chart containers and data representation

## goals.css

- Goals and targets interface styles
- Goal progress indicators and forms

---
