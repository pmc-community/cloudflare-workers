import { fetchStuckDealsByStage } from '../../helpers/hs-api';
import { getValFromKV, decrypt } from '../../helpers/utilities';
import type { DurableObjectState } from '@cloudflare/workers-types';

// define data structure types for the durable object
interface StuckDeal {
  name: string;
  recordId: string;
  last_stage_change: Date;
}

interface Stage {
  stage: string;
  label: string;
  count: number;
  pipeline_readable_label: string;
  pipeline_hubspot_id: string;
  stuck_deals: StuckDeal[];
}

interface StuckDealsData {
  portalId: string;
  stuckDeals: number;
  totalDeals: number;
  stages: Stage[];
}

export class StuckDealsPerStageDO implements DurableObject {
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

        if (url.pathname === '/internal/loadStuckDealsPerStage') {
            const hsConfigEnc = await getValFromKV(this.env.HS_KV, 'HS_CONFIG_ENC');
            const hsConfigDec = decrypt(hsConfigEnc, this.env.HS_CONFIG_ENC_KEY, this.env.HS_CONFIG_ENC_IV);
            const data: StuckDealsData = await fetchStuckDealsByStage(this.env.HS_APP_PAT, hsConfigDec);
            this.storeData(data);
            return new Response('Stuck deals per stage: Data loaded', { status: 200 });
        }

        if (url.pathname === '/internal/getAllStuckDealsPerStage') {
            return this.returnStoredData();
        }

        if (url.pathname === '/internal/getAllStuckDealsStageValues') {
          return this.getStageValues();
        }

        if (url.pathname.startsWith('/internal/getStuckDealsStageInfo')) {
          const stageParam = url.searchParams.get('stage');
          if (!stageParam) {
            return new Response(
              JSON.stringify({ message: `Stage parameter missing` }),
              {
                status: 404,
                headers: {
                  'Content-Type': 'application/json'
                }
              }
            );
          }
          return this.getStageInfo(stageParam);
      }

        return new Response('Not found', { status: 404 });
      } catch (e) {
          console.error(e);
          return new Response('Internal Error', { status: 500 });
      }
  }

  private createTablesIfNotExists(): void {
      this.db.exec(
        `
          CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT
          );
          CREATE TABLE IF NOT EXISTS stages (
            stage TEXT PRIMARY KEY,
            label TEXT,
            count INTEGER,
            pipeline_readable_label TEXT,
            pipeline_hubspot_id TEXT
          );
          CREATE TABLE IF NOT EXISTS stuck_deals (
            stage TEXT,
            name TEXT,
            recordId TEXT,
            stageLastModifiedDate DATETIME,
            PRIMARY KEY (stage, recordId)
          );
        `
      );
  }

  private async storeData(data: StuckDealsData): Promise<void> {
      // Perform delete operations without awaiting, assuming these are synchronous
      this.db.exec('DELETE FROM metadata');
      this.db.exec('DELETE FROM stages');
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

      for (const stage of data.stages) {
        this.db.exec(
          `INSERT INTO stages (stage, label, count, pipeline_readable_label, pipeline_hubspot_id)
          VALUES (?, ?, ?, ?, ?)`,
          stage.stage,
          stage.label,
          stage.count,
          stage.pipeline_readable_label,
          stage.pipeline_hubspot_id
        );

        for (const deal of stage.stuck_deals) {
          this.db.exec(
            `INSERT INTO stuck_deals (stage, name, recordId, stageLastModifiedDate) VALUES (?, ?, ?, ?)`,
            stage.stage,
            deal.name,
            deal.recordId,
            deal.last_stage_change
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

    // Retrieve all stages from the stages table
    const stagesCursor = this.db.exec(`SELECT * FROM stages`);
    const stages = [];

    // Iterate through the stages cursor
    for (let stageRow = stagesCursor.next(); !stageRow.done; stageRow = stagesCursor.next()) {
      const stage = stageRow.value;

      // Retrieve deals for the current stage
      const dealsCursor = this.db.exec(
        `SELECT name, recordId, stageLastModifiedDate FROM stuck_deals WHERE stage = ?`,
        [stage.stage]
      );

      const stuckDeals = [];
      for (let dealRow = dealsCursor.next(); !dealRow.done; dealRow = await dealsCursor.next()) {
        stuckDeals.push(dealRow.value);
      }

      // Add the stage with stuck deals
      stages.push({
        ...stage,
        stuck_deals: stuckDeals
      });
    }

    // Return the portalId and stages as a JSON response
    stages.sort((a, b) => b.stuck_deals.length - a.stuck_deals.length);
    return Response.json({ portalId, totalDeals, stuckDeals, stages });
  }

  private async getStageValues(): Promise<Response> {
    const cursor = this.db.exec(`SELECT stage FROM stages`);
    const stages: string[] = [];
    for (let row = cursor.next(); !row.done; row = cursor.next()) {
      stages.push(row.value.stage);
    }
    return Response.json(stages);
  }

  private async getStageInfo(stageId: string): Promise<Response> {

    if (!stageId) {
      return new Response(
        JSON.stringify({ message: `Stage parameter missing` }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    const stageCursor = this.db.exec(
      `SELECT * FROM stages WHERE stage = ?`,
      [stageId]
    );
    const stageRow = stageCursor.next();
    if (stageRow.done) {
      return new Response(
        JSON.stringify({ message: `Stage ${stageId} not found` }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    const stage = stageRow.value;

    const dealsCursor = this.db.exec(
      `SELECT name, recordId, stageLastModifiedDate FROM stuck_deals WHERE stage = ?`,
      [stageId]
    );
    const stuckDeals = [];
    for (let row = dealsCursor.next(); !row.done; row = await dealsCursor.next()) {
      stuckDeals.push(row.value);
    }

    return Response.json({ ...stage, stuck_deals: stuckDeals });
  }
}