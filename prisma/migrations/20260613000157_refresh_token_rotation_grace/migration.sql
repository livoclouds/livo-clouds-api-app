-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "replacedById" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replacedById_key" ON "refresh_tokens"("replacedById");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
