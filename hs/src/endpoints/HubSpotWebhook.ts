import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { HubSpotWebhookPayload } from '../types';
import { processSlack } from '../helpers/slack-api';
import { validateHSSignature } from '../helpers/hs-api'
import { 
	validateArrayOfObjectsWithSameStructure, 
	getValFromKV, 
	decrypt, 
} from '../helpers/utilities';
import { resolveHubSpotObjectInfo } from '../helpers/hs-api';

export class HubSpotWebhook extends OpenAPIRoute {
	schema = {
		tags: ["HubSpot"],
		summary: "Receives a payload triggered by an event in HubSpot. This endpoint can be tested only if HubSpot origin validation is disabled.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: HubSpotWebhookPayload,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Process the HubSpot webhook payload",
				content: {
					"application/json": {
						schema: HubSpotWebhookPayload,
					},
				},
			},

			// HEADS UP!!!
			// do not use Cloudflare reserved 4XX codes (i.e. 402 = payment needed)
			// see https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/
			"403": {
				description: "Not allowed. Something is suspicious about the request",
				content: {
					"application/json": {
						schema: z.object({
							error:Str(),
							message: Str(),
						}),
					},
				},
			},

			"401": {
				description: "Bad request body",
				content: {
					"application/json": {
						schema: z.object({
							error:Str(),
							message: Str(),
							data: z.object({}).catchall(z.any())
						}),
					},
				},
			},

		},
	};

	async handle(c: any) {

		// Get validated data
		const data = await this.getValidatedData<typeof this.schema>();

		const rqBody = data.body;
		const rqHeaders = c.req.header();
		const hsSignature = rqHeaders['x-hubspot-signature'] || 'no signature';
		const requireHSSignatureValidation = c.env.HS_VALIDATE_SIGNATURE;
		const clientSecret = c.env.HS_APP_CLIENT_SECRET;

		// validates HS signature and returns 403 if not valid
		// rejects any request that doesn't come from the specific HS account and private app
		if (requireHSSignatureValidation === true) {
			if ( !validateHSSignature(hsSignature, rqBody, clientSecret) ) {
				return Response.json(
					{
						error: 'Not allowed',
						message: 'We are not sure if the request comes from your HubSpot'
					},
					{
						status: 403,
					},
				);
			}
		}
		
		// rqBody must always be an array of objects having the same structure
		// returns 401 (bad request class) if the body is not ok
		if ( !validateArrayOfObjectsWithSameStructure(rqBody) ) {
			return Response.json(
				{
					error: 'Bad request',
					message: 'The request body is in wrong format',
					data: rqBody
				},
				{
					status: 401,
				},
			);
		}

		// do HubSpot to Slack integration
		let slackMessageStatuses = {}
		if (c.env.HS_TO_SLACK) {
			const slackRoutesEnc =  await getValFromKV(c.env.HS_KV, 'SLACK_WEBHOOKS_CONFIG_ENC' );
			const key = c.env.SLACK_WEBHOOKS_CONFIG_ENC_KEY;
			const iv = c.env.SLACK_WEBHOOKS_CONFIG_ENC_IV;
			const slackRoutesDec = decrypt(slackRoutesEnc, key, iv);
			const hsConfigEnc =  await getValFromKV(c.env.HS_KV, 'HS_CONFIG_ENC' );
			const hskey = c.env.HS_CONFIG_ENC_KEY;
			const hsiv = c.env.HS_CONFIG_ENC_IV;
			const hsConfigDec = decrypt(hsConfigEnc, hskey, hsiv);
			slackMessageStatuses = await processSlack(
				rqBody, 
				slackRoutesDec,
				hsConfigDec,
				c.env.HS_APP_PAT,
				resolveHubSpotObjectInfo,
				true
			);
		}

		if (c.env.HS_TO_JIRA) {
			// to be implemented ....
		}

		return {
			hs2slack: {
				slackMessageStatus: slackMessageStatuses,
				validateHSSignature: c.env.HS_VALIDATE_SIGNATURE,
				data: rqBody,
			}
		}
		
	}
}
