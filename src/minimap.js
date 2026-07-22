/**
 * Corner minimap (team scrap: baked-top-down-voxel-minimap — bake the static
 * course once per hole, then stamp live entity blips over it each tick).
 */
import { LAKE_R } from "./water.js";

const SIZE = 190;
const RANGE = 170; // world units spanned edge to edge

export class Minimap {
  constructor() {
    this.canvas = document.getElementById("minimap");
    this.ctx = this.canvas.getContext("2d");
    this.bakeCanvas = document.createElement("canvas");
    this.bakeCanvas.width = this.bakeCanvas.height = SIZE;
    this.pulse = 0;
  }

  _w2m(x, z) {
    return [(x / RANGE + 0.5) * SIZE, (z / RANGE + 0.5) * SIZE];
  }

  /** redraw the static course layer: shore, lake, fairway path, islands, outcrops, tee, flag */
  bake(path, islands, rocks = []) {
    const ctx = this.bakeCanvas.getContext("2d");
    const S = SIZE;
    ctx.clearRect(0, 0, S, S);

    // shore backdrop
    ctx.fillStyle = "#7cc45e";
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.fill();
    // sand rim
    const lakePx = (LAKE_R / RANGE) * S;
    ctx.fillStyle = "#eed9a4";
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, lakePx + 7, 0, Math.PI * 2);
    ctx.fill();
    // water
    const grad = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, lakePx);
    grad.addColorStop(0, "#12557f");
    grad.addColorStop(1, "#2fbfd3");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, lakePx, 0, Math.PI * 2);
    ctx.fill();

    // rock outcrops (hazards — draw under the path line)
    for (const o of rocks) {
      const [x, y] = this._w2m(o.x, o.z);
      const r = (o.r / RANGE) * S;
      ctx.fillStyle = "#5d686e";
      ctx.strokeStyle = "#3c454a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // fairway path — dashed
    ctx.strokeStyle = "rgba(253,246,227,0.85)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.lineCap = "round";
    ctx.beginPath();
    path.forEach((p, i) => {
      const [x, y] = this._w2m(p.x, p.z);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // islands
    for (const isl of islands) {
      const [x, y] = this._w2m(isl.x, isl.z);
      const r = (isl.r / RANGE) * S + 2;
      ctx.fillStyle = "#eed9a4";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6fbf55";
      ctx.beginPath();
      ctx.arc(x, y - 1, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // tee
    const [tx, ty] = this._w2m(path[0].x, path[0].z);
    ctx.fillStyle = "#fdf6e3";
    ctx.strokeStyle = "#16324a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    this.flagXY = this._w2m(path[path.length - 1].x, path[path.length - 1].z);
  }

  /** stamp the live layer: racers, boats, pulsing flag */
  update(dt, racers, boats, player) {
    this.pulse += dt * 3;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.bakeCanvas, 0, 0);

    // boats
    ctx.fillStyle = "#a9682f";
    for (const b of boats.boats) {
      const p = b.group.position;
      const [x, y] = this._w2m(p.x, p.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-b.group.rotation.y);
      ctx.fillRect(-3.5, -1.6, 7, 3.2);
      ctx.restore();
    }

    // flag — pulsing ring + pennant
    const [fx, fy] = this.flagXY;
    ctx.strokeStyle = "rgba(255,210,74,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fx, fy, 5 + Math.sin(this.pulse) * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff5470";
    ctx.beginPath();
    ctx.moveTo(fx, fy - 10);
    ctx.lineTo(fx + 7, fy - 7);
    ctx.lineTo(fx, fy - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fdf6e3";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 10);
    ctx.lineTo(fx, fy);
    ctx.stroke();

    // racers — bots first so the player draws on top
    for (const s of racers) {
      if (s.isPlayer) continue;
      const [x, y] = this._w2m(s.pos.x, s.pos.z);
      ctx.fillStyle = s.tint;
      ctx.strokeStyle = "rgba(22,50,74,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (player) {
      const [x, y] = this._w2m(player.pos.x, player.pos.z);
      ctx.fillStyle = "#ffd24a";
      ctx.strokeStyle = "#16324a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,210,74,0.65)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 7.5 + Math.sin(this.pulse * 1.3) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
