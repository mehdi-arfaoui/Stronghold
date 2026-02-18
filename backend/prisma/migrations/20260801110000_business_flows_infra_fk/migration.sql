-- AddForeignKey: BusinessFlowNode -> InfraNode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BusinessFlowNode_infraNodeId_fkey'
  ) THEN
    ALTER TABLE "BusinessFlowNode"
      ADD CONSTRAINT "BusinessFlowNode_infraNodeId_fkey"
      FOREIGN KEY ("infraNodeId") REFERENCES "InfraNode"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END
$$;
