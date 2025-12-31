// src/GameCanvas.tsx
import { useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

type GateOpType = "add" | "sub" | "mul" | "div";
type GateOp = { type: GateOpType; amount: number; label: string };

type Rect = { x: number; y: number; w: number; h: number };
type Gate = Rect & { op: GateOp; used: boolean };
type Enemy = Rect & { hp: number; damage: number };
type Zombie = Enemy;
type Boss = Enemy;
type Obstacle = Rect & { hp: number; maxHp: number };
type Item = Rect & { type: "attack"; vy: number; bonus: number; collected?: boolean };
type Bullet = Rect & { vx: number; vy: number; life: number; dmg: number };
type Floater = { text: string; x: number; y: number; vy: number; life: number };
type HudState = { value: number; dist: number; alive: boolean };

const LOGICAL_W = 360;
const LOGICAL_H = 640;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function aabb(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

const PLAYER_SEGMENT_WIDTH = 10;
const BASE_PLAYER_SEGMENT_SPACING = 8;
const MIN_PLAYER_SEGMENT_SPACING = 2;
const BOSS_INTERVAL = 2000;
const BOSS_SPAWN_MARGIN = 40;
const BOSS_WIDTH = 90;
const BOSS_HEIGHT = 90;
const MAX_PLAYER_SEGMENTS = 20;
const MIN_PLAYER_WIDTH = 32;
const OBSTACLE_WIDTH = 56;
const OBSTACLE_HEIGHT = 56;
const OBSTACLE_HP_BASE = 32;
const OBSTACLE_HP_PER_DIST = 10;
const ATTACK_ITEM_SIZE = 22;
const ATTACK_ITEM_FALL_SPEED = 140;
const MAX_ATTACK_BONUS = 6;

function getPlayerCount(value: number) {
  const intValue = Math.max(0, Math.floor(value));
  return Math.max(1, Math.min(MAX_PLAYER_SEGMENTS, intValue));
}

function getCrowdWidth(count: number) {
  if (count <= 0) return MIN_PLAYER_WIDTH;
  return (
    count * PLAYER_SEGMENT_WIDTH +
    Math.max(0, count - 1) * getPlayerSegmentSpacing(count)
  );
}

function getPlayerSegmentSpacing(count: number) {
  if (count <= 1) return BASE_PLAYER_SEGMENT_SPACING;
  const reduction = Math.floor((count - 1) / 4);
  return Math.max(
    MIN_PLAYER_SEGMENT_SPACING,
    BASE_PLAYER_SEGMENT_SPACING - reduction
  );
}

function getPlayerSegmentPositions(player: Rect, count: number) {
  const totalSegmentWidth = getCrowdWidth(count);
  const segmentStartX =
    player.x + Math.max(0, (player.w - totalSegmentWidth) / 2);
  const positions = [];
  const spacing = getPlayerSegmentSpacing(count);
  for (let i = 0; i < count; i++) {
    positions.push({
      x: segmentStartX + i * (PLAYER_SEGMENT_WIDTH + spacing),
    });
  }
  return positions;
}

function applyGate(value: number, op: GateOp) {
  let v = value;
  switch (op.type) {
    case "add":
      v = v + op.amount;
      break;
    case "sub":
      v = v - op.amount;
      break;
    case "mul":
      v = v * op.amount;
      break;
    case "div":
      v = Math.floor(v / op.amount);
      break;
  }
  return Math.max(0, v);
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const [hud, setHud] = useState<HudState>({ value: 1, dist: 0, alive: true });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    return runGame(canvas, ctx, rafRef, setHud);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <canvas ref={canvasRef} />
      <div
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          color: "#fff",
          font: "bold 14px system-ui",
          pointerEvents: "none",
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
        }}
      >
        VALUE: {hud.value}
        <br />
        DIST: {hud.dist}m
        <br />
        {hud.alive ? "" : "DEAD"}
      </div>
    </div>
  );
}

