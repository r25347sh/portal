(() => {
  "use strict";

  /* ---------- Particle system ---------- */
  const canvas = document.getElementById("particles");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let rafId = null;
  let mouse = { x: -9999, y: -9999 };

  const PARTICLE_COUNT = 70;
  const CONNECTION_DIST = 130;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  class Particle {
    constructor() {
      this.reset(true);
    }

    reset(initial = false) {
      this.x = Math.random() * width;
      this.y = initial ? Math.random() * height : height + 20;
      this.vx = (Math.random() - 0.5) * 0.35;
      this.vy = -0.15 - Math.random() * 0.35;
      this.r = 0.6 + Math.random() * 1.8;
      this.alpha = 0.15 + Math.random() * 0.4;
      this.life = 0;
      this.maxLife = 400 + Math.random() * 600;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.life++;

      // gentle mouse repulsion
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        const force = (120 - dist) / 120;
        this.vx += (dx / dist) * force * 0.25;
        this.vy += (dy / dist) * force * 0.25;
      }

      this.vx *= 0.99;
      this.vy *= 0.99;

      if (
        this.y < -20 ||
        this.x < -30 ||
        this.x > width + 30 ||
        this.life > this.maxLife
      ) {
        this.reset();
      }
    }

    draw() {
      const lifeRatio = this.life / this.maxLife;
      const fade =
        lifeRatio < 0.1
          ? lifeRatio / 0.1
          : lifeRatio > 0.85
          ? (1 - lifeRatio) / 0.15
          : 1;

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 190, 255, ${this.alpha * fade})`;
      ctx.fill();
    }
  }

  function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle());
    }
  }

  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          const opacity = (1 - dist / CONNECTION_DIST) * 0.12;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(180, 170, 255, ${opacity})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
  }

  function loop() {
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.update();
      p.draw();
    }
    drawConnections();

    rafId = requestAnimationFrame(loop);
  }

  /* ---------- Interaction ---------- */
  function onPointerMove(e) {
    const point = e.touches ? e.touches[0] : e;
    mouse.x = point.clientX;
    mouse.y = point.clientY;
  }

  function onPointerLeave() {
    mouse.x = -9999;
    mouse.y = -9999;
  }

  /* ---------- Card tilt (subtle) ---------- */
  function setupCardTilt() {
    const cards = document.querySelectorAll(".card");
    cards.forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `translateY(-8px) scale(1.02) rotateX(${
          -y * 6
        }deg) rotateY(${x * 6}deg)`;
      });

      card.addEventListener("pointerleave", () => {
        card.style.transform = "";
      });
    });
  }

  /* ---------- Init ---------- */
  function init() {
    resize();
    initParticles();
    loop();

    window.addEventListener("resize", () => {
      resize();
      // re-seed a few particles on resize
      particles.forEach((p) => {
        if (p.x > width || p.y > height) p.reset(true);
      });
    });

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("touchmove", onPointerMove, { passive: true });

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setupCardTilt();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();