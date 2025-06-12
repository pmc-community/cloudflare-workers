import { fetchStuckDealsByOwner } from '../../helpers/hs-api';
import { getValFromKV, decrypt } from '../../helpers/utilities';
import type { DurableObjectState } from '@cloudflare/workers-types';

interface StuckDeal {
  name: string;
  recordId: string;
  lastStageUpdate: Date;
  stageLabel: string;
}

interface Owner {
  owner_id: string;
  owner_name: string;
  owner_email: string;
  stuck_deals_count: number;
  stuck_deals: StuckDeal[];
}

interface StuckDealsData {
  portalId: string;
  stuckDeals: number;
  totalDeals: number;
  owners: Owner[];
}

export class StuckDealsPerOwnerDO implements DurableObject {
    private ctx: DurableObjectState;
    private env: any;
    private db: any;

    constructor(ctx: DurableObjectState, env: any) {
    this.ctx = ctx;
    this.env = env;
    this.db = ctx.storage.sql
    this.createTablesIfNotExists();
    }

    async fetch(request: Request): Promise<Response> {
        try {
            const url = new URL(request.url);

            if (url.pathname === '/internal/loadStuckDealsPerOwner') {
                const hsConfigEnc = await getValFromKV(this.env.HS_KV, 'HS_CONFIG_ENC');
                const hsConfigDec = decrypt(hsConfigEnc, this.env.HS_CONFIG_ENC_KEY, this.env.HS_CONFIG_ENC_IV);
                const data: StuckDealsData = await fetchStuckDealsByOwner(this.env.HS_APP_PAT, hsConfigDec);
                this.storeData(data);
                return new Response('Stuck deals per owner: Data loaded', { status: 200 });
            }

            if (url.pathname === '/internal/getAllStuckDealsPerOwner') {
                return this.returnStoredData();
            }

        } catch(e) {
            console.error(e);
            return new Response('Internal Error', { status: 500 });
        }
    }

    private createTablesIfNotExists():void {
        this.db.exec(
        `
          CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT
          );
          CREATE TABLE IF NOT EXISTS owners (
            owner_id TEXT PRIMARY KEY,
            owner_name TEXT,
            owner_email TEXT,
            stuck_deals_count INTEGER
          );
          CREATE TABLE IF NOT EXISTS stuck_deals (
            owner_id TEXT,
            name TEXT,
            recordId TEXT,
            lastModifiedDate DATETIME,
            stage TEXT,
            PRIMARY KEY (owner_id, recordId)
          );
        `
      );
    }

    private async storeData(data: StuckDealsData): Promise<void> {
      // Perform delete operations without awaiting, assuming these are synchronous
      this.db.exec('DELETE FROM metadata');
      this.db.exec('DELETE FROM owners');
      this.db.exec('DELETE FROM stuck_deals');

      // Perform insert operations
      this.db.exec(
        `INSERT INTO metadata (key, value) VALUES (?, ?)`,
        'portalId',
        data.portalId
      );

      this.db.exec(
        `INSERT INTO metadata (key, value) VALUES (?, ?)`,
        'stuckDeals',
        data.stuckDeals
      );

      this.db.exec(
        `INSERT INTO metadata (key, value) VALUES (?, ?)`,
        'totalDeals',
        data.totalDeals
      );

      for (const owner of data.owners) {
        this.db.exec(
          `INSERT INTO owners (owner_id, owner_name, owner_email, stuck_deals_count)
          VALUES (?, ?, ?, ?)`,
          owner.owner_id,
          owner.owner_name,
          owner.owner_email,
          owner.stuck_deals_count
        );

        for (const deal of owner.stuck_deals) {
          this.db.exec(
            `INSERT INTO stuck_deals (owner_id, name, recordId, lastModifiedDate, stage) VALUES (?, ?, ?, ?, ?)`,
            owner.owner_id,
            deal.name,
            deal.recordId,
            deal.lastStageUpdate,
            deal.stageLabel
          );
        }
      }
    }

    private async returnStoredData(): Promise<Response> {
        // Retrieve portalId from the metadata table
        const portalRowCursor = this.db.exec(`SELECT value FROM metadata WHERE key = 'portalId'`);
        const portalRow = portalRowCursor.next();
        const portalIdRaw = portalRow.done ? null : portalRow.value?.value;
        const portalId = portalIdRaw ? String(parseInt(portalIdRaw, 10)) : '';

        const stuckDealsRowCursor = this.db.exec(`SELECT value FROM metadata WHERE key = 'stuckDeals'`);
        const stuckDealsRow = stuckDealsRowCursor.next();
        const stuckDealsRaw = stuckDealsRow.done ? null : stuckDealsRow.value?.value;
        const stuckDeals = stuckDealsRaw ? parseInt(stuckDealsRaw, 10) : 0;

        const totalDealsRowCursor = this.db.exec(`SELECT value FROM metadata WHERE key = 'totalDeals'`);
        const totalDealsRow = totalDealsRowCursor.next();
        const totalDealsRaw = totalDealsRow.done ? null : totalDealsRow.value?.value;
        const totalDeals = totalDealsRaw ? parseInt(totalDealsRaw, 10) : 0;

        // Retrieve all owners from the owners table
        const ownersCursor = this.db.exec(`SELECT * FROM owners`);
        const owners = [];

        // Iterate through the owners cursor
        for (let ownerRow = ownersCursor.next(); !ownerRow.done; ownerRow = ownersCursor.next()) {
            const owner = ownerRow.value;

            // Retrieve deals for the current owner
            const dealsCursor = this.db.exec(
                `SELECT name, recordId, lastModifiedDate, stage FROM stuck_deals WHERE owner_id = ?`,
                [owner.owner_id]
            );

            const stuckDeals = [];
            for (let dealRow = dealsCursor.next(); !dealRow.done; dealRow = await dealsCursor.next()) {
                stuckDeals.push(dealRow.value);
            }

            // Add the stage with stuck deals
            owners.push({
                ...owner,
                stuck_deals: stuckDeals
            });
        }

        // Return the portalId and stages as a JSON response
        owners.sort((a, b) => b.stuck_deals.length - a.stuck_deals.length);
        return Response.json({ portalId, totalDeals, stuckDeals, owners });
  }

}
