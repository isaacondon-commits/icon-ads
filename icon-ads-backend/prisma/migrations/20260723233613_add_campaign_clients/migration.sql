-- CreateTable
CREATE TABLE "campaign_clients" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_clients_client_id_idx" ON "campaign_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_clients_campaign_id_client_id_key" ON "campaign_clients"("campaign_id", "client_id");

-- AddForeignKey
ALTER TABLE "campaign_clients" ADD CONSTRAINT "campaign_clients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_clients" ADD CONSTRAINT "campaign_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
