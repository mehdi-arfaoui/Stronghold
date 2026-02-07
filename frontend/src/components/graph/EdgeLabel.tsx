import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';

interface InfraEdgeData {
  edgeType: string;
  inferred?: boolean;
  confidence?: number;
  [key: string]: unknown;
}

type InfraEdgeProps = EdgeProps & { data?: InfraEdgeData };

export const InferredEdge = memo(function InferredEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  ...props
}: InfraEdgeProps) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <BaseEdge
      {...props}
      path={edgePath}
      style={{
        strokeDasharray: '6 4',
        stroke: 'hsl(38 92% 50%)',
        strokeWidth: 2,
      }}
    />
  );
});

export const ConfirmedEdge = memo(function ConfirmedEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  ...props
}: InfraEdgeProps) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <BaseEdge
      {...props}
      path={edgePath}
      style={{
        stroke: 'hsl(220 10% 60%)',
        strokeWidth: 2,
      }}
    />
  );
});
