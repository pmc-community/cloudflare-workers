import { OpenAPIRoute } from "chanfana";
import { HubSpotStatusResponse } from "../types";
import { checkHubSpotStatus }  from '../helpers/hs-api';
import { validateRequest } from "../helpers/utilities";

import { 
	getValFromKV, 
	decrypt, 
} from '../helpers/utilities';

export class HubSpotStatus extends OpenAPIRoute {
	schema = {
		tags: ["HubSpot"],
		parameters:[
			
		],
		summary: "Check if HubSpot responds to API requests",
		security: [
			{
			  BearerAuth: [],
			},
		],
		responses: {
			"200": {
				description: "Returns HubSpot API status",
				content: {
					"application/json": {
						schema: HubSpotStatusResponse,
					},
				},
			},
		},
	};

	async handle(c: any) {
		const rqValidation = await validateRequest(c);
		if (rqValidation.status !== 200) return rqValidation;
		const hsConfigEnc =  await getValFromKV(c.env.HS_KV, 'HS_CONFIG_ENC' );
		const hskey = c.env.HS_CONFIG_ENC_KEY;
		const hsiv = c.env.HS_CONFIG_ENC_IV;
		const hsConfigDec = decrypt(hsConfigEnc, hskey, hsiv);
		const hubspotStatus = await checkHubSpotStatus(c.env.HS_APP_PAT, hsConfigDec);

		return c.json(hubspotStatus);
	}
}
