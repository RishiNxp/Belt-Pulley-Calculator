import type { Sketch } from './model';

export function createEmptySketch(): Sketch {
  return {
    schemaVersion: 1,
    profile: 'GT2',
    pulleys: [],
    idlers: [],
    route: [],
    dimensions: [],
    constraints: [],
    toleranceTeeth: 0.2,
    availableBeltTeeth: [],
    drive: { driverId: null, outputId: null, driverRpm: null },
    view: { centerX: 0, centerY: 0, zoom: 1 },
  };
}

export function createDemoSketch(): Sketch {
  return {
    schemaVersion: 1,
    profile: 'GT2',
    pulleys: [
      { id: 'P1', label: 'P1 · ORIGIN', toothCount: 60, profile: 'GT2', x: 0, y: 0, isOrigin: true },
      { id: 'P2', label: 'P2', toothCount: 20, profile: 'GT2', x: 120, y: 0, isOrigin: false },
      { id: 'P3', label: 'P3', toothCount: 20, profile: 'GT2', x: 160, y: 50, isOrigin: false },
      { id: 'P4', label: 'P4', toothCount: 20, profile: 'GT2', x: 160, y: 67, isOrigin: false },
    ],
    idlers: [],
    route: ['P1', 'P2', 'P3', 'P4', 'P1'],
    dimensions: [],
    constraints: [],
    toleranceTeeth: 0.2,
    availableBeltTeeth: [],
    drive: { driverId: null, outputId: null, driverRpm: null },
    view: { centerX: 82, centerY: 32, zoom: 1 },
  };
}
