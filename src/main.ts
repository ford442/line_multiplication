import './style.css';

interface Point {
  x: number;
  y: number;
}

interface Line {
  start: Point;
  end: Point;
}

class JapaneseMultiplication {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private num1Input: HTMLInputElement;
  private num2Input: HTMLInputElement;
  private calculateBtn: HTMLButtonElement;
  private resultDiv: HTMLElement;

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.num1Input = document.getElementById('num1') as HTMLInputElement;
    this.num2Input = document.getElementById('num2') as HTMLInputElement;
    this.calculateBtn = document.getElementById('calculate') as HTMLButtonElement;
    this.resultDiv = document.getElementById('result') as HTMLElement;

    this.setupEventListeners();
    this.calculate(); // Initial calculation
  }

  private setupEventListeners(): void {
    this.calculateBtn.addEventListener('click', () => this.calculate());
    this.num1Input.addEventListener('input', () => this.calculate());
    this.num2Input.addEventListener('input', () => this.calculate());
  }

  private getDigits(num: number): number[] {
    return num.toString().split('').map(Number);
  }

  private calculate(): void {
    const num1 = parseInt(this.num1Input.value) || 0;
    const num2 = parseInt(this.num2Input.value) || 0;

    if (num1 < 1 || num1 > 99 || num2 < 1 || num2 > 99) {
      this.resultDiv.textContent = 'Please enter numbers between 1 and 99';
      return;
    }

    const result = num1 * num2;
    this.resultDiv.innerHTML = `<strong>${num1} × ${num2} = ${result}</strong>`;
    
    this.visualize(num1, num2);
  }

  private visualize(num1: number, num2: number): void {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const digits1 = this.getDigits(num1);
    const digits2 = this.getDigits(num2);

    const spacing = 60;
    const startX = 150;
    const startY = 100;
    const lineLength = 300;
    const angle = Math.PI / 6; // 30 degrees

    // Draw lines for first number (top-left to bottom-right)
    const lines1: Line[][] = [];
    let offsetX1 = 0;

    digits1.forEach((digit, groupIndex) => {
      const groupLines: Line[] = [];
      for (let i = 0; i < digit; i++) {
        const y = startY + i * 15;
        const start: Point = { x: startX + offsetX1, y };
        const end: Point = {
          x: start.x + lineLength * Math.cos(angle),
          y: start.y + lineLength * Math.sin(angle)
        };
        groupLines.push({ start, end });
        
        this.ctx.strokeStyle = groupIndex === 0 ? '#ff6b6b' : '#ee5a6f';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);
        this.ctx.stroke();
      }
      lines1.push(groupLines);
      offsetX1 += spacing;
    });

    // Draw lines for second number (top-right to bottom-left)
    const lines2: Line[][] = [];
    let offsetX2 = 0;

    digits2.forEach((digit, groupIndex) => {
      const groupLines: Line[] = [];
      for (let i = 0; i < digit; i++) {
        const y = startY + i * 15;
        const start: Point = {
          x: startX + lineLength * Math.cos(angle) + offsetX2,
          y
        };
        const end: Point = {
          x: start.x + lineLength * Math.cos(Math.PI - angle),
          y: start.y + lineLength * Math.sin(Math.PI - angle)
        };
        groupLines.push({ start, end });
        
        this.ctx.strokeStyle = groupIndex === 0 ? '#4ecdc4' : '#45b7d1';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(start.x, start.y);
        this.ctx.lineTo(end.x, end.y);
        this.ctx.stroke();
      }
      lines2.push(groupLines);
      offsetX2 += spacing;
    });

    // Calculate and draw intersections
    this.drawIntersections(lines1, lines2, digits1.length, digits2.length);
  }

  private drawIntersections(
    lines1: Line[][],
    lines2: Line[][],
    groups1: number,
    groups2: number
  ): void {
    const intersectionCounts: number[][] = [];
    
    // Initialize intersection count matrix
    for (let i = 0; i < groups1; i++) {
      intersectionCounts[i] = [];
      for (let j = 0; j < groups2; j++) {
        intersectionCounts[i][j] = 0;
      }
    }

    // Count intersections for each group pair
    for (let g1 = 0; g1 < groups1; g1++) {
      for (let g2 = 0; g2 < groups2; g2++) {
        const group1Lines = lines1[g1];
        const group2Lines = lines2[g2];
        
        group1Lines.forEach(line1 => {
          group2Lines.forEach(line2 => {
            const intersection = this.getLineIntersection(line1, line2);
            if (intersection) {
              intersectionCounts[g1][g2]++;
              
              // Draw intersection point
              this.ctx.fillStyle = '#ffd93d';
              this.ctx.beginPath();
              this.ctx.arc(intersection.x, intersection.y, 3, 0, 2 * Math.PI);
              this.ctx.fill();
            }
          });
        });
      }
    }

    // Display intersection counts
    this.displayIntersectionCounts(intersectionCounts);
  }

  private getLineIntersection(line1: Line, line2: Line): Point | null {
    const x1 = line1.start.x;
    const y1 = line1.start.y;
    const x2 = line1.end.x;
    const y2 = line1.end.y;
    const x3 = line2.start.x;
    const y3 = line2.start.y;
    const x4 = line2.end.x;
    const y4 = line2.end.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    
    if (Math.abs(denom) < 0.001) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
      };
    }

    return null;
  }

  private displayIntersectionCounts(counts: number[][]): void {
    const startX = 150;
    const startY = 450;
    
    this.ctx.fillStyle = '#2c3e50';
    this.ctx.font = 'bold 16px Arial';
    this.ctx.fillText('Intersection Groups:', startX, startY);

    let y = startY + 30;
    let carryOver = 0;
    const totalGroups = counts.length + counts[0].length - 1;
    const resultDigits: number[] = [];

    // Calculate result by diagonal groups (for place values)
    for (let diagonal = 0; diagonal < totalGroups; diagonal++) {
      let sum = 0;
      for (let i = 0; i < counts.length; i++) {
        const j = diagonal - i;
        if (j >= 0 && j < counts[0].length) {
          sum += counts[i][j];
        }
      }
      
      sum += carryOver;
      const digit = sum % 10;
      carryOver = Math.floor(sum / 10);
      resultDigits.unshift(digit);

      this.ctx.fillStyle = '#34495e';
      this.ctx.font = '14px Arial';
      this.ctx.fillText(
        `Group ${diagonal + 1}: ${sum} (digit: ${digit}, carry: ${carryOver})`,
        startX,
        y
      );
      y += 25;
    }

    // Add any remaining carry
    if (carryOver > 0) {
      resultDigits.unshift(carryOver);
    }
  }
}

// Initialize the application
new JapaneseMultiplication();
