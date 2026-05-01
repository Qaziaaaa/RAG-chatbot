---
name: Sovereign Command
colors:
  surface: '#0c1324'
  surface-dim: '#0c1324'
  surface-bright: '#33394c'
  surface-container-lowest: '#070d1f'
  surface-container-low: '#151b2d'
  surface-container: '#191f31'
  surface-container-high: '#23293c'
  surface-container-highest: '#2e3447'
  on-surface: '#dce1fb'
  on-surface-variant: '#bbc9cd'
  inverse-surface: '#dce1fb'
  inverse-on-surface: '#2a3043'
  outline: '#859397'
  outline-variant: '#3c494c'
  surface-tint: '#2fd9f4'
  primary: '#8aebff'
  on-primary: '#00363e'
  primary-container: '#22d3ee'
  on-primary-container: '#005763'
  inverse-primary: '#006877'
  secondary: '#ddb7ff'
  on-secondary: '#490080'
  secondary-container: '#6f00be'
  on-secondary-container: '#d6a9ff'
  tertiary: '#d5dcf6'
  on-tertiary: '#283044'
  tertiary-container: '#b9c0da'
  on-tertiary-container: '#474e64'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#a2eeff'
  primary-fixed-dim: '#2fd9f4'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e5a'
  secondary-fixed: '#f0dbff'
  secondary-fixed-dim: '#ddb7ff'
  on-secondary-fixed: '#2c0051'
  on-secondary-fixed-variant: '#6900b3'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#0c1324'
  on-background: '#dce1fb'
  surface-variant: '#2e3447'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  body-base:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0em
  data-mono:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.1em
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.2em
spacing:
  unit: 4px
  gutter: 16px
  margin: 32px
  grid-density: tight
---

## Brand & Style

This design system targets an elite user base requiring high-density data visualization and absolute control. The brand personality is cold, calculated, and authoritative—evoking the feeling of a "Sovereign Intelligence" operating from a central command hub. It avoids the friendliness of consumer tech in favor of the uncompromising precision of aerospace and military interfaces.

The design style is a fusion of **Holographic Glassmorphism** and **Technical Minimalism**. It utilizes semi-transparent layers that appear to float over a deep space void, anchored by rigid structural grids and hair-thin circuitry lines. The emotional response is one of total situational awareness, high-stakes capability, and futuristic sophistication.

## Colors

The palette is rooted in the "Deep Space" (#020617) foundation to provide infinite visual depth. The primary accent, "Neon Cyan," is reserved for active data streams, primary calls to action, and critical telemetry. "Violet" acts as the secondary accent, used for high-level analytical insights and secondary system states.

Functional colors must maintain high luminosity against the dark base. Use a "Circuitry Grey" (#334155) for structural lines and grid-work to ensure they remain subordinate to the glowing data points. Background surfaces use a tiered dark blue-grey scale to create environmental hierarchy without breaking the immersion of the dark mode interface.

## Typography

The typographic strategy balances human readability with machine aesthetics. **Space Grotesk** is used for headlines, labels, and all data-driven values; its geometric construction conveys technical precision. All labels should be set in uppercase with increased letter spacing to mimic military-grade instrumentation.

**Inter** is utilized for long-form body text and descriptions, providing a clean, neutral sans-serif contrast that ensures legibility within dense information layouts. For technical readouts and "live" terminal data, use the tighter, monospaced characteristics of the Space Grotesk medium weights to maintain vertical alignment in data columns.

## Layout & Spacing

The design system employs a **Fixed High-Density Grid** modeled after a 12-column command console. Layouts are strictly governed by a 4px base unit, ensuring every element aligns to a technical axis. 

Information is packed tightly to maximize screen real estate, utilizing "Control Clusters"—groups of related data and inputs separated by 1px circuitry lines rather than large gaps of whitespace. Margins are kept wide at the screen edges to create a "letterboxed" cinematic feel, while internal gutters remain narrow (16px) to maintain the high-tech, high-density aesthetic of a terminal.

## Elevation & Depth

Depth is conveyed through **Holographic Glassmorphism** rather than traditional shadows. Surfaces do not cast shadows onto the background; instead, they exist as semi-transparent "HUD" layers that blur and tint the content beneath them.

- **Level 0 (Base):** Solid #020617.
- **Level 1 (Panels):** Background blur (20px) with a 5% white overlay and a 1px solid border in #1e293b.
- **Level 2 (Modals/Pop-overs):** Background blur (40px) with a 10% Cyan or Violet tint and a glowing 1px border (#22d3ee at 30% opacity).

"Circuitry Lines" (1px width) are used to connect related modules, creating a visual map of data flow across different elevation planes.

## Shapes

The shape language is strictly **Sharp (0px)**. This design system rejects the softness of modern consumer web design in favor of industrial, angular precision. All buttons, containers, input fields, and decorative elements feature 90-degree corners.

To add visual interest without using border-radius, utilize "corner-cut" geometry (45-degree chamfers) for primary action buttons or decorative frame elements. This reinforces the "Command Center" aesthetic and mimics physical hardware interfaces found in high-performance machinery.

## Components

**Buttons:** 
Rectangular with 0px radius. Primary buttons feature a solid Cyan fill with black text; secondary buttons are ghost-style with a 1px Cyan border and a subtle hover glow. Use a "scanning" animation effect (a horizontal light bar) on hover to indicate system readiness.

**Chips & Status Indicators:** 
Small, rectangular tags with monospaced text. Status states use "Glow Pulse" animations—a soft breathing effect on the border color to indicate live background processes.

**Input Fields:** 
Underlined or fully boxed with a 1px border. When focused, the border glows Cyan and a small "Focus Bracket" appears at the corners of the input area.

**Data Grids:** 
High-density tables with zebra-striping using 2% white overlays. Column headers should be uppercase with 1px vertical separators to maintain the look of a technical spreadsheet.

**Circuitry Lines:** 
A specialized decorative component used to bridge the gap between panels. These are 1px lines that only move at 90 or 45-degree angles, occasionally terminating in a small 4x4px square "node."

**Holographic Cards:** 
Main containers for data visualizations. They must feature a subtle scan-line pattern overlay (2% opacity) to enhance the digital display feel.