-- Make userId nullable in UnitOccupant (transition to memberId)
ALTER TABLE "UnitOccupant" ALTER COLUMN "userId" DROP NOT NULL;
