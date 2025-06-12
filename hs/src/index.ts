import { fromHono } from "chanfana";
import { Hono } from "hono";
import { registerHooks } from './helpers/hooks-def';
import { Bindings } from "types";

import { HubSpotWebhook } from './endpoints/HubSpotWebhook';
import { HubSpotStatus } from './endpoints/HubSpotStatus';
import { SlackMessage } from './endpoints/SlackMessage';
import { SlackAppInteractivity } from './endpoints/SlackAppInteractivity';
import { validateRequest } from './helpers/utilities';
import { SlackAppEventsSub } from './endpoints/SlackEventsSub';

// REGISTER DURABLE OBJECTS
import { StuckDealsPerStageDO } from './classes/DO/StuckDealsPerStageDO';
export { StuckDealsPerStageDO };

import { StuckDealsPerOwnerDO } from './classes/DO/StuckDealsPerOwnerDO'
export { StuckDealsPerOwnerDO }

import { scheduled } from './cron';

// Start a Hono app
const app = new Hono<{ Bindings: Bindings }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// defines overall bearer authorization at swagger collection level
// the endpoints needing bearer authorization defines this in their specific docs
openapi.registry.registerComponent(
	'securitySchemes',
	'BearerAuth',
	{
	  type: 'http',
	  scheme: 'bearer',
	  bearerFormat: 'JWT',
	}
);

// Register OpenAPI endpoints
// HEADS UP!!!
// only api endpoints are defined with swagger docs
// internal endoints are not documented
openapi.post('/api/hswebhook', HubSpotWebhook); // no need bearer authorization, it is protected by HS signature
openapi.get('/api/hsstatus', HubSpotStatus); // needs bearer authorization
openapi.post('/api/slackstatus', SlackMessage); // neads bearer authorization

// mandatory when the Slack app has enabled the interactivity
// should be defined even when using a link button in a Slack blocks message
// should always return status 200 to let Slack now that interactivity is allowed
// see also ./src/endpoints/SlackAppInteractivity.ts
openapi.post('/api/slackappinteractivity', SlackAppInteractivity); // no need bearer authorization, it is protected by Slack signature
openapi.post('/api/slackappeventsub', SlackAppEventsSub); // no need bearer authorization, it is protected by Slack signature

// INTERNAL ENDPOINTS
// ALL NEEDS BEARER AUTHORIZATION
// Durable objects endpoints
// CANNOT BE TESTED IN LOCAL DEV ENV SINCE THE SQLITE DOs ARE AVAILABLE ONLY ON CLOUDFLARE

// StuckDealsPerStageDO
app.get('/internal/loadStuckDealsPerStage', async (c) => {
	const rqValidation = await validateRequest(c);
	if (rqValidation.status !== 200) return rqValidation;
	// Access the Durable Object via the binding
	const id = c.env.STUCK_DEALS_PER_STAGE_DO.idFromName('singleton');
	const stub = c.env.STUCK_DEALS_PER_STAGE_DO.get(id);  // Use the stub to interact with the DO
  
	// Use `c.req.url` to forward the current request URL, which works in both dev and prod
	const response = await stub.fetch(c.req.url);
	return response;
});
  
app.get('/internal/getAllStuckDealsPerStage', async (c) => {
	const rqValidation = await validateRequest(c);
	if (rqValidation.status !== 200) return rqValidation;
	const id = c.env.STUCK_DEALS_PER_STAGE_DO.idFromName('singleton');
	const stub = c.env.STUCK_DEALS_PER_STAGE_DO.get(id);
	const response = await stub.fetch(c.req.url);
	const data = await response.json();
	return c.json(data);
});

app.get('/internal/getAllStuckDealsStageValues', async (c) => {
	const rqValidation = await validateRequest(c);
	if (rqValidation.status !== 200) return rqValidation;
	const id = c.env.STUCK_DEALS_PER_STAGE_DO.idFromName('singleton');
	const stub = c.env.STUCK_DEALS_PER_STAGE_DO.get(id);
	const response = await stub.fetch(c.req.url);
	const data = await response.json();
	return c.json(data);
});

app.get('/internal/getStuckDealsStageInfo', async (c) => {
	const rqValidation = await validateRequest(c);
	if (rqValidation.status !== 200) return rqValidation;
	const id = c.env.STUCK_DEALS_PER_STAGE_DO.idFromName('singleton');
	const stub = c.env.STUCK_DEALS_PER_STAGE_DO.get(id);
	const response = await stub.fetch(c.req.url);
	const data = await response.json();
	return c.json(data);
});

// StuckDealsPerOwnerDO
app.get('/internal/loadStuckDealsPerOwner', async (c) => {
	const rqValidation = await validateRequest(c);
	if (rqValidation.status !== 200) return rqValidation;
	// Access the Durable Object via the binding
	const id = c.env.STUCK_DEALS_PER_OWNER_DO.idFromName('singleton');
	const stub = c.env.STUCK_DEALS_PER_OWNER_DO.get(id);  // Use the stub to interact with the DO
  
	// Use `c.req.url` to forward the current request URL, which works in both dev and prod
	const response = await stub.fetch(c.req.url);
	return response;
});

app.get('/internal/getAllStuckDealsPerOwner', async (c) => {
	const rqValidation = await validateRequest(c);
	if (rqValidation.status !== 200) return rqValidation;
	const id = c.env.STUCK_DEALS_PER_OWNER_DO.idFromName('singleton');
	const stub = c.env.STUCK_DEALS_PER_OWNER_DO.get(id);
	const response = await stub.fetch(c.req.url);
	const data = await response.json();
	return c.json(data);
});

// register the hooks defined for functions in ./helpers/hooks-def
registerHooks();

// need to export default more than the app
// cron job scheduled must be exported default also, otherwise is not found in prod runtime
// both 'fetch' and 'scheduled' are reserved names, cannot use different names such as const appFetch = app.fetch
export const fetch = app.fetch;
export default {
	fetch,
 	scheduled,
};
  