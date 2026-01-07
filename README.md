# Japanese Multiplication Visualizer

An interactive web application that visualizes the Japanese line multiplication method using TypeScript and Vite.

![Japanese Multiplication Visualizer](https://github.com/user-attachments/assets/237b110c-45b1-49a1-bead-e7b9d8505ae9)

## What is Japanese Multiplication?

Japanese multiplication, also known as line multiplication, is a visual method for multiplying numbers using intersecting lines. Each digit of a number is represented by a set of parallel lines, and the product is calculated by counting the intersection points between the two sets of lines.

## Features

- 🎨 **Interactive Canvas Visualization**: Real-time drawing of multiplication lines
- 🔢 **Support for 1-99**: Multiply any two numbers from 1 to 99
- 🌈 **Color-Coded Lines**: Different colors for each number's digits
- ✨ **Intersection Highlighting**: Yellow dots mark each intersection point
- 📊 **Step-by-Step Breakdown**: Shows how intersections form the result
- ⚡ **Fast Development**: Built with Vite for instant hot reload
- 🔒 **Type-Safe**: Full TypeScript implementation with strict type checking

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ford442/line_multiplication.git
cd line_multiplication
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

The application will be available at `http://localhost:5173`

### Building for Production

Create an optimized production build:

```bash
npm run build
```

The built files will be in the `dist/` directory.

### Preview Production Build

Preview the production build locally:

```bash
npm run preview
```

## Usage

1. Enter two numbers (between 1 and 99) in the input fields
2. Click "Calculate" or wait for automatic calculation
3. Watch the visualization draw the multiplication lines
4. Observe the intersection points and calculation breakdown

## Project Structure

```
line_multiplication/
├── src/
│   ├── main.ts          # Main application logic and visualization
│   └── style.css        # Application styling
├── index.html           # HTML entry point
├── package.json         # npm configuration and scripts
├── tsconfig.json        # TypeScript configuration
└── .gitignore          # Git ignore rules
```

## Technologies Used

- **TypeScript**: Strongly-typed JavaScript for better code quality
- **Vite**: Next-generation frontend build tool
- **HTML5 Canvas**: For drawing the multiplication visualization
- **CSS3**: Modern styling with light/dark mode support

## How It Works

The Japanese multiplication method works by:

1. Representing each digit of the first number as a group of parallel lines
2. Representing each digit of the second number as another group of parallel lines at a different angle
3. Counting the intersections between the line groups
4. Grouping intersections by place value (ones, tens, hundreds, etc.)
5. Adding up the intersections with carry-over to get the final result

For example, to multiply 12 × 23:
- Draw 1 line for the tens digit of 12, then 2 lines for the ones digit
- Draw 2 lines for the tens digit of 23, then 3 lines for the ones digit (at a different angle)
- Count intersections: left group (hundreds) = 2, middle groups (tens) = 7, right group (ones) = 6
- Result: 2 (hundreds) + 7 (tens) + 6 (ones) = 276

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Author

ford442

