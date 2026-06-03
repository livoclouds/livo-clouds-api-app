-- AlterTable
ALTER TABLE "payment_allocations" ADD COLUMN     "unitNumber" TEXT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "unitNumbersDetected" TEXT[] DEFAULT ARRAY[]::TEXT[];
