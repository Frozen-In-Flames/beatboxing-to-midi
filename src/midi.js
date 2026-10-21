// Minimal Standard MIDI File (format 1) writer. No dependencies.
export const PPQ = 480;
const str = s => [...s].map(c => c.charCodeAt(0));
const u16 = n => [(n >> 8) & 255, n & 255];
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
const chunk = (id, data) => [...str(id), ...u32(data.length), ...data];

function track(events) { // events: [{ t: ticks, o: order, b: bytes }]
  events.sort((a, b) => a.t - b.t || a.o - b.o);
  let last = 0; const out = [];
  for (const e of events) { out.push(...vlq(e.t - last), ...e.b); last = e.t; }
  return chunk('MTrk', [...out, 0, 0xff, 0x2f, 0]);
}

// tracks: [{ name, channel (0-15, 9 = drums), notes: [{ time (s), dur (s), note, vel }] }]
export function buildMidi(tracks, bpm = 120) {
  const tk = s => Math.round((s * bpm / 60) * PPQ), us = Math.round(6e7 / bpm);
  const conductor = track([{ t: 0, o: -1, b: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }]);
  const body = tracks.map(({ name, channel, notes, bendRange = 0 }) => {
    const nm = str(name), ev = [{ t: 0, o: -1, b: [0xff, 0x03, nm.length, ...nm] }];
    if (bendRange) for (const [c, v] of [[101, 0], [100, 0], [6, bendRange], [38, 0], [101, 127], [100, 127]]) ev.push({ t: 0, o: -0.5, b: [0xb0 | channel, c, v] });
    for (const n of notes) {
      const on = tk(n.time), off = Math.max(on + 1, tk(n.time + n.dur));
      ev.push({ t: on, o: 1, b: [0x90 | channel, n.note, n.vel] }, { t: off, o: 0, b: [0x80 | channel, n.note, 0] });
      for (const b of n.bends || []) { const v = Math.max(0, Math.min(16383, Math.round(8192 + (b.semis / bendRange) * 8192))); ev.push({ t: Math.max(on, Math.min(off, tk(b.time))), o: 0.5, b: [0xe0 | channel, v & 127, v >> 7] }); }
    }
    return track(ev);
  });
  return new Uint8Array([...chunk('MThd', [...u16(1), ...u16(body.length + 1), ...u16(PPQ)]), ...conductor, ...body.flat()]);
}
