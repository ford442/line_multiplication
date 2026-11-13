# Line Multiplication

An animated, step-by-step lesson for the visual ("Japanese") line multiplication method, rendered in 3D with WebGPU (with a 2D canvas fallback for browsers without WebGPU).

## Features

- **Guided lesson**: lines grow in digit by digit, crossings light up place value by place value, and the answer is revealed at the end. Play/pause, step, or click the progress bar.
- **Partial-product badges** such as `24 · 4×6 tens` show the distributive property directly on the diagram.
- **Column breakdown table**: dots → carry → digit, filled in as the lesson counts.
- **Quiz mode**: random problems with the answer hidden. A wrong guess points you to the column that's off, and correct answers build a streak.
- **Presets, random problems, and shareable URLs** (`#47x36`).
- Drag to tilt, scroll to zoom, double-click to reset. Keyboard: ← → Space R.
- Works without WebGPU through a Canvas 2D fallback.

## Getting Started

### Prerequisites

- A modern browser with WebGPU support (Chrome, Edge, etc.).
- Node.js (version 14 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd <repository-directory>
```

2. Install dependencies:
```bash
npm install
```

### Development

Start the development server with hot reload:

```bash
npm run dev
```

## Project Structure

```
.
├── src/
│   ├── main.ts          # Main application logic and WebGPU rendering
│   └── style.css        # Application styling
├── index.html           # HTML entry point
├── package.json         # npm configuration and scripts
└── tsconfig.json        # TypeScript configuration
```

## Technologies Used

- **TypeScript**: Strongly-typed JavaScript.
- **Vite**: Frontend build tool.
- **WebGPU**: High-performance graphics API.
