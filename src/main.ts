import './style.css';
import { buildGeometry, Geometry, zoneColor, zoneName, cssColor, ZONE_COLORS, COLOR_A, COLOR_B } from './geometry';
import { buildSteps, renderBreakdown, Step } from './lesson';
import { createWebGPURenderer, createCanvas2DRenderer, Renderer, SceneState } from './renderer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const main = async () => {
  const canvas = $<HTMLCanvasElement>('canvas');
  let renderer: Renderer | null = null;
  try { renderer = await createWebGPURenderer(canvas); } catch (e) { console.warn('WebGPU init failed', e); }
  if (!renderer) {
    // A canvas that has had getContext('webgpu') called can't switch to 2d — swap it out.
    const fresh = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    renderer = createCanvas2DRenderer(fresh);
    renderer.resize();
  }
  const R = renderer;
  const stageCanvas = $<HTMLCanvasElement>('canvas');
  $('renderer-tag').textContent = R.kind === 'webgpu' ? 'WebGPU · 3D' : '2D mode';

  const inputA = $<HTMLInputElement>('num-a');
  const inputB = $<HTMLInputElement>('num-b');
  const overlay = $('overlay');
  const equation = $('equation');
  const breakdown = $('breakdown');
  const lessonTitle = $('lesson-title');
  const lessonText = $('lesson-text');
  const progress = $('lesson-progress');
  const btnPlay = $<HTMLButtonElement>('btn-play');
  const quizCard = $('quiz-card');
  const quizInput = $<HTMLInputElement>('quiz-input');
  const quizFeedback = $('quiz-feedback');
  const quizStreak = $('quiz-streak');
  const btnQuiz = $<HTMLButtonElement>('btn-quiz');

  // Legend
  $('legend').innerHTML = ZONE_COLORS.slice(0, 6).map((c, z) =>
    `<span class="legend-item"><i style="background:${cssColor(c)};box-shadow:0 0 10px ${cssColor(c, .7)}"></i>${zoneName(z)}</span>`).join('');

  // ---------------------------------------------------------------- state
  let geo: Geometry;
  let steps: Step[] = [];
  let stepIdx = 0;
  let playing = false;
  let stepArrivedAt = 0;
  let quiz = false, solved = false, streak = 0;
  const scene: SceneState = { revealA: 0, revealB: 0, zonesShown: 0, focusZone: -1, focusAmt: 0, time: 0, yaw: 0, pitch: 1.05, zoom: 1 };
  let labelEls: { el: HTMLElement; x: number; y: number }[] = [];
  let badgeEls: { el: HTMLElement; z: number; x: number; y: number }[] = [];

  const maxStep = () => (quiz && !solved ? steps.length - 2 : steps.length - 1);

  const setProblem = (a: number, b: number, opts: { autoplay?: boolean } = {}) => {
    a = Math.min(Math.max(Math.floor(a) || 1, 1), 9999);
    b = Math.min(Math.max(Math.floor(b) || 1, 1), 9999);
    inputA.value = String(a); inputB.value = String(b);
    geo = buildGeometry(a, b);
    steps = buildSteps(geo);
    R.setGeometry(geo);
    Object.assign(scene, { revealA: 0, revealB: 0, zonesShown: 0, focusZone: -1, focusAmt: 0 });
    solved = false;
    quizInput.value = ''; quizFeedback.textContent = ''; quizFeedback.className = 'quiz-feedback';
    history.replaceState(null, '', `#${a}x${b}`);
    document.querySelectorAll<HTMLButtonElement>('.presets button').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.p === `${a}x${b}`));

    // overlay labels (digits at the end of each bundle) + zone count badges
    overlay.innerHTML = '';
    labelEls = geo.labels.map(l => {
      const el = document.createElement('div');
      el.className = `digit-label ${l.type === 'A' ? 'la' : 'lb'}`;
      el.textContent = l.text;
      overlay.appendChild(el);
      return { el, x: l.x, y: l.y };
    });
    // one badge per partial product (bundle × bundle), e.g. "24 · 4×6 tens"
    const all = geo.dots.length ? geo.dots : [{ x: 0, y: 0 }];
    const gx = all.reduce((s, d) => s + d.x, 0) / all.length, gy = all.reduce((s, d) => s + d.y, 0) / all.length;
    badgeEls = geo.clusters.map(k => {
      // anchor just outside the cluster, pointing away from the middle of the diagram
      let dx = k.cx - gx, dy = k.cy - gy;
      const dl = Math.hypot(dx, dy);
      if (dl < 0.05) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
      const r = Math.max(...geo.dots.filter(d => d.zone === k.zone && Math.hypot(d.x - k.cx, d.y - k.cy) < 1.5)
        .map(d => Math.abs((d.x - k.cx) * dx + (d.y - k.cy) * dy)), 0);
      const el = document.createElement('div');
      el.className = 'zone-badge';
      el.style.setProperty('--zc', cssColor(zoneColor(k.zone)));
      el.innerHTML = `<b>${k.count}</b><span>${k.da}×${k.db} · ${zoneName(k.zone)}</span>`;
      overlay.appendChild(el);
      return { el, z: k.zone, x: k.cx + dx * (r + 0.32), y: k.cy + dy * (r + 0.32) };
    });

    progress.innerHTML = steps.map((_, i) => `<button data-i="${i}" aria-label="Go to step ${i + 1}"></button>`).join('');
    goTo(0);
    setPlaying(opts.autoplay ?? true);
  };

  const renderEquation = () => {
    const showAns = steps[stepIdx]?.target.showAnswer;
    equation.innerHTML =
      `<span style="color:${cssColor(COLOR_A)}">${geo.a}</span><span class="op">×</span>` +
      `<span style="color:${cssColor(COLOR_B)}">${geo.b}</span><span class="op">=</span>` +
      `<span class="ans ${showAns ? 'shown' : ''}">${showAns ? geo.product.toLocaleString() : '?'}</span>`;
  };

  const goTo = (i: number) => {
    const prev = stepIdx;
    stepIdx = Math.min(Math.max(i, 0), maxStep());
    const s = steps[stepIdx];
    lessonTitle.textContent = s.title;
    lessonText.innerHTML = s.html;
    lessonText.classList.remove('fade'); void lessonText.offsetWidth; lessonText.classList.add('fade');
    breakdown.innerHTML = renderBreakdown(geo, s.columns, !s.target.showAnswer);
    progress.querySelectorAll('button').forEach((b, k) => {
      b.classList.toggle('done', k < stepIdx);
      b.classList.toggle('cur', k === stepIdx);
      (b as HTMLButtonElement).disabled = k > maxStep();
    });
    // stepping backwards rewinds the drawing instantly
    if (stepIdx < prev) {
      scene.revealA = Math.min(scene.revealA, s.target.revealA);
      scene.revealB = Math.min(scene.revealB, s.target.revealB);
      scene.zonesShown = Math.min(scene.zonesShown, s.target.zonesShown);
    }
    if (s.target.focusZone >= 0) scene.focusZone = s.target.focusZone;
    stepArrivedAt = -1;
    renderEquation();
    if (s.target.showAnswer && stepIdx !== prev) celebrate();
    if (quiz && stepIdx === maxStep() && !solved) {
      quizFeedback.textContent = 'All columns counted — what is the answer?';
      quizInput.focus({ preventScroll: true });
    }
  };

  const setPlaying = (p: boolean) => {
    playing = p;
    btnPlay.textContent = p ? '❚❚' : '▶';
    btnPlay.setAttribute('aria-label', p ? 'Pause' : 'Play');
    btnPlay.classList.toggle('on', p);
  };

  // ---------------------------------------------------------------- celebration
  const celebrate = () => {
    const box = $('celebrate');
    box.innerHTML = '';
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('i');
      const c = ZONE_COLORS[i % 6];
      s.style.background = cssColor(c);
      s.style.left = `${50 + (Math.random() - 0.5) * 30}%`;
      s.style.setProperty('--dx', `${(Math.random() - 0.5) * 900}px`);
      s.style.setProperty('--dy', `${-200 - Math.random() * 400}px`);
      s.style.setProperty('--r', `${Math.random() * 720}deg`);
      s.style.animationDelay = `${Math.random() * 0.15}s`;
      box.appendChild(s);
    }
    equation.classList.remove('boom'); void equation.offsetWidth; equation.classList.add('boom');
  };

  // ---------------------------------------------------------------- quiz
  const randomProblem = () => {
    const r = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
    return Math.random() < 0.7 ? [r(11, 99), r(11, 99)] : [r(101, 399), r(11, 99)];
  };
  const setQuiz = (on: boolean) => {
    quiz = on;
    btnQuiz.setAttribute('aria-pressed', String(on));
    btnQuiz.textContent = on ? '✕ Exit quiz' : '🧠 Quiz me';
    quizCard.hidden = !on;
    document.body.classList.toggle('quiz-mode', on);
    if (on) { const [a, b] = randomProblem(); setProblem(a, b, { autoplay: false }); }
    else goTo(stepIdx);
  };
  $('quiz-form').addEventListener('submit', e => {
    e.preventDefault();
    if (solved) { const [a, b] = randomProblem(); setProblem(a, b, { autoplay: false }); quizInput.focus(); return; }
    const guess = Number(quizInput.value);
    if (!quizInput.value) return;
    if (guess === geo.product) {
      solved = true; streak++;
      quizFeedback.textContent = `✅ Correct! ${geo.a} × ${geo.b} = ${geo.product}. Press Check for the next one.`;
      quizFeedback.className = 'quiz-feedback good';
      goTo(steps.length - 1);
    } else {
      streak = 0;
      // Find the first column the guess gets wrong (from the right) to give a useful hint.
      const want = String(geo.product).split('').reverse();
      const got = String(Math.abs(guess)).split('').reverse();
      const bad = want.findIndex((d, k) => got[k] !== d);
      const z = Math.min(bad < 0 ? 0 : bad, geo.zones.length - 1);
      quizFeedback.innerHTML = `Not quite — check the <b style="color:${cssColor(zoneColor(z))}">${zoneName(z).toLowerCase()}</b> column` +
        (geo.carries[z]?.carryIn ? ' (remember the carry!)' : '') + '.';
      quizFeedback.className = 'quiz-feedback bad';
      quizCard.classList.remove('shake'); void quizCard.offsetWidth; quizCard.classList.add('shake');
      // show them that column
      goTo(Math.min(3 + z, maxStep()));
      setPlaying(false);
    }
    quizStreak.textContent = String(streak);
  });

  // ---------------------------------------------------------------- inputs
  let debounce = 0;
  const fromInputs = () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      if (quiz) setQuiz(false);
      setProblem(Number(inputA.value), Number(inputB.value));
    }, 350);
  };
  inputA.addEventListener('input', fromInputs);
  inputB.addEventListener('input', fromInputs);
  document.querySelectorAll<HTMLButtonElement>('.presets button').forEach(b =>
    b.addEventListener('click', () => {
      if (quiz) setQuiz(false);
      const [a, c] = b.dataset.p!.split('x').map(Number);
      setProblem(a, c);
    }));
  $('btn-random').addEventListener('click', () => { if (quiz) setQuiz(false); const [a, b] = randomProblem(); setProblem(a, b); });
  btnQuiz.addEventListener('click', () => setQuiz(!quiz));
  $('btn-prev').addEventListener('click', () => { setPlaying(false); goTo(stepIdx - 1); });
  $('btn-next').addEventListener('click', () => { setPlaying(false); goTo(stepIdx + 1); });
  $('btn-restart').addEventListener('click', () => {
    Object.assign(scene, { revealA: 0, revealB: 0, zonesShown: 0, focusAmt: 0 });
    goTo(0); setPlaying(true);
  });
  btnPlay.addEventListener('click', () => {
    if (!playing && stepIdx >= maxStep()) { Object.assign(scene, { revealA: 0, revealB: 0, zonesShown: 0 }); goTo(0); }
    setPlaying(!playing);
  });
  progress.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button');
    if (t && !t.disabled) { setPlaying(false); goTo(Number(t.dataset.i)); }
  });
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') { setPlaying(false); goTo(stepIdx + 1); }
    else if (e.key === 'ArrowLeft') { setPlaying(false); goTo(stepIdx - 1); }
    else if (e.key === ' ') { e.preventDefault(); btnPlay.click(); }
    else if (e.key.toLowerCase() === 'r') $('btn-restart').click();
  });

  // camera: drag to orbit, wheel to zoom
  let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  stageCanvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, yaw: scene.yaw, pitch: scene.pitch };
    stageCanvas.setPointerCapture(e.pointerId);
    document.body.classList.add('dragged');
  });
  stageCanvas.addEventListener('pointermove', e => {
    if (!drag) return;
    scene.yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
    scene.pitch = Math.min(Math.max(drag.pitch + (e.clientY - drag.y) * 0.005, 0.35), 1.52);
  });
  stageCanvas.addEventListener('pointerup', () => { drag = null; });
  stageCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    scene.zoom = Math.min(Math.max(scene.zoom * Math.exp(-e.deltaY * 0.0012), 0.5), 4);
  }, { passive: false });
  stageCanvas.addEventListener('dblclick', () => { scene.yaw = 0; scene.pitch = 1.05; scene.zoom = 1; });

  new ResizeObserver(() => R.resize()).observe(stageCanvas);

  // ---------------------------------------------------------------- loop
  const approach = (v: number, t: number, step: number) => (v < t ? Math.min(v + step, t) : Math.max(v - step, t));
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    scene.time = now;
    const s = steps[stepIdx];
    if (s) {
      const t = s.target;
      scene.revealA = approach(scene.revealA, t.revealA, dt / 1.6);
      scene.revealB = approach(scene.revealB, t.revealB, dt / 1.6);
      const zc = geo.zones[Math.floor(scene.zonesShown)]?.count ?? 1;
      scene.zonesShown = approach(scene.zonesShown, t.zonesShown, dt / (0.5 + Math.min(zc, 30) * 0.06));
      const fTarget = t.focusZone >= 0 ? 1 : 0;
      scene.focusAmt += (fTarget - scene.focusAmt) * Math.min(dt * 5, 1);

      const settled = scene.revealA === t.revealA && scene.revealB === t.revealB && scene.zonesShown === t.zonesShown;
      if (settled && stepArrivedAt < 0) stepArrivedAt = now;
      if (playing && settled && stepArrivedAt >= 0 && now - stepArrivedAt > s.duration * 0.55) {
        if (stepIdx < maxStep()) goTo(stepIdx + 1);
        else setPlaying(false);
      }
    }

    R.render(scene);

    // overlay positions
    labelEls.forEach(l => {
      const p = R.toScreen(l.x, l.y);
      const lineShown = l.el.classList.contains('la') ? scene.revealA : scene.revealB;
      if (p) { l.el.style.left = `${p.x}px`; l.el.style.top = `${p.y}px`; }
      l.el.classList.toggle('show', !!p && lineShown > 0.05);
    });
    badgeEls.forEach(b => {
      const p = R.toScreen(b.x, b.y);
      if (p) { b.el.style.left = `${p.x}px`; b.el.style.top = `${p.y}px`; }
      const focusing = scene.focusAmt > 0.5;
      const visible = scene.zonesShown >= b.z + 0.85 && (focusing ? b.z === scene.focusZone : badgeEls.length <= 4);
      b.el.classList.toggle('show', !!p && visible);
      b.el.classList.toggle('focus', b.z === scene.focusZone && scene.focusAmt > 0.5);
    });

    requestAnimationFrame(frame);
  };

  const fromHash = location.hash.match(/^#(\d+)x(\d+)$/);
  if (fromHash) setProblem(Number(fromHash[1]), Number(fromHash[2]));
  else setProblem(23, 12);
  requestAnimationFrame(frame);
};

document.addEventListener('DOMContentLoaded', main);
