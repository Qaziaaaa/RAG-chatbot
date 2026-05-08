,,,,,,,,,,,,,,,,,,# Requirements Document

## Introduction

This feature adds a logo icon to the application's title bar (header), displayed immediately before the title text. The DocChat application already uses a consistent SVG logo icon in the landing page navbar and the auth modal title — this feature brings that same icon into the main app header (`App.jsx`) so the branding is consistent across all views. The icon must match the existing design system: the "Sovereign Intelligence" military terminal aesthetic with neon cyan on a dark background.

## Glossary

- **Header**: The fixed top bar rendered by the `.chat-header` element in `App.jsx`, visible on the main chat interface.
- **Logo_Icon**: The SVG icon representing the DocChat brand — a stylised robot/chat face (rect body, two circle eyes, a mouth path) already used in `Landing.jsx` and the auth modal.
- **Title_Text**: The text label rendered inside `.header-brand` that currently reads "DocChat".
- **Design_System**: The "Sovereign Intelligence" visual language defined in `App.css`, using CSS custom properties such as `--cyan`, `--font-head`, and `--surface-header`.
- **App**: The React single-page application served from `frontend/src/App.jsx`.

---

## Requirements

### Requirement 1: Display Logo Icon in the App Header

**User Story:** As a user, I want to see the DocChat logo icon in the app header, so that the branding is immediately recognisable and consistent with the landing page.

#### Acceptance Criteria

1. THE App SHALL render the Logo_Icon in the Header, positioned immediately to the left of the Title_Text.
2. WHEN the Header is rendered, THE Logo_Icon SHALL be visible at all viewport widths supported by the application (≥ 320 px wide).
3. THE Logo_Icon SHALL use the same SVG path data as the icon already present in the landing page navbar (`Landing.jsx`) to ensure visual consistency.
4. THE Logo_Icon SHALL be styled with `color: var(--cyan)` so it inherits the Design_System accent colour.
5. THE Logo_Icon SHALL have a rendered size of 22 × 22 px (matching the icon size used in the auth modal title).

### Requirement 2: Preserve Existing Header Layout

**User Story:** As a user, I want the header to remain usable after the logo is added, so that existing controls (sidebar toggle, status indicator, auth buttons) are not displaced or obscured.

#### Acceptance Criteria

1. WHEN the Logo_Icon is added, THE Header SHALL maintain its existing height of `var(--header-h)` (60 px) without vertical overflow.
2. WHEN the Logo_Icon is added, THE Header SHALL continue to display the sidebar-toggle button, status dot, and auth controls in their current positions.
3. THE Logo_Icon and Title_Text SHALL be wrapped in a single flex container so they are treated as one logical branding unit within the Header's flex layout.
4. IF the viewport width is less than 400 px, THEN THE App SHALL hide the Title_Text while keeping the Logo_Icon visible, preventing horizontal overflow.

### Requirement 3: Accessibility

**User Story:** As a user relying on assistive technology, I want the logo icon to be correctly labelled, so that screen readers do not announce meaningless SVG content.

#### Acceptance Criteria

1. THE Logo_Icon SVG element SHALL carry `aria-hidden="true"` so screen readers skip it (the adjacent Title_Text already provides the accessible label).
2. THE Logo_Icon SVG element SHALL include `focusable="false"` to prevent Internet Explorer and legacy Edge from placing the SVG in the tab order.
