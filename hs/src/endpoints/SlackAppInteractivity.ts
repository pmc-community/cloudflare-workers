import { OpenAPIRoute } from 'chanfana';
import { SlackAppInteractivityPayload } from '../types';
import { validateSlackSignature, getSlackInteractivityPayload } from '../helpers/slack-api';

export class SlackAppInteractivity extends OpenAPIRoute {
    schema = {
      tags: ["Slack"],
      summary: "Check if Slack App allows interactivity. This endpoint can be tested only if Slack origin validation is disabled.",
      request: {
        body: {
          content: {
            "application/json": {
              schema: SlackAppInteractivityPayload,
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Returns 200 if allows interactivity",
          content: {
            "application/json": {
              schema: SlackAppInteractivityPayload,
            },
          },
        },
      },
    };
  
    async handle(c: any) {
        const rawBody = await c.req.arrayBuffer();
        const rawBodyText = new TextDecoder("utf-8").decode(rawBody);
        const slackValidation = await validateSlackSignature(c, rawBodyText);
        if (slackValidation.status !== 200) return slackValidation;

        const slackPayload = await getSlackInteractivityPayload(c);
        // here to get the Slack App payload from the request and handle it
        // to check the payload, it can be logged to console as c.req
        // but it can be seen only in Cloudflare dashboard, worker log, live log
        // static worker logs doesn't show console.log things
        return {
            // should always return 200 because Slack App waits for it to validate the interaction
            // even in the case of simple link buttons
            status: 200, 
            body: {
                interactivityAllowed: true,
                message: "Interactivity is enabled",
                slackPayload: slackPayload
            },
        };
    }
}
