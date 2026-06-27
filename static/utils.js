
export function toHHMM(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
