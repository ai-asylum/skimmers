/**
 * Multiplayer transport + session (team scrap: p2p-netcode, lifted from
 * Train Slop's PeerTransport). WebRTC via PeerJS's free public signaling
 * broker — works from a static site with no server of our own. The host
 * registers a peer id derived from a short room code; guests connect to it.
 *
 * Topology is a star: guests talk only to the host; the host relays guest
 * snapshots/events to everyone else and owns match flow (start, clock,
 * hole transitions, winner calls) plus the bot players.
 */
import { Peer } from "peerjs";

const ROOM_PREFIX = "skippidy-skip-";

function peerIdForRoom(code) {
  return ROOM_PREFIX + code.toLowerCase();
}

/** Random readable room code (no ambiguous chars). */
export function makeRoomCode(len = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/**
 * Deterministic "room code" for public matchmaking. Everyone hunting for a room
 * of the same capacity converges on the same well-known slots (mm-<cap>-1,
 * mm-<cap>-2, …), so we can pair up randoms over the shared PeerJS broker with
 * no matchmaking server of our own. cap 0 means "open / unlimited".
 */
export function matchCode(capacity, idx) {
  return `mm-${capacity}-${idx}`;
}

/** wrap a callback so only the first verdict gets through */
function settleOnce(fn) {
  let done = false;
  return (arg) => {
    if (done) return;
    done = true;
    fn?.(arg);
  };
}

class PeerTransport {
  constructor() {
    this.onOpen = null;
    this.onMessage = null;
    this.onClose = null;
    this.peer = null;
    this.conn = null;
    this._closed = false;
    this.ownsPeer = true;
  }

  _bindConn(conn) {
    this.conn = conn;
    conn.on("data", (d) => {
      if (!this._closed && this.onMessage) this.onMessage(d);
    });
    conn.on("open", () => {
      if (!this._closed && this.onOpen) this.onOpen();
    });
    conn.on("close", () => this.close());
    conn.on("error", () => this.close());
    if (conn.open && !this._closed && this.onOpen) this.onOpen();
  }

  send(data) {
    if (this._closed || !this.conn || !this.conn.open) return;
    this.conn.send(data);
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try { if (this.conn) this.conn.close(); } catch {}
    if (this.ownsPeer) {
      try { if (this.peer) this.peer.destroy(); } catch {}
    }
    if (this.onClose) this.onClose();
  }
}

/**
 * The game-facing session. Host and guest expose the same callbacks:
 *   net.onMessage = (fromId, msg) => {}
 *   net.onPeer = (id) => {}          // host: a guest's channel opened
 *   net.onPeerLeave = (id) => {}     // host: guest gone
 *   net.onDown = () => {}            // guest: lost the host
 */
export class Net {
  constructor() {
    this.role = null; // "host" | "guest"
    this.code = "";
    this.server = null;
    this.conns = new Map(); // host: id -> transport
    this.hostConn = null; // guest
    this.nextId = 1;
    this.onMessage = null;
    this.onPeer = null;
    this.onPeerLeave = null;
    this.onDown = null;
  }

  hostRoom(code, onReady) {
    this.role = "host";
    this.code = code;
    const peer = new Peer(peerIdForRoom(code), { debug: 1 });
    const transports = new Set();
    let closed = false;
    // onReady answers "did claiming this room work?", once. The broker keeps
    // emitting on the peer for the life of the room (a guest failing to reach
    // us, a signalling blip), and those are not a verdict on the claim.
    const settle = settleOnce(onReady);
    peer.on("open", () => settle(null));
    peer.on("error", (e) => settle(e));
    peer.on("connection", (conn) => {
      if (closed) { conn.close(); return; }
      const tr = new PeerTransport();
      tr.peer = peer;
      tr.ownsPeer = false;
      const id = this.nextId++;
      tr.onMessage = (d) => this.onMessage?.(id, d);
      tr.onOpen = () => this.onPeer?.(id);
      tr.onClose = () => {
        this.conns.delete(id);
        transports.delete(tr);
        this.onPeerLeave?.(id);
      };
      transports.add(tr);
      this.conns.set(id, tr);
      tr._bindConn(conn);
    });
    this.server = {
      close() {
        if (closed) return;
        closed = true;
        for (const tr of transports) { try { tr.close(); } catch {} }
        transports.clear();
        try { peer.destroy(); } catch {}
      },
    };
  }

  joinRoom(code, onReady) {
    this.role = "guest";
    this.code = code;
    const tr = new PeerTransport();
    // Same one-shot rule as hostRoom, and it matters more here: the caller
    // treats a verdict as "this probe is over" and closes the session, so a
    // late broker error reaching onReady would hang up on a room we are
    // happily playing in. Once the channel is up, only the channel's own
    // close/error (-> onDown) may end the session.
    const settle = settleOnce(onReady);
    tr.peer = new Peer({ debug: 1 });
    tr.onMessage = (d) => this.onMessage?.(0, d);
    // only the channel we are actually playing on may report the host as gone;
    // a probe from an earlier slot dying must not evict us from this room
    tr.onClose = () => { if (this.hostConn === tr) this.onDown?.(); };
    tr.peer.on("open", () => {
      const conn = tr.peer.connect(peerIdForRoom(code), { reliable: true });
      tr.onOpen = () => settle(null);
      tr._bindConn(conn);
    });
    tr.peer.on("error", (e) => settle(e));
    this.hostConn = tr;
  }

  /** host: send to one guest */
  sendTo(id, msg) {
    this.conns.get(id)?.send(msg);
  }

  /** host: send to every guest except one */
  broadcast(msg, exceptId = -1) {
    for (const [id, tr] of this.conns) {
      if (id !== exceptId) tr.send(msg);
    }
  }

  /** guest: send to the host */
  send(msg) {
    this.hostConn?.send(msg);
  }

  get peerCount() {
    return this.conns.size;
  }

  close() {
    try { this.server?.close(); } catch {}
    try { this.hostConn?.close(); } catch {}
    this.conns.clear();
    this.role = null;
  }
}
