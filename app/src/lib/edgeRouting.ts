export type EdgeHandleSide = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeRoutingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeHandleChoice {
  sourceHandle: `source-${EdgeHandleSide}`;
  targetHandle: `target-${EdgeHandleSide}`;
}

interface Point {
  x: number;
  y: number;
}

interface SideCandidate {
  side: EdgeHandleSide;
  anchor: Point;
  outward: Point;
}

const HANDLE_SIDES: EdgeHandleSide[] = ['top', 'right', 'bottom', 'left'];
const OUTWARD_STEP = 28;
const AWAY_FROM_TARGET_PENALTY = 140;
const SAME_NODE_SIDE_PENALTY = 24;
const SAME_AXIS_BIAS = 10;
const SOURCE_DOMINANT_AXIS_BIAS = 16;

export function getDynamicEdgeHandles(sourceRect: EdgeRoutingRect, targetRect: EdgeRoutingRect): EdgeHandleChoice {
  const sourceCenter = getRectCenter(sourceRect);
  const targetCenter = getRectCenter(targetRect);
  const sourceSides = getSideCandidates(sourceRect);
  const targetSides = getSideCandidates(targetRect);
  let bestChoice: EdgeHandleChoice | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const sourceSide of sourceSides) {
    for (const targetSide of targetSides) {
      const score = scoreHandlePair(sourceSide, targetSide, sourceCenter, targetCenter);
      if (score < bestScore) {
        bestScore = score;
        bestChoice = {
          sourceHandle: `source-${sourceSide.side}`,
          targetHandle: `target-${targetSide.side}`,
        };
      }
    }
  }

  return bestChoice ?? { sourceHandle: 'source-right', targetHandle: 'target-left' };
}

function scoreHandlePair(
  sourceSide: SideCandidate,
  targetSide: SideCandidate,
  sourceCenter: Point,
  targetCenter: Point,
): number {
  const sourceExit = extend(sourceSide.anchor, sourceSide.outward);
  const targetEntry = extend(targetSide.anchor, targetSide.outward);
  const centerDelta = {
    x: targetCenter.x - sourceCenter.x,
    y: targetCenter.y - sourceCenter.y,
  };
  const targetDelta = {
    x: -centerDelta.x,
    y: -centerDelta.y,
  };

  return manhattan(sourceExit, targetEntry)
    + facingPenalty(sourceSide.outward, centerDelta)
    + facingPenalty(targetSide.outward, targetDelta)
    + (sourceSide.side === targetSide.side ? SAME_NODE_SIDE_PENALTY : 0)
    + sourceDominantAxisBias(sourceSide.side, centerDelta)
    + axisBias(sourceSide.side, targetSide.side, centerDelta);
}

function getSideCandidates(rect: EdgeRoutingRect): SideCandidate[] {
  const center = getRectCenter(rect);
  return HANDLE_SIDES.map((side) => {
    if (side === 'top') {
      return { side, anchor: { x: center.x, y: rect.y }, outward: { x: 0, y: -1 } };
    }
    if (side === 'right') {
      return { side, anchor: { x: rect.x + rect.width, y: center.y }, outward: { x: 1, y: 0 } };
    }
    if (side === 'bottom') {
      return { side, anchor: { x: center.x, y: rect.y + rect.height }, outward: { x: 0, y: 1 } };
    }
    return { side, anchor: { x: rect.x, y: center.y }, outward: { x: -1, y: 0 } };
  });
}

function axisBias(sourceSide: EdgeHandleSide, targetSide: EdgeHandleSide, centerDelta: Point): number {
  const mostlyHorizontal = Math.abs(centerDelta.x) > Math.abs(centerDelta.y);
  const sourceHorizontal = sourceSide === 'left' || sourceSide === 'right';
  const targetHorizontal = targetSide === 'left' || targetSide === 'right';
  if (mostlyHorizontal && sourceHorizontal && targetHorizontal) return -SAME_AXIS_BIAS;
  if (!mostlyHorizontal && !sourceHorizontal && !targetHorizontal) return -SAME_AXIS_BIAS;
  return 0;
}

function sourceDominantAxisBias(sourceSide: EdgeHandleSide, centerDelta: Point): number {
  const mostlyHorizontal = Math.abs(centerDelta.x) > Math.abs(centerDelta.y);
  const sourceHorizontal = sourceSide === 'left' || sourceSide === 'right';
  return mostlyHorizontal === sourceHorizontal ? -SOURCE_DOMINANT_AXIS_BIAS : 0;
}

function facingPenalty(outward: Point, targetDelta: Point): number {
  return outward.x * targetDelta.x + outward.y * targetDelta.y < 0 ? AWAY_FROM_TARGET_PENALTY : 0;
}

function extend(point: Point, outward: Point): Point {
  return {
    x: point.x + outward.x * OUTWARD_STEP,
    y: point.y + outward.y * OUTWARD_STEP,
  };
}

function getRectCenter(rect: EdgeRoutingRect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
