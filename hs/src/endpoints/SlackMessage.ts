import { OpenAPIRoute } from "chanfana";
import { SlackMessageResponse } from "../types";
import { slackMessage }  from '../helpers/slack-api';
import { validateRequest } from '../helpers/utilities';

import { 
	getChannelIdByName,
	getLastMessage
} from '../helpers/slack-api';

import { StuckDealsPerStageRPT } from '../classes/RPT/StuckDealsPerStageRPT';
import { StuckDealsPerOwnerRPT } from '../classes/RPT/StuckDealsPerOwnerRPT';

export class SlackMessage extends OpenAPIRoute {
	schema = {
		tags: ["Slack"],
		summary: "Check if Slack responds to webhook",
		security: [
			{
			  BearerAuth: [],
			},
		],
		responses: {
			"200": {
				description: "Returns Slack webhook status",
				content: {
					"application/json": {
						schema: SlackMessageResponse,
					},
				},
			},
		},
	};

	async handle(c: any) {
		const rqValidation = await validateRequest(c);
		if (rqValidation.status !== 200) return rqValidation;

		// -------------------------------------------
		// only for testing, to be removed
		// const rpt =  new StuckDealsPerStageRPT();
		// await rpt.init(c);
		// ------------------------------------------

		// -------------------------------------------
		// only for testing, to be removed
		// const rpt =  new StuckDealsPerOwnerRPT();
		// await rpt.init(c);
		// ------------------------------------------

		const slackMessageStatus = await slackMessage(
			c.env.SLACK_TEST_INTEGRATION_CHANNEL, 
			c.env.SLACK_TEST_MESSAGE, 
			null
		);
		let result = c.json(slackMessageStatus);
		result.message = c.env.SLACK_TEST_MESSAGE;

		const channelId = await getChannelIdByName(c.env.SLACK_TOKEN, c.env.SLACK_TEST_INTEGRATION_CHANNEL_NAME);
		const lastMessage = await getLastMessage(channelId, c.env.SLACK_TOKEN);

		const lastMessageText = lastMessage.message.text; 

		if (lastMessageText === c.env.SLACK_TEST_MESSAGE)
			return {
				status: result.status, 
				slackMessage: lastMessageText, 
				channel: c.env.SLACK_TEST_INTEGRATION_CHANNEL_NAME,
				details: 'The test message was sent to the Slack test channel.',
				//rpt: rpt.reportData() // only for testing, to be removed
			};
		else
			return {
				status: result.status, 
				slackMessage: lastMessageText, 
				channel: c.env.SLACK_TEST_INTEGRATION_CHANNEL_NAME,
				details: 'Slack responded ok but the last message in the test channel doesn\'t match the test message'
			};
	}
}