function runGame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  rafRef: RefObject<number | null>,
  setHud: Dispatch<SetStateAction<HudState>>
) {
  const state = {
    time: 0,
    dist: 0,
    speed: 180,
    scoreValue: 1,
    alive: true,

    targetX: LOGICAL_W / 2,
    pointerDown: false,

    gates: [] as Gate[],
    zombies: [] as Zombie[],
    bosses: [] as Boss[],
    obstacles: [] as Obstacle[],
    items: [] as Item[],
    bullets: [] as Bullet[],
    floaters: [] as Floater[],

    shootCooldown: 0,
    lastSeg: -1,
    nextBossDist: BOSS_INTERVAL,
    attackBonus: 0,
  };

  const player: Rect = {
    x: LOGICAL_W / 2 - 16,
    y: LOGICAL_H - 120,
    w: 32,
    h: 40,
  };

  function resize() {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    const scale = Math.min(ww / LOGICAL_W, wh / LOGICAL_H);
    const cssW = Math.floor(LOGICAL_W * scale);
    const cssH = Math.floor(LOGICAL_H * scale);

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(LOGICAL_W * dpr);
    canvas.height = Math.floor(LOGICAL_H * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeGate(
    x: number,
    y: number,
    w: number,
    h: number,
    op: GateOp
  ): Gate {
    return { x, y, w, h, op, used: false };
  }

  function spawnGatePair(y: number) {
    const ops: GateOp[] = [
      { type: "add", amount: 5, label: "+10" },
      { type: "mul", amount: 2, label: "×2" },
      { type: "sub", amount: 5, label: "-5" },
      { type: "div", amount: 2, label: "÷2" },
    ];
    const a = ops[(Math.random() * ops.length) | 0];
    const b = ops[(Math.random() * ops.length) | 0];

    const gateW = 130;
    const gateH = 44;
    const verticalSpacing = gateH + 120;
    state.gates.push(
      makeGate(LOGICAL_W * 0.25 - gateW / 2, y, gateW, gateH, a)
    );
    state.gates.push(
      makeGate(
        LOGICAL_W * 0.75 - gateW / 2,
        y - verticalSpacing,
        gateW,
        gateH,
        b
      )
    );
  }

  function spawnZombies(y: number) {
    const earlyWave = 6;
    const randomBonus = 3 + ((Math.random() * 6) | 0);
    const intensity = Math.floor(state.dist / 800);
    const count = Math.min(40, earlyWave + randomBonus + intensity);
    for (let i = 0; i < count; i++) {
      const zx = 40 + Math.random() * (LOGICAL_W - 80);
      state.zombies.push({
        x: zx - 18,
        y: y + i * 40,
        w: 36,
        h: 36,
        hp: 12 + Math.floor(state.dist / 200) * 8,
        damage: 3 + Math.floor(state.dist / 1000),
      });
    }
  }

  function spawnObstacle(y: number) {
    const hp =
      OBSTACLE_HP_BASE + Math.floor(state.dist / 300) * OBSTACLE_HP_PER_DIST;
    const availableX = Math.max(0, LOGICAL_W - OBSTACLE_WIDTH - 60);
    const x = 30 + Math.random() * availableX;
    state.obstacles.push({
      x,
      y,
      w: OBSTACLE_WIDTH,
      h: OBSTACLE_HEIGHT,
      hp,
      maxHp: hp,
    });
  }

  function spawnAttackItem(centerX: number, topY: number, bonus: number) {
    state.items.push({
      x: centerX - ATTACK_ITEM_SIZE / 2,
      y: topY,
      w: ATTACK_ITEM_SIZE,
      h: ATTACK_ITEM_SIZE,
      type: "attack",
      vy: ATTACK_ITEM_FALL_SPEED,
      bonus,
    });
  }

  function spawnBoss() {
    const hp = 200 + Math.floor(state.dist / 400) * 50;
    const availableWidth = Math.max(
      0,
      LOGICAL_W - BOSS_SPAWN_MARGIN * 2 - BOSS_WIDTH
    );
    const x = BOSS_SPAWN_MARGIN + Math.random() * availableWidth;
    state.bosses.push({
      x,
      y: -BOSS_HEIGHT - 120,
      w: BOSS_WIDTH,
      h: BOSS_HEIGHT,
      hp,
      damage: 12 + Math.floor(state.dist / 800),
    });
    state.nextBossDist += BOSS_INTERVAL;
  }

  function ensureBossSpawn() {
    while (state.dist >= state.nextBossDist) {
      spawnBoss();
    }
  }

  function ensureSpawns() {
    const segLen = 240;
    const needSeg = Math.floor((state.dist + 1400) / segLen);
    while (state.lastSeg < needSeg) {
      state.lastSeg++;
      const y = -800 - state.lastSeg * segLen;
      const mod = state.lastSeg % 3;
      if (mod === 0) spawnGatePair(y);
      else if (mod === 1) spawnZombies(y);
      else spawnObstacle(y);
    }
  }

  function spawnFloater(text: string, x: number, y: number) {
    state.floaters.push({ text, x, y, vy: -30, life: 0.9 });
  }

  function shootAtNearest(dt: number) {
    state.shootCooldown -= dt;
    if (state.shootCooldown > 0) return;

    const segments = getPlayerSegmentPositions(
      player,
      getPlayerCount(state.scoreValue)
    );
    const bulletDamage = 5 + state.attackBonus;
    for (const segment of segments) {
      state.bullets.push({
        x: segment.x + PLAYER_SEGMENT_WIDTH / 2 - 3,
        y: player.y - 10,
        w: 6,
        h: 10,
        vx: 0, // 정면 고정
        vy: -520,
        life: 1.1,
        dmg: bulletDamage,
      });
    }

    state.shootCooldown = 0.08; // 연사 속도
  }

  function toLogicalX(clientX: number) {
    const rect = canvas.getBoundingClientRect();
    const x01 = (clientX - rect.left) / rect.width;
    return x01 * LOGICAL_W;
  }

  function onPointerDown(e: PointerEvent) {
    state.pointerDown = true;
    state.targetX = toLogicalX(e.clientX);
  }

  function onPointerMove(e: PointerEvent) {
    if (!state.pointerDown) return;
    state.targetX = toLogicalX(e.clientX);
  }

  function onPointerUp() {
    state.pointerDown = false;
  }

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  let last = performance.now();
  let hudAccum = 0;

  function update(dt: number) {
    if (!state.alive) return;

    const playerCount = getPlayerCount(state.scoreValue);
    const crowdWidth = Math.max(MIN_PLAYER_WIDTH, getCrowdWidth(playerCount));
    const playerCenterX = player.x + player.w / 2;
    player.w = crowdWidth;
    player.x = playerCenterX - crowdWidth / 2;

    state.time += dt;
    state.dist += state.speed * dt;

    const desired = clamp(
      state.targetX - player.w / 2,
      18,
      LOGICAL_W - player.w - 18
    );
    player.x = lerp(player.x, desired, 0.18);

    const dy = state.speed * dt;
    for (const g of state.gates) g.y += dy;
    for (const z of state.zombies) z.y += dy;
    for (const boss of state.bosses) {
      boss.y += dy;
      if (boss.y + boss.h >= LOGICAL_H && state.alive) {
        state.alive = false;
      }
    }
    for (const obstacle of state.obstacles) obstacle.y += dy;

    const hurtPlayer = (amount: number) => {
      if (!state.alive || amount <= 0) return;
      const before = state.scoreValue;
      state.scoreValue = Math.max(0, state.scoreValue - amount);
      const delta = state.scoreValue - before;
      spawnFloater(
        (delta >= 0 ? "+" : "") + delta,
        player.x + player.w / 2,
        player.y
      );
      if (state.scoreValue <= 0) state.alive = false;
    };

    for (const g of state.gates) {
      if (g.used) continue;
      if (aabb(player, g)) {
        g.used = true;
        const before = state.scoreValue;
        state.scoreValue = applyGate(state.scoreValue, g.op);
        const delta = state.scoreValue - before;
        spawnFloater(
          (delta >= 0 ? "+" : "") + delta,
          player.x + player.w / 2,
          player.y
        );
      }
    }

    shootAtNearest(dt);

    for (const b of state.bullets) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    const enemyGroups: Enemy[][] = [state.zombies, state.bosses];
    for (const b of state.bullets) {
      if (b.life <= 0) continue;
      let hit = false;
      for (const group of enemyGroups) {
        for (const enemy of group) {
          if (enemy.hp <= 0) continue;
          if (!aabb(b, enemy)) continue;
          enemy.hp -= b.dmg;
          b.life = 0;
          spawnFloater("-" + b.dmg, enemy.x + enemy.w / 2, enemy.y);
          hit = true;
          break;
        }
        if (hit) break;
      }
      if (hit) continue;

      for (const obstacle of state.obstacles) {
        if (obstacle.hp <= 0) continue;
        if (!aabb(b, obstacle)) continue;
        obstacle.hp -= b.dmg;
        b.life = 0;
        spawnFloater("-" + b.dmg, obstacle.x + obstacle.w / 2, obstacle.y);
        if (obstacle.hp <= 0) {
          const bonus = Math.max(
            1,
            Math.min(
              MAX_ATTACK_BONUS,
              Math.floor(obstacle.maxHp / 30)
            )
          );
          spawnAttackItem(
            obstacle.x + obstacle.w / 2,
            obstacle.y + obstacle.h,
            bonus
          );
        }
        break;
      }
    }

    for (const obstacle of state.obstacles) {
      if (!state.alive) break;
      if (obstacle.hp <= 0) continue;
      if (aabb(player, obstacle)) {
        hurtPlayer(1);
      }
    }

    for (const z of state.zombies) {
      if (z.hp <= 0) continue;
      if (aabb(player, z)) {
        hurtPlayer(z.damage);
      }
    }

    for (const boss of state.bosses) {
      if (boss.hp <= 0) continue;
      if (aabb(player, boss)) {
        hurtPlayer(boss.damage);
      }
    }

    for (const item of state.items) {
      item.y += dy;
      item.y += item.vy * dt;
      if (item.collected) continue;
      if (!aabb(player, item)) continue;
      const before = state.attackBonus;
      state.attackBonus = Math.min(
        MAX_ATTACK_BONUS,
        state.attackBonus + item.bonus
      );
      const gained = state.attackBonus - before;
      if (gained > 0) {
        spawnFloater(`ATTACK +${gained}`, item.x + item.w / 2, item.y);
      }
      item.collected = true;
    }

    for (const f of state.floaters) {
      f.life -= dt;
      f.y += f.vy * dt;
    }

    state.gates = state.gates.filter((g) => g.y < LOGICAL_H + 100 && !g.used);
    state.zombies = state.zombies.filter(
      (z) => z.y < LOGICAL_H + 100 && z.hp > 0
    );
    state.bosses = state.bosses.filter(
      (boss) => boss.y < LOGICAL_H + 200 && boss.hp > 0
    );
    state.obstacles = state.obstacles.filter(
      (obs) => obs.y < LOGICAL_H + 200 && obs.hp > 0
    );
    state.items = state.items.filter(
      (item) => item.y < LOGICAL_H + 80 && !item.collected
    );
    state.bullets = state.bullets.filter((b) => b.life > 0 && b.y > -50);
    state.floaters = state.floaters.filter((f) => f.life > 0);

    ensureSpawns();
    ensureBossSpawn();

    hudAccum += dt;
    if (hudAccum >= 0.1) {
      hudAccum = 0;
      setHud({
        value: state.scoreValue,
        dist: Math.floor(state.dist),
        alive: state.alive,
      });
    }
  }

  function render() {
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#fff";
    for (let y = 0; y < LOGICAL_H; y += 40) {
      ctx.fillRect(LOGICAL_W * 0.33, y, 2, 12);
      ctx.fillRect(LOGICAL_W * 0.66, y, 2, 12);
    }
    ctx.globalAlpha = 1;

    for (const g of state.gates) {
      ctx.fillStyle =
        g.op.type === "sub" || g.op.type === "div" ? "#5a1a1a" : "#1a5a2a";
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.strokeStyle = "#000";
      ctx.strokeRect(g.x, g.y, g.w, g.h);

      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(g.op.label, g.x + g.w / 2, g.y + g.h / 2);
    }

    for (const z of state.zombies) {
      ctx.fillStyle = "#2b2b6b";
      ctx.fillRect(z.x, z.y, z.w, z.h);

      ctx.fillStyle = "#111";
      ctx.fillRect(z.x, z.y - 8, z.w, 5);
      ctx.fillStyle = "#fff";
      const hpFrac = clamp(z.hp / 25, 0, 1);
      ctx.fillRect(z.x, z.y - 8, z.w * hpFrac, 5);
    }

    for (const obstacle of state.obstacles) {
      ctx.fillStyle = "#6f4e37";
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      ctx.fillStyle = "#3b2b1b";
      ctx.fillRect(obstacle.x, obstacle.y - 6, obstacle.w, 4);
      ctx.fillStyle = "#fff";
      const obsHpFrac = clamp(obstacle.hp / 60, 0, 1);
      ctx.fillRect(obstacle.x, obstacle.y - 6, obstacle.w * obsHpFrac, 4);
    }

    for (const boss of state.bosses) {
      ctx.fillStyle = "#c83737";
      ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
      ctx.fillStyle = "#111";
      ctx.fillRect(boss.x, boss.y - 10, boss.w, 6);
      ctx.fillStyle = "#fff";
      const bossHpFrac = clamp(boss.hp / 250, 0, 1);
      ctx.fillRect(boss.x, boss.y - 10, boss.w * bossHpFrac, 6);
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("BOSS", boss.x + boss.w / 2, boss.y + boss.h / 2 + 4);
    }

    for (const item of state.items) {
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(item.x, item.y, item.w, item.h);
      ctx.fillStyle = "#c47e00";
      ctx.fillRect(item.x + 4, item.y + 4, item.w - 8, item.h - 8);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(
        `+${item.bonus}`,
        item.x + item.w / 2,
        item.y + item.h / 2 + 2
      );
    }

    ctx.fillStyle = "#f2f2f2";
    for (const b of state.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);

    const playerSegments = getPlayerCount(state.scoreValue);
    const segments = getPlayerSegmentPositions(player, playerSegments);
    const attackRatio = Math.min(
      1,
      state.attackBonus / MAX_ATTACK_BONUS
    );
    const playerHue = Math.max(10, 42 - state.attackBonus * 2);
    const playerLight = Math.min(68, 42 + state.attackBonus * 2);
    const playerColor = `hsl(${playerHue}, 92%, ${playerLight}%)`;

    if (attackRatio > 0) {
      ctx.globalAlpha = 0.2 + attackRatio * 0.4;
      ctx.fillStyle = "#ffd166";
      for (const segment of segments) {
        ctx.fillRect(
          segment.x - 3,
          player.y - 6,
          PLAYER_SEGMENT_WIDTH + 6,
          player.h + 12
        );
      }
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = playerColor;
    for (const segment of segments) {
      ctx.fillRect(segment.x, player.y, PLAYER_SEGMENT_WIDTH, player.h);
      ctx.fillRect(
        segment.x + PLAYER_SEGMENT_WIDTH / 2 - 2,
        player.y - 8,
        4,
        10
      );
    }

    ctx.textAlign = "center";
    for (const f of state.floaters) {
      ctx.globalAlpha = clamp(f.life / 0.9, 0, 1);
      ctx.font = "bold 16px system-ui";
      ctx.fillStyle = "#fff";
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    if (!state.alive) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 28px system-ui";
      ctx.fillText("GAME OVER", LOGICAL_W / 2, LOGICAL_H / 2 - 20);
      ctx.font = "16px system-ui";
      ctx.fillText("새로고침으로 재시작", LOGICAL_W / 2, LOGICAL_H / 2 + 18);
    }
  }

  function loop(now: number) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    rafRef.current = requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  ensureSpawns();
  rafRef.current = requestAnimationFrame(loop);

  return () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  };
}
