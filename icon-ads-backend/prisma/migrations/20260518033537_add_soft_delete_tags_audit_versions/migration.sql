-- AlterTable
ALTER TABLE "ads" ADD COLUMN     "approval_status" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "playlists" ADD COLUMN     "content_hash" TEXT;

-- AlterTable
ALTER TABLE "tablets" ADD COLUMN     "schedule_at" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT DEFAULT 'America/Montevideo';

-- CreateTable
CREATE TABLE "playlist_versions" (
    "id" SERIAL NOT NULL,
    "playlist_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" INTEGER,
    "details" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "metrics_tablet_id_idx" ON "metrics"("tablet_id");

-- CreateIndex
CREATE INDEX "metrics_campaign_id_idx" ON "metrics"("campaign_id");

-- CreateIndex
CREATE INDEX "metrics_played_at_idx" ON "metrics"("played_at");

-- AddForeignKey
ALTER TABLE "playlist_versions" ADD CONSTRAINT "playlist_versions_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
