// Minimal Standard MIDI File (SMF) reader. This does not decode note content
// or synthesize anything — fluidsynth (see src/lib/backends.mjs) does the
// actual audio rendering. All this does is walk delta-times and Set Tempo
// meta-events well enough to answer "how long does this file play for",
// which fluidsynth's CLI has no simple way to report on its own.

const HEADER_LENGTH = 14; // "MThd" + 4-byte length (always 6) + 6 header fields
const DEFAULT_TEMPO_MPQN = 500000; // 120 BPM: the MIDI spec's default tempo when no Set Tempo meta-event is present

function readVLQ(buf, offset) {
  let value = 0;
  let b;
  do {
    b = buf[offset];
    offset += 1;
    value = (value << 7) | (b & 0x7f);
  } while (b & 0x80 && offset < buf.length);
  return { value, offset };
}

// Walks one MTrk chunk's event stream. Returns the tick position of the
// track's final event and every Set Tempo meta-event found, each tagged
// with its absolute tick position — everything getMidiDurationSeconds needs,
// nothing more.
function walkTrack(buf, start, end) {
  let offset = start;
  let tick = 0;
  let runningStatus = null;
  const tempoChanges = [];

  while (offset < end) {
    const delta = readVLQ(buf, offset);
    offset = delta.offset;
    tick += delta.value;

    let status = buf[offset];
    if (status & 0x80) {
      offset += 1;
      runningStatus = status;
    } else {
      status = runningStatus;
    }

    if (status == null) break; // malformed stream: no status byte and no running status yet

    if (status === 0xff) {
      const type = buf[offset];
      offset += 1;
      const len = readVLQ(buf, offset);
      offset = len.offset;
      if (type === 0x51 && len.value === 3) {
        const mpqn = (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
        tempoChanges.push({ tick, mpqn });
      }
      offset += len.value;
      if (type === 0x2f) break; // End of Track
    } else if (status === 0xf0 || status === 0xf7) {
      const len = readVLQ(buf, offset);
      offset = len.offset + len.value;
    } else {
      const type = status & 0xf0;
      const dataBytes = type === 0xc0 || type === 0xd0 ? 1 : 2; // program change / channel pressure carry 1 data byte, everything else 2
      offset += dataBytes;
    }
  }

  return { endTick: tick, tempoChanges };
}

function ticksToSeconds(targetTick, tempoMap, ticksPerQuarter) {
  let seconds = 0;
  let prevTick = 0;
  let currentMpqn = DEFAULT_TEMPO_MPQN;
  for (const change of tempoMap) {
    if (change.tick >= targetTick) break;
    const segmentTicks = change.tick - prevTick;
    seconds += (segmentTicks / ticksPerQuarter) * (currentMpqn / 1e6);
    prevTick = change.tick;
    currentMpqn = change.mpqn;
  }
  const remainingTicks = targetTick - prevTick;
  seconds += (remainingTicks / ticksPerQuarter) * (currentMpqn / 1e6);
  return seconds;
}

// Returns the file's total playback duration in seconds, or null if `buf`
// doesn't look like a Standard MIDI File. SMPTE-based division (bit 15 of
// the header's division field set) is rare for General MIDI files in
// practice; when seen, this falls back to treating the file as 480
// ticks/quarter rather than doing the frames/sec math — a documented
// approximation, not exact timing.
export function getMidiDurationSeconds(buf) {
  if (buf.length < HEADER_LENGTH || buf.toString("ascii", 0, 4) !== "MThd") return null;

  const ntrks = buf.readUInt16BE(10);
  const division = buf.readUInt16BE(12);
  const ticksPerQuarter = division & 0x8000 ? 480 : division;

  let offset = HEADER_LENGTH;
  const allTempoChanges = [];
  const trackEndTicks = [];

  for (let i = 0; i < ntrks && offset + 8 <= buf.length; i++) {
    if (buf.toString("ascii", offset, offset + 4) !== "MTrk") break;
    const length = buf.readUInt32BE(offset + 4);
    const trackStart = offset + 8;
    const trackEnd = Math.min(trackStart + length, buf.length);
    const { endTick, tempoChanges } = walkTrack(buf, trackStart, trackEnd);
    trackEndTicks.push(endTick);
    allTempoChanges.push(...tempoChanges);
    offset = trackEnd;
  }

  allTempoChanges.sort((a, b) => a.tick - b.tick);

  let maxSeconds = 0;
  for (const endTick of trackEndTicks) {
    const seconds = ticksToSeconds(endTick, allTempoChanges, ticksPerQuarter);
    if (seconds > maxSeconds) maxSeconds = seconds;
  }
  return maxSeconds;
}
