type Flight = (time: number, width: number) => [number, number, number, number];
const { sin, cos } = Math;

// Each pair of coordinates is a ring center before the shared logo transition.
const flights: Flight[] = [
  (t,w) => [w*cos(.22*t+.62), .97*sin(.26*t), w*cos(.22*t-.59), .88*cos(.28*t+.6)],
  // Opposed ellipses.
  (t,w) => [w*cos(.20*t), sin(.20*t), -w*cos(.20*t+.4), .85*sin(.20*t+.4)],
  // Crossing figure eights.
  (t,w) => [w*sin(.19*t), .85*sin(.38*t), w*sin(.19*t+1), -.85*sin(.38*t+2)],
  // A wide horizontal sweep paired with a tighter orbit.
  (t,w) => [w*cos(.16*t), .46*sin(.32*t), .63*w*cos(.31*t+1), sin(.31*t+1)],
  // Two drifting loops with different vertical periods.
  (t,w) => [w*(.67*cos(.19*t)+.33*cos(.42*t)), .92*sin(.22*t), w*(.72*sin(.21*t)-.28*cos(.39*t)), .95*cos(.29*t)],
  // Diagonal waves that converge and split again.
  (t,w) => [w*sin(.22*t), .65*sin(.22*t)+.32*cos(.45*t), w*sin(.22*t+1.4), -.7*sin(.22*t+1.4)+.27*sin(.44*t)],
];

function chooseFlight(): Flight {
  let candidates = flights;
  try {
    const previous = localStorage.getItem('pitch.chromeFlight');
    candidates = flights.filter((_, index) => String(index) !== previous);
  } catch { /* Storage is optional for the welcome animation. */ }
  const flight = candidates[Math.floor(Math.random()*candidates.length)]!;
  try { localStorage.setItem('pitch.chromeFlight', String(flights.indexOf(flight))); } catch { /* Private browsing. */ }
  return flight;
}

export const launchFlight = chooseFlight();
