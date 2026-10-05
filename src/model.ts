export type BeltProfile = 'GT2' | 'GT3' | 'HTD 5M';
export type SketchTool =
  | 'select'
  | 'pan'
  | 'add-pulley'
  | 'add-idler'
  | 'route'
  | 'dimension-horizontal'
  | 'dimension-vertical'
  | 'dimension-aligned'
  | 'constraint-horizontal'
  | 'constraint-vertical'
  | 'delete';

export type Point = { x: number; y: number };

export type Pulley = {
  id: string;
  label: string;
  toothCount: number;
  profile: BeltProfile;
  x: number;
  y: number;
  isOrigin: boolean;
};

export type Idler = {
  id: string;
  label: string;
  diameterMm: number;
  x: number;
  y: number;
};

export type SketchDimension = {
  id: string;
  fromId: string;
  toId?: string;
  kind: 'horizontal' | 'vertical' | 'aligned';
  valueMm: number;
  offsetMm: number;
};

export type SketchConstraint = {
  id: string;
  firstId: string;
  secondId: string;
  kind: 'horizontal' | 'vertical';
};

export type Sketch = {
  schemaVersion: 1;
  profile: BeltProfile;
  pulleys: Pulley[];
  idlers: Idler[];
  route: string[];
  dimensions: SketchDimension[];
  constraints: SketchConstraint[];
  toleranceTeeth: number;
  availableBeltTeeth: number[];
  drive?: { driverId: string | null; outputId: string | null; driverRpm: number | null };
  view: { centerX: number; centerY: number; zoom: number };
};

export type HistoryState = {
  past: Sketch[];
  present: Sketch;
  future: Sketch[];
  activeEdit: { id: string; before: Sketch } | null;
  notice?: string | null;
};

export type LineSegment = {
  kind: 'line';
  componentId: string;
  fromId: string;
  toId: string;
  start: Point;
  end: Point;
  lengthMm: number;
};

export type ArcSegment = {
  kind: 'arc';
  componentId: string;
  center: Point;
  radiusMm: number;
  startAngle: number;
  endAngle: number;
  contactFace: 'teeth' | 'smooth';
  lengthMm: number;
};

export type PathSegment = LineSegment | ArcSegment;

export type IdlerContribution = {
  idlerId: string;
  lengthMm: number;
};

export type BeltGeometryResult = {
  valid: boolean;
  diagnostic: string | null;
  segments: PathSegment[];
  lengthMm: number | null;
  pitchMm: number;
  exactTeeth: number | null;
  nearestTeeth: number | null;
  lowerTeeth: number | null;
  higherTeeth: number | null;
  nearestLengthErrorMm: number | null;
  nearestToothError: number | null;
  passesTolerance: boolean | null;
  bestAvailableTeeth: number | null;
  bestAvailableLengthErrorMm: number | null;
  wrapAngles: Record<string, number>;
  idlerContributions: IdlerContribution[];
};
