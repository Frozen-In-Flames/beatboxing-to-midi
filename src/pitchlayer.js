// The pitched-layer merge: how Basic Pitch proposals and the built-in
// YIN contour tracker share the voiced tracks.
//
// The boundary, set by the measured evidence in VERIFY.md:
// - Basic Pitch proposes sustained pitched events. On the creator's
//   bass it recovered the line (dozens of notes) where the YIN layers
//   path found almost nothing, so its proposals are the note list.
// - YIN keeps sole ownership of glides. A YIN note counts as a glide
//   when its bend contour spans more than GLIDE_SPAN semitones over at
//   least GLIDE_MIN_DUR seconds with at least GLIDE_MIN_BENDS bend
//   points: the ground-truth glide is a 1.5 s sweep, while the short
//   bent fragments the tracker emits on drum sounds fail all three
//   tests (measured on the drums-only control, VERIFY.md). A glide is
//   kept whole, exactly as YIN wrote it, and any Basic Pitch proposal
//   overlapping it is dropped (Basic Pitch fragments glides into
//   stepped notes).
// - YIN supplies the bends. Where a Basic Pitch proposal and a YIN note
//   agree (same pitch, spans covering each other), the YIN note wins
//   whole: its segmentation and continuous bend contour are the better
//   measured ones. Where they disagree, the Basic Pitch note stands and
//   bends from an overlapping YIN note on the same line are grafted on,
//   re-based to the proposal's pitch.
// - YIN notes that neither glide nor agree with a proposal are dropped
//   when the enhanced layer is on: the proposer is the note list, and
//   YIN's solo fragments on sustained material were the weaker half of
//   every measurement that motivated this layer.

const GLIDE_SPAN = 1.5; // semitones of bend travel that make a note a glide
const GLIDE_MIN_DUR = 0.3, GLIDE_MIN_BENDS = 10;
const isGlide = n => bendSpan(n) > GLIDE_SPAN && n.dur >= GLIDE_MIN_DUR && (n.bends ? n.bends.length : 0) >= GLIDE_MIN_BENDS;
const overlap = (a, b) => Math.max(0, Math.min(a.t + a.dur, b.t + b.dur) - Math.max(a.t, b.t));
const bendSpan = n => (n.bends && n.bends.length ? Math.max(...n.bends.map(b => b.semis)) - Math.min(...n.bends.map(b => b.semis)) : 0);
const label = note => (note < 48 ? 'bass' : 'hum');
const velOf = amp => Math.min(127, Math.max(20, Math.round(amp * 150)));

export function mergeVoiced(yinNotes, bpNotes) {
  const glides = yinNotes.filter(isGlide);
  const plain = yinNotes.filter(n => !isGlide(n));
  const out = [...glides], used = new Set();
  for (const bp of bpNotes) {
    // Glides own their span outright.
    if (glides.some(g => overlap(g, bp) > 0.5 * bp.dur)) continue;
    // Agreement: same pitch, spans covering each other. YIN wins whole.
    const agree = plain.find(y => !used.has(y) && y.note === bp.note && overlap(y, bp) >= 0.7 * Math.min(y.dur, bp.dur) && overlap(y, bp) >= 0.5 * Math.max(y.dur, bp.dur));
    if (agree) { used.add(agree); out.push(agree); continue; }
    // Disagreement: the proposal stands, with YIN bends grafted from the
    // most-overlapping YIN note on the same line (within 2 semitones).
    let bends = [];
    const donors = plain.filter(y => Math.abs(y.note - bp.note) <= 2 && overlap(y, bp) > 0)
      .sort((a, b) => overlap(b, bp) - overlap(a, bp));
    if (donors.length) {
      const d = donors[0], shift = d.note - bp.note;
      bends = (d.bends || []).filter(b => b.t >= bp.t && b.t <= bp.t + bp.dur)
        .map(b => ({ t: b.t, semis: Math.max(-12, Math.min(12, b.semis + shift)) }));
    }
    out.push({ t: bp.t, dur: bp.dur, note: bp.note, vel: velOf(bp.amp), label: label(bp.note), bends });
  }
  return out.sort((a, b) => a.t - b.t);
}
