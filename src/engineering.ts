export function openBeltCenter(a: number, b: number, target: number): number | null {
  const delta = Math.abs(a - b);
  const length = (c: number) => 2 * Math.sqrt(c*c - delta*delta) + Math.PI*(a+b) + 2*delta*Math.asin(delta/c);
  let low = a+b, high = target/2;
  if (![a,b,target].every(v => Number.isFinite(v) && v > 0) || length(low) >= target) return null;
  for (let i=0; i<60; i++) {
    const mid = (low+high)/2;
    if (length(mid) < target) low = mid; else high = mid;
  }
  return (low+high)/2;
}

export function operatingEstimate(rpm: number, ratio: number, torque: number, efficiency: number, diameter: number) {
  if (![rpm,ratio,torque,efficiency,diameter].every(Number.isFinite) || rpm<0 || !ratio || torque<0 || efficiency<=0 || efficiency>100 || diameter<=0) return null;
  return { torque: torque*efficiency/100/Math.abs(ratio), speed: Math.abs(rpm*ratio)*Math.PI*diameter/60000 };
}
