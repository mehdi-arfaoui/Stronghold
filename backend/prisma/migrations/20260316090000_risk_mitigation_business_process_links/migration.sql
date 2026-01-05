-- CreateTable
CREATE TABLE "_RiskMitigationBusinessProcessLinks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_RiskMitigationBusinessProcessLinks_AB_unique" ON "_RiskMitigationBusinessProcessLinks"("A", "B");

-- CreateIndex
CREATE INDEX "_RiskMitigationBusinessProcessLinks_B_index" ON "_RiskMitigationBusinessProcessLinks"("B");

-- AddForeignKey
ALTER TABLE "_RiskMitigationBusinessProcessLinks" ADD CONSTRAINT "_RiskMitigationBusinessProcessLinks_A_fkey" FOREIGN KEY ("A") REFERENCES "BusinessProcessService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RiskMitigationBusinessProcessLinks" ADD CONSTRAINT "_RiskMitigationBusinessProcessLinks_B_fkey" FOREIGN KEY ("B") REFERENCES "RiskMitigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
