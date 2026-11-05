/* ============================================================
   fx.js – motion, sound and small interactive touches for every page.
   Pure decoration: the pages work the same if this file fails to load.
   Honors prefers-reduced-motion (nothing moves) and remembers the sound switch.
   Load it right after shared.js, at the end of <body>.
   ============================================================ */
(() => {
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const escText = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- SOUND: tiny synthesized blips (Web Audio, no audio files) ----------
     Browsers allow audio only after the first click / tap / key press, so the page is silent until then. */
  const sound = (() => {
    let enabled = store.get('ppc_sound') !== 'off', ctx = null, out = null, lastTick = 0;
    const unlock = () => {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = .55;
      const soft = ctx.createBiquadFilter();        // low-pass, so nothing sounds shrill
      soft.type = 'lowpass';
      soft.frequency.value = 5200;
      out.connect(soft);
      soft.connect(ctx.destination);
    };
    ['pointerdown', 'keydown'].forEach(t => addEventListener(t, unlock, { capture: true, passive: true }));

    function note(freq, { at = 0, dur = .12, gain = .04, type = 'sine', bend = 1 } = {}) {
      if (!enabled || !ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + .006);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + dur + .03);
    }
    const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];   // C major pentatonic
    return {
      get enabled() { return enabled; },
      set enabled(v) { enabled = v; store.set('ppc_sound', v ? 'on' : 'off'); },
      tick() {                                       // hover
        const n = performance.now();
        if (n - lastTick < 45) return;
        lastTick = n;
        note(rand(1800, 2300), { dur: .04, gain: .018, type: 'triangle' });
      },
      click() { note(620, { dur: .16, gain: .05, type: 'triangle', bend: 1.6 }); note(1240, { at: .025, dur: .12, gain: .018 }); },
      chime() { for (let i = 0; i < 3; i++) note(PENTA[Math.floor(Math.random() * PENTA.length)], { at: i * .065, dur: .6, gain: .03 }); },
      on() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, { at: i * .06, dur: .35, gain: .035 })); },
      off() { note(523.25, { dur: .2, gain: .03, bend: .6 }); }
    };
  })();

  // sound switch at the end of the nav
  const navList = document.querySelector('.nav ul');
  if (navList) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.className = 'snd';
    b.title = 'Sound on / off';
    b.innerHTML = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="lbl">Sound</span>';
    const sync = () => b.setAttribute('aria-pressed', String(sound.enabled));
    b.addEventListener('click', () => {
      if (sound.enabled) { sound.off(); sound.enabled = false; } else { sound.enabled = true; sound.on(); }
      sync();
    });
    sync();
    li.appendChild(b);
    navList.appendChild(li);
  }

  // a soft tick when the mouse goes over something clickable, a click when it's pressed
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse' || !(e.target instanceof Element)) return;
    const t = e.target.closest('a, button');
    if (t && !(e.relatedTarget instanceof Node && t.contains(e.relatedTarget))) sound.tick();
  });
  document.addEventListener('click', e => {
    const t = e.target instanceof Element && e.target.closest('a, button');
    if (t && !t.classList.contains('snd')) sound.click();
  });

  /* ---------- scroll progress bar ---------- */
  const bar = document.createElement('div');
  bar.className = 'progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  let barRaf = 0;
  const progress = () => {
    barRaf = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  addEventListener('scroll', () => { if (!barRaf) barRaf = requestAnimationFrame(progress); }, { passive: true });
  addEventListener('resize', progress);
  progress();

  /* ---------- text scramble: letters shuffle, then settle left to right ---------- */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>';
  function scramble(el, dur = 450) {
    if (!motion || el._scr) return;
    const text = el.dataset.text || (el.dataset.text = el.textContent);
    el._scr = true;
    el.style.minWidth = el.offsetWidth + 'px';
    const t0 = performance.now();
    requestAnimationFrame(function step(now) {
      const p = Math.min(1, (now - t0) / dur), done = Math.floor(p * text.length);
      el.textContent = [...text].map((c, i) => i < done || c === ' ' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join('');
      if (p < 1) requestAnimationFrame(step);
      else { el.textContent = text; el.style.minWidth = ''; el._scr = false; }
    });
  }
  document.querySelectorAll('.nav ul a').forEach(a => a.addEventListener('pointerenter', () => scramble(a)));
  document.querySelectorAll('[data-scramble]').forEach((el, i) => setTimeout(() => scramble(el, 800), 900 + i * 220));

  /* ---------- [data-split]: letters rise in one by one, then a light sweeps over the word (.shine) ---------- */
  if (motion) document.querySelectorAll('[data-split]').forEach(el => {
    const text = el.textContent.trim();
    if (!text) return;
    el.setAttribute('aria-label', text);
    el.innerHTML = [...text].map((c, i) => c === ' ' ? ' ' : `<span class="ch" aria-hidden="true" style="--i:${i}">${escText(c)}</span>`).join('');
    const chars = el.querySelectorAll('.ch');
    chars[chars.length - 1].addEventListener('animationend', () => {
      el.textContent = text;                         // back to plain text (font-kerning:none keeps it pixel-identical)
      el.removeAttribute('aria-label');
      el.classList.add('shine');
    }, { once: true });
  });

  /* ---------- mouse only: tilting cards, magnetic buttons, spotlights, cursor glow ---------- */
  if (fine) {
    let card = null, btn = null;
    const resetCard = () => { if (card) card.style.transform = ''; card = null; };
    const resetBtn = () => { if (btn) btn.style.translate = ''; btn = null; };
    addEventListener('pointermove', e => {
      const t = e.target instanceof Element ? e.target : null;

      const c = t && t.closest('.gcard');
      if (c !== card) resetCard();
      if (c) {
        card = c;
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        c.style.setProperty('--mx', x + 'px');
        c.style.setProperty('--my', y + 'px');
        if (motion) c.style.transform = `perspective(900px) rotateX(${(.5 - y / r.height) * 7}deg) rotateY(${(x / r.width - .5) * 9}deg) translateY(-4px)`;
      }

      const b = t && t.closest('.btn');
      if (b !== btn) resetBtn();
      if (b && motion) {
        btn = b;
        const r = b.getBoundingClientRect();
        b.style.translate = `${(e.clientX - r.left - r.width / 2) * .25}px ${(e.clientY - r.top - r.height / 2) * .4}px`;
      }

      const s = t && t.closest('[data-spot]');
      if (s) {
        const r = s.getBoundingClientRect();
        s.style.setProperty('--mx', e.clientX - r.left + 'px');
        s.style.setProperty('--my', e.clientY - r.top + 'px');
      }
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { resetCard(); resetBtn(); });

    if (motion) {                                     // soft pink light trailing the cursor
      const g = document.createElement('div');
      g.className = 'glow';
      g.setAttribute('aria-hidden', 'true');
      document.body.appendChild(g);
      let x = innerWidth / 2, y = innerHeight / 3, tx = x, ty = y, raf = 0;
      const follow = () => {
        x += (tx - x) * .12;
        y += (ty - y) * .12;
        g.style.transform = `translate(${x}px, ${y}px)`;
        raf = Math.abs(tx - x) + Math.abs(ty - y) > .5 ? requestAnimationFrame(follow) : 0;
      };
      addEventListener('pointermove', e => {
        tx = e.clientX; ty = e.clientY;
        g.classList.add('on');
        if (!raf) raf = requestAnimationFrame(follow);
      }, { passive: true });
      document.documentElement.addEventListener('pointerleave', () => g.classList.remove('on'));
    }
  }

  /* ---------- falling petals on a <canvas class="petals">: they dodge the cursor, a click makes them burst ---------- */
  function petals(canvas) {
    const host = canvas.parentElement, ctx = canvas.getContext('2d');
    const COLORS = ['#ffb3d1', '#ff8fbd', '#ff6fa8', '#e9dfe4'];     // pinks of the logo + one pale, nothing else
    let W = 0, H = 0, list = [], burst = [], raf = 0, last = 0, seen = true, mx = -1e4, my = -1e4;
    const make = top => ({
      x: rand(0, W), y: top ? rand(-40, -10) : rand(-20, H), s: rand(5, 11), vy: rand(.25, .7), vx: rand(-.15, .15),
      sw: rand(.6, 1.6), ph: rand(0, 6.28), r: rand(0, 6.28), vr: rand(-.015, .015), fl: rand(1.2, 2.8), a: rand(.35, .8),
      c: COLORS[Math.floor(Math.random() * COLORS.length)]
    });
    function size() {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = host.clientWidth; H = host.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.max(12, Math.min(40, W / 40)));
      while (list.length < n) list.push(make(false));
      list.length = n;
    }
    function draw(p, t, alpha) {                     // a teardrop petal that flutters (squashes) as it turns
      const s = p.s;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(Math.max(.15, Math.abs(Math.cos(t * p.fl + p.ph))), 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * .95, -s * .55, s * .55, s * .7, 0, s);
      ctx.bezierCurveTo(-s * .55, s * .7, -s * .95, -s * .55, 0, -s);
      ctx.fill();
      ctx.restore();
    }
    function frame(now) {
      raf = 0;
      if (!seen || document.hidden) return;          // paused off-screen and in background tabs
      const k = last ? Math.min(3, (now - last) / 16.7) : 1, t = now / 1000;
      last = now;
      ctx.clearRect(0, 0, W, H);
      for (const p of list) {
        p.y += p.vy * k;
        p.x += (p.vx + Math.sin(t * p.sw + p.ph) * .35) * k;
        p.r += p.vr * k;
        const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
        if (d2 < 14400) {                            // within 120px of the cursor: drift away
          const d = Math.sqrt(d2) || 1, f = (1 - d / 120) * 2.4 * k;
          p.x += dx / d * f;
          p.y += dy / d * f;
        }
        if (p.y > H + 20 || p.x < -30 || p.x > W + 30) Object.assign(p, make(true));
        draw(p, t, p.a);
      }
      for (let i = burst.length - 1; i >= 0; i--) {
        const p = burst[i];
        p.vy += .06 * k; p.vx *= .985;
        p.x += p.vx * k; p.y += p.vy * k; p.r += p.vr * k;
        p.life -= .012 * k;
        if (p.life <= 0) burst.splice(i, 1); else draw(p, t, p.a * p.life);
      }
      raf = requestAnimationFrame(frame);
    }
    const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    size();
    addEventListener('resize', size);
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; if (seen) start(); }).observe(host);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
    host.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
    host.addEventListener('pointerleave', () => { mx = my = -1e4; });
    host.addEventListener('pointerdown', e => {
      if (e.target instanceof Element && e.target.closest('a, button')) return;
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      for (let i = 0; i < 18; i++) {
        const ang = rand(0, Math.PI * 2), sp = rand(1.5, 5.5);
        burst.push({ ...make(false), x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, vr: rand(-.12, .12), s: rand(6, 12), a: rand(.6, 1), life: 1 });
      }
      sound.chime();
      start();
    });
    start();
  }
  if (motion) document.querySelectorAll('canvas.petals').forEach(petals);

  /* ---------- marquee: endless strip of words; scrolling speeds it up, scrolling up runs it backwards ---------- */
  const strips = new Set();
  function marquee(track, items) {
    if (!track || !items.length) return;
    if (track._anim) { track._anim.cancel(); strips.delete(track._anim); }
    let words = items.length % 2 ? [...items, ...items] : [...items];   // even count keeps outline / gradient alternating at the seam
    const group = list => `<div class="grp">${list.map(w => `<span>${escText(w)}</span><i>✦</i>`).join('')}</div>`;
    track.innerHTML = group(words);
    while (track.firstElementChild.offsetWidth < innerWidth && words.length < 48) {   // one group must be wider than the screen
      words = [...words, ...words];
      track.innerHTML = group(words);
    }
    if (!motion) return;
    track.insertAdjacentHTML('beforeend', group(words));
    const w = track.firstElementChild.offsetWidth;
    track._anim = track.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-w}px)` }], { duration: w / 55 * 1000, iterations: Infinity });
    strips.add(track._anim);
  }
  let lastY = scrollY, vel = 0, rate = 1, vRaf = 0;
  const speed = () => {
    vRaf = 0;
    const target = 1 + Math.max(-6, Math.min(6, vel * .08));
    vel *= .85;
    rate += (target - rate) * .15;
    strips.forEach(a => { a.playbackRate = rate; });
    if (Math.abs(rate - 1) > .01 || Math.abs(vel) > .5) vRaf = requestAnimationFrame(speed);
    else { rate = 1; strips.forEach(a => { a.playbackRate = 1; }); }
  };
  addEventListener('scroll', () => {
    vel += scrollY - lastY;
    lastY = scrollY;
    if (motion && strips.size && !vRaf) vRaf = requestAnimationFrame(speed);
  }, { passive: true });

  window.PPFX = { sound, scramble, marquee };
})();
