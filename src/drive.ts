import type { Sketch } from './model';

export type DriveResult = {
  driverId: string;
  outputId: string;
  reduction: number;
  speedMultiplier: number;
  idealTorqueMultiplier: number;
  outputRpm: number | null;
  speeds: { id: string; multiplier: number; rpm: number | null }[];
};

export function calculateDrive(sketch: Sketch, driverId: string, outputId: string, driverRpm: number | null): DriveResult | null {
  if (sketch.route.length < 3 || sketch.route[0] !== sketch.route.at(-1)) return null;
  if (driverRpm !== null && (!Number.isFinite(driverRpm) || driverRpm < 0)) return null;
  const connectedIds = new Set(sketch.route.slice(0, -1));
  const objects = new Set([...sketch.pulleys, ...sketch.idlers].map(object => object.id));
  if (connectedIds.size !== sketch.route.length - 1 || [...connectedIds].some(id => !objects.has(id))) return null;
  const pulleys = sketch.pulleys.filter(pulley => connectedIds.has(pulley.id));
  if (pulleys.some(pulley => !Number.isInteger(pulley.toothCount) || pulley.toothCount <= 0 || pulley.profile !== sketch.profile)) return null;
  const driver = pulleys.find(pulley => pulley.id === driverId);
  const output = pulleys.find(pulley => pulley.id === outputId);
  if (!driver || !output) return null;
  const reduction = output.toothCount / driver.toothCount;
  const speedMultiplier = driver.toothCount / output.toothCount;
  const outputRpm = driverRpm === null ? null : driverRpm * speedMultiplier;
  const speeds = pulleys.map(pulley => {
    const multiplier = driver.toothCount / pulley.toothCount;
    return { id: pulley.id, multiplier, rpm: driverRpm === null ? null : driverRpm * multiplier };
  });
  if (speeds.some(speed => speed.rpm !== null && !Number.isFinite(speed.rpm))) return null;
  return {
    driverId, outputId, reduction, speedMultiplier, idealTorqueMultiplier: reduction, outputRpm,
    speeds,
  };
}
