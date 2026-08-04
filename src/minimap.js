/**
 * Corner minimap (team scrap: baked-top-down-voxel-minimap — bake the static
 * course once per hole, then stamp live entity blips over it each tick).
 */
import { LAKE_R, CHANNEL_W, pathTangentAt, channelWidthAt, fallSites } from "./water.js";
import { makeChannelCanvas } from "./channelrender.js";
import { terrainHeightAt, LOB_CLEAR } from "./terrain.js";

const SIZE = 190;
const RANGE = 215; // world units spanned edge to edge — a hole runs corner to corner

export class Minimap {
  constructor() {
    this.canvas = document.getElementById("minimap");
    this.ctx = this.canvas.getContext("2d");
    this.bakeCanvas = document.createElement("canvas");
    this.bakeCanvas.width = this.bakeCanvas.height = SIZE;
    this.pulse = 0;
    // it sits small in the corner so it never covers the water you're aiming
    // at; tap to blow it up when you actually want to read the hole
    this.canvas.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.canvas.classList.toggle("big");
    });
  }

  _w2m(x, z) {
    return [(x / RANGE + 0.5) * SIZE, (z / RANGE + 0.5) * SIZE];
  }

  /**
   * Redraw the static course layer: winding lake, sand banks, fairway path,
   * islands, outcrops, tee, flag — plus whatever furniture the hole is carrying
   * (`hole`, for its falls/bridges/caves/wheels). Those are the things
   * you most want to know about before you throw and least want to discover by
   * hitting one, so they get the boldest marks on the map.
   *
   * `grass` is the biome's bank colour (biomes.js), so the map is the same
   * country as the window.
   */
  bake(path, islands, rocks = [], width = CHANNEL_W, hole = null, grass = "#7cc45e", branches = null) {
    const ctx = this.bakeCanvas.getContext("2d");
    const S = SIZE;
    ctx.clearRect(0, 0, S, S);

    // grass + winding water channel + sandy banks (shared with the level
    // editor), shaded by the bank hills so you can spot the passes
    const layer = makeChannelCanvas({
      res: S,
      pxToWorld: (u, v) => ({ x: (u - 0.5) * RANGE, z: (v - 0.5) * RANGE }),
      path, width, branches, grass, sandBand: 3,
      heightAt: terrainHeightAt, lobClear: LOB_CLEAR,
    });
    ctx.drawImage(layer, 0, 0);
    // clip everything to the round minimap frame
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // rock outcrops (hazards — draw under the path line)
    for (const o of rocks) {
      const [x, y] = this._w2m(o.x, o.z);
      const r = (o.r / RANGE) * S;
      ctx.fillStyle = "#5d686e";
      ctx.strokeStyle = "#3c454a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.5, r), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // fairway path — dashed. Everything from here down is drawn deliberately
    // chunky: the map is a 76px button until you tap it open, so a hairline
    // reads as nothing at all.
    ctx.strokeStyle = "rgba(253,246,227,0.85)";
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]);
    ctx.lineCap = "round";
    ctx.beginPath();
    path.forEach((p, i) => {
      const [x, y] = this._w2m(p.x, p.z);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // ...and the shortcut, in its own green and dashed finer, so the map says
    // the same thing the water does: this is a way, not the way
    for (const b of branches ?? []) {
      ctx.strokeStyle = "rgba(198,240,120,0.9)";
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      b.path.forEach((p, i) => {
        const [x, y] = this._w2m(p.x, p.z);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // islands
    for (const isl of islands) {
      const [x, y] = this._w2m(isl.x, isl.z);
      const r = (isl.r / RANGE) * S + 3;
      ctx.fillStyle = "#eed9a4";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6fbf55";
      ctx.beginPath();
      ctx.arc(x, y - 1, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hole) this._bakeProps(ctx, hole, width);

    // tee
    const [tx, ty] = this._w2m(path[0].x, path[0].z);
    ctx.fillStyle = "#fdf6e3";
    ctx.strokeStyle = "#16324a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx, ty, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    this.flagXY = this._w2m(path[path.length - 1].x, path[path.length - 1].z);
  }

  /** the hole's furniture, each drawn square across the flow it sits in */
  _bakeProps(ctx, hole, width) {
    const S = SIZE;
    const px = (u) => (u / RANGE) * S;
    // a bar laid across the channel at (x,z), `len` half-length, `thick` deep
    const bar = (x, z, len, thick, fill, stroke) => {
      const [mx, my] = this._w2m(x, z);
      const [ux, uz] = pathTangentAt(x, z);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.atan2(uz, ux));
      ctx.fillStyle = fill;
      ctx.fillRect(-px(thick) / 2, -px(len), px(thick), px(len) * 2);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-px(thick) / 2, -px(len), px(thick), px(len) * 2);
      }
      ctx.restore();
    };
    // a shortcut is narrower than the river, so a thing lying across it is
    // shorter: draw each to the water it is actually in
    const span = (x, z) => Math.min(width, channelWidthAt(x, z));

    for (const c of hole.caves ?? []) {
      bar(c.x, c.z, span(c.x, c.z) + 2, c.len ?? 18, "rgba(30,40,48,0.82)", "#0d1418");
    }
    for (const b of hole.bridges ?? []) {
      bar(b.x, b.z, span(b.x, b.z) + 4, 3.6, "#a9773f", "#6d4726");
    }
    // a white lip with a chevron on the downstream side of it, laid along the
    // lip itself rather than the water — which is the same line in the river
    // and a slanted one where a shortcut takes the drop at an angle
    const lip = (s, ux, uz) => {
      const [mx, my] = this._w2m(s.x, s.z);
      const w = s.halfW;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.atan2(uz, ux));
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#7fb8cf";
      ctx.lineWidth = 1.5;
      ctx.fillRect(-px(1.6) / 2, -px(w + 1.5), px(1.6), px(w + 1.5) * 2);
      ctx.strokeRect(-px(1.6) / 2, -px(w + 1.5), px(1.6), px(w + 1.5) * 2);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(px(1.2), -px(w * 0.5));
      ctx.lineTo(px(4.5), 0);
      ctx.lineTo(px(1.2), px(w * 0.5));
      ctx.stroke();
      ctx.restore();
    };
    // A fall is a step in the whole valley, so a shortcut goes over the same
    // drop a little further along the same edge (water.js `fallSites`). Mark
    // every stretch of water it crosses, or the map is selling the gut as a way
    // round a waterfall that is standing in it too.
    for (const f of hole.falls ?? []) {
      const [ux, uz] = pathTangentAt(f.x, f.z);
      for (const s of fallSites({ x: f.x, z: f.z, ux, uz })) lip(s, ux, uz);
    }
    for (const w of hole.wheels ?? []) {
      const [mx, my] = this._w2m(w.x, w.z);
      const r = Math.max(3.5, px(w.r ?? 4.2));
      ctx.strokeStyle = "#6d4726";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - r, my); ctx.lineTo(mx + r, my);
      ctx.moveTo(mx, my - r); ctx.lineTo(mx, my + r);
      ctx.stroke();
    }
  }

  /** stamp the live layer: racers, boats, pulsing flag */
  update(dt, racers, boats, player) {
    this.pulse += dt * 3;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.bakeCanvas, 0, 0);

    // boats (the fleet sits out the terraced holes — see Boats.setActive)
    ctx.fillStyle = "#a9682f";
    for (const b of (boats.active === false ? [] : boats.boats)) {
      const p = b.group.position;
      const [x, y] = this._w2m(p.x, p.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-b.group.rotation.y);
      ctx.fillRect(-5, -2.3, 10, 4.6);
      ctx.restore();
    }

    // flag — pulsing ring + pennant
    const [fx, fy] = this.flagXY;
    ctx.strokeStyle = "rgba(255,210,74,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx, fy, 8 + Math.sin(this.pulse) * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff5470";
    ctx.beginPath();
    ctx.moveTo(fx, fy - 16);
    ctx.lineTo(fx + 11, fy - 11);
    ctx.lineTo(fx, fy - 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fdf6e3";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 16);
    ctx.lineTo(fx, fy);
    ctx.stroke();

    // racers — bots first so the player draws on top
    for (const s of racers) {
      if (s.isPlayer) continue;
      const [x, y] = this._w2m(s.pos.x, s.pos.z);
      ctx.fillStyle = s.tint;
      ctx.strokeStyle = "rgba(22,50,74,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (player) {
      const [x, y] = this._w2m(player.pos.x, player.pos.z);
      ctx.fillStyle = "#ffd24a";
      ctx.strokeStyle = "#16324a";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,210,74,0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12 + Math.sin(this.pulse * 1.3) * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
