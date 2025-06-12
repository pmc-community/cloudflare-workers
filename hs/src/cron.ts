import { 
  sendIternalRequest, 
  getCurrentFunctionName,
  formatDateToString 
} from './helpers/utilities';

import { 
  getSlackUsersByEmails,
  sendMultipleDirectMessages,
  sendDirectBlockMessage,
  uploadFileExternal,
} from './helpers/slack-api';

import { getHSConfigDec } from './helpers/hs-api';

import { Env } from './types';

import { StuckDealsPerStageRPT } from './classes/RPT/StuckDealsPerStageRPT';
import { StuckDealsPerOwnerRPT } from './classes/RPT/StuckDealsPerOwnerRPT';

// SCHEDULER
// defined as function, not as const (arrow function)
// otherwise index.ts cannot export it well
export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>  {
    const cronHandler = controller.cron;
  
    if (cronHandler === '0 9 * * *') {
      await scheduledLoad_StuckDealsPerStage(controller, env, ctx);  // Schedule for every day, 09:00AM GMT
    } else if (cronHandler === '15 9 * * 1') {
      await scheduledReport_StuckDealsPerStage(controller, env, ctx);
    }  else if (cronHandler === '5 9 * * *') {
      await scheduledLoad_StuckDealsPerOwner(controller, env, ctx);
    }  else if (cronHandler === '20 9 * * 1') {
      await scheduledReport_StuckDealsPerOwner(controller, env, ctx);
    }
};

// HANDLERS
// cron handler for loading Stuck Deals Per Stage in its DO
export const scheduledLoad_StuckDealsPerStage = async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {

    // call getHSConfigDec with type=true because we pass directly the env and not the c as in hono endpoint handlers
    const hsSettings = await getHSConfigDec(env, true);
    const hsSettingsObj = JSON.parse(hsSettings);
    const emails = hsSettingsObj.executiveReports.stuckDeals.reportAdmins;
    const slackUsers = await getSlackUsersByEmails(emails, env.SLACK_TOKEN);
  
    const result = await sendIternalRequest(
      hsSettingsObj.executiveReports.stuckDeals.stuckDealsPerStageDataLoadInternalLink.url, 
      hsSettingsObj.executiveReports.stuckDeals.stuckDealsPerStageDataLoadInternalLink.method,
      null, 
      env, 
      ctx
    );

    await sendMultipleDirectMessages(
      slackUsers,
      `:gear: ${getCurrentFunctionName()} executed; :cubimal_chick: result: ${result}`,
      env.SLACK_TOKEN, 
      []
    );
}

// cron handler to generate and send Stuck Deals Per Stage report
export const scheduledReport_StuckDealsPerStage = async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
  
  // need to simulate c object from the hono endpoint handler
  // because StuckDealsPerStageRPT class needs it for init
  // only env and ctx props of the c object are needed
  const c = {
    env,
    executionCtx: ctx,
  };

  const rpt = new StuckDealsPerStageRPT();
	await rpt.init(c);
  const rptData = rpt.reportData();
  const messageList = rptData.slackDMList;
  
  for (const directMessage of messageList) {
    await sendDirectBlockMessage(
      directMessage.user,
      directMessage.message,
      env.SLACK_TOKEN,
      directMessage.messageParams,
      ':clap: Deals stuck for 1Mo+ report is ready ...'
    );

    if (directMessage.isLast) {
      if (directMessage.xlsRpt) {
        await uploadFileExternal(
          env.SLACK_TOKEN, 
          directMessage.user, 
          directMessage.xlsRpt,
          `stuckDealsPerStage_${formatDateToString(new Date())}`,
          `${formatDateToString(new Date())}: Deals stuck for 1Mo+`,
          'xlsx'
        );
      }
    }
  }
 
}

// cron handler for loading Stuck Deals Per Owner in its DO
export const scheduledLoad_StuckDealsPerOwner = async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {

    // call getHSConfigDec with type=true because we pass directly the env and not the c as in hono endpoint handlers
    const hsSettings = await getHSConfigDec(env, true);
    const hsSettingsObj = JSON.parse(hsSettings);
    const emails = hsSettingsObj.executiveReports.stuckDeals.reportAdmins;
    const slackUsers = await getSlackUsersByEmails(emails, env.SLACK_TOKEN);
  
    const result = await sendIternalRequest(
      hsSettingsObj.executiveReports.stuckDeals.stuckDealsPerOwnerDataLoadInternalLink.url, 
      hsSettingsObj.executiveReports.stuckDeals.stuckDealsPerOwnerDataLoadInternalLink.method,
      null, 
      env, 
      ctx
    );

    await sendMultipleDirectMessages(
      slackUsers,
      `:gear: ${getCurrentFunctionName()} executed; :cubimal_chick: result: ${result}`,
      env.SLACK_TOKEN, 
      []
    );
}

// cron handler to generate and send Stuck Deals Per Owner report
export const scheduledReport_StuckDealsPerOwner = async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
  
  // need to simulate c object from the hono endpoint handler
  // because StuckDealsPerStageRPT class needs it for init
  // only env and ctx props of the c object are needed
  const c = {
    env,
    executionCtx: ctx,
  };

  const rpt = new StuckDealsPerOwnerRPT();
	await rpt.init(c);
  const rptData = rpt.reportData();
  const messageList = rptData.slackDMList;
  
  for (const directMessage of messageList) {
    await sendDirectBlockMessage(
      directMessage.user,
      directMessage.message,
      env.SLACK_TOKEN,
      directMessage.messageParams,
      ':clap: Deals stuck for 1Mo+ report is ready ...'
    );

    if (directMessage.isLast) {
      if (directMessage.xlsRpt) {
        await uploadFileExternal(
          env.SLACK_TOKEN, 
          directMessage.user, 
          directMessage.xlsRpt,
          `stuckDealsPerOwner_${formatDateToString(new Date())}`,
          `${formatDateToString(new Date())}: Deals stuck (per owner) for 1Mo+`,
          'xlsx'
        );
      }
    }
  }
 
}
