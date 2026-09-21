-- Relaciona cada refresh token ao token que ele substituiu. Isso permite
-- distinguir uma corrida legitima entre abas de uma reutilizacao tardia.
ALTER TABLE "sessions" ADD COLUMN "rotatedFromId" TEXT;

CREATE UNIQUE INDEX "sessions_rotatedFromId_key" ON "sessions"("rotatedFromId");

ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_rotatedFromId_fkey"
FOREIGN KEY ("rotatedFromId") REFERENCES "sessions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
