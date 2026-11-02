// The 3D base behind the panel: a slow perspective campus (ground grid, road, glass towers) drawn on one 2D canvas.
// Plain canvas on purpose: this app ships zero runtime deps and has no bundler, so Three.js is not an option here.
// Rules: DPR <= 1.5, ~30 fps, paused while the window is hidden, one still frame under prefers-reduced-motion.
// The same scene is inlined in boombignose/cmd/boombignose-desktop/frontend/dist/index.html (keep them in step).

type P = [number, number, number];
const TOWERS: [number, number, number, number, number][] = [ // x, z, width, depth, height
  [-5, 3, 1.4, 1.4, 2.6], [-2.6, 5, 1.1, 1.1, 1.6], [0.5, 4, 1.6, 1.2, 3.4], [3, 5.5, 1.2, 1.2, 2.2], [5.5, 3.2, 1.5, 1.5, 2.9],
  [-6, -3, 1.2, 1.2, 1.4], [6.2, -2.4, 1.3, 1.3, 1.9], [-1.5, -5.5, 1.4, 1.1, 2.1], [2.8, -4.6, 1.1, 1.1, 1.2],
];

export function drawStage(g: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const yaw = t * 0.00006 + 0.5, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const f = Math.min(w, h * 1.5) * 0.9;
  const proj = ([x, y, z]: P): [number, number, number] => {
    const rx = x * cs - z * sn, rz = x * sn + z * cs + 11; // camera 11 units back, 3.2 up, looking down a little
    const k = f / rz;
    return [w / 2 + rx * k, h * 0.62 - (y - 3.2) * k - 0.16 * h * (1 - 6 / rz), rz];
  };
  g.clearRect(0, 0, w, h);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0b1222'); sky.addColorStop(0.55, '#0f1c38'); sky.addColorStop(1, '#0b1222');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(115,136,176,.22)';
  for (let i = -12; i <= 12; i += 2) { // ground grid
    for (const [a, b] of [[[i, 0, -12], [i, 0, 12]], [[-12, 0, i], [12, 0, i]]] as [P, P][]) {
      const [x1, y1, z1] = proj(a), [x2, y2, z2] = proj(b);
      if (z1 < 0.5 || z2 < 0.5) continue;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
  }
  g.strokeStyle = 'rgba(245,158,66,.55)'; g.lineWidth = 2; // orange road loop with a moving truck
  const ring = (a: number): P => [Math.cos(a) * 4, 0, Math.sin(a) * 2.6 - 0.4];
  g.beginPath();
  for (let a = 0; a <= 6.3; a += 0.2) { const [x, y] = proj(ring(a)); if (a === 0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
  const [tx, ty, tz] = proj(ring(t * 0.0006));
  g.fillStyle = '#f5c561'; g.fillRect(tx - 120 / tz, ty - 90 / tz, 240 / tz, 90 / tz);
  const boxes = TOWERS.map(([x, z, bw, bd, bh]) => {
    const c: P[] = [[x - bw / 2, 0, z - bd / 2], [x + bw / 2, 0, z - bd / 2], [x + bw / 2, 0, z + bd / 2], [x - bw / 2, 0, z + bd / 2]];
    return { c, bh, depth: proj([x, 0, z])[2] };
  }).sort((a, b) => b.depth - a.depth); // far first
  boxes.forEach(({ c, bh }, n) => {
    const base = c.map(proj), top = c.map(([x, , z]) => proj([x, bh, z]));
    g.lineWidth = 1; g.strokeStyle = n % 4 === 0 ? 'rgba(245,158,66,.7)' : 'rgba(120,150,210,.55)';
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      g.fillStyle = `rgba(20,36,70,${0.55 + i * 0.07})`;
      g.beginPath(); g.moveTo(base[i]![0], base[i]![1]); g.lineTo(base[j]![0], base[j]![1]); g.lineTo(top[j]![0], top[j]![1]); g.lineTo(top[i]![0], top[i]![1]); g.closePath(); g.fill(); g.stroke();
    }
    g.fillStyle = 'rgba(40,64,110,.7)';
    g.beginPath(); top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.stroke();
  });
  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); // keeps panels readable
  vig.addColorStop(0, 'rgba(11,18,34,0)'); vig.addColorStop(1, 'rgba(11,18,34,.7)');
  g.fillStyle = vig; g.fillRect(0, 0, w, h);
}

/** Adds the stage canvas as the first child of <body>. Returns a stop function. */
export function mountStage(): () => void {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  canvas.setAttribute('aria-hidden', 'true');
  const g = canvas.getContext('2d');
  if (!g) return () => {};
  document.body.prepend(canvas);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0, last = 0;
  const size = (): [number, number] => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [innerWidth, innerHeight];
  };
  let [w, h] = size();
  const frame = (now: number): void => {
    raf = 0;
    if (now - last >= 33) { last = now; drawStage(g, w, h, now); }
    if (!still.matches && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = (): void => { if (!raf) raf = requestAnimationFrame(frame); };
  const onResize = (): void => { [w, h] = size(); last = 0; kick(); };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', kick);
  still.addEventListener('change', kick);
  kick();
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', kick); still.removeEventListener('change', kick); canvas.remove(); };
}
