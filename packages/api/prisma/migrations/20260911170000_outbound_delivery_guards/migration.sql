-- AlterTable
ALTER TABLE "messages"
ADD COLUMN "allowOptedOutDelivery" BOOLEAN NOT NULL DEFAULT false;
