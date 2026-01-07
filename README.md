# WebGPU Times Table Visualizer

An interactive web application that visualizes times tables using WebGPU for high-performance rendering.

## Features

- **High Performance**: Renders thousands of lines at 60 FPS using WebGPU.
- **Interactive Controls**: Sliders to adjust the multiplier and the total number of points.
- **Dynamic shaders**: Vertex positions are calculated on the GPU, minimizing CPU-GPU data transfer.

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
