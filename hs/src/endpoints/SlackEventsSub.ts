import { OpenAPIRoute } from 'chanfana';
import { SlackAppEventsSubPayload } from '../types';
import { 
  validateSlackSignature, 
  processSlackEvent
 } from '../helpers/slack-api';

export class SlackAppEventsSub extends OpenAPIRoute {
  schema = {
    tags: ["Slack"],
    summary: "Endpoint receiving subscribed events from Slack. This endpoint can be tested only if Slack origin validation is disabled.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: SlackAppEventsSubPayload,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Process the Slack event payload",
        content: {
          "application/json": {
            schema: SlackAppEventsSubPayload,
          },
        },
      },
    },
  };

  async handle(c: any) {
    // Step 1: Read the raw body buffer
    const rawBody = await c.req.raw.text();

    // Step 2: Parse JSON from raw body for internal use
    let parsedBody: any;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (err) {
      return c.json({ error: "Invalid Slack request body JSON" }, 400);
    }

    // Step 3: Validate signature using raw body
    const slackValidation = await validateSlackSignature(c, rawBody);
    if (slackValidation.status !== 200) return slackValidation;

    // Step 4: Handle URL verification challenge
    if (parsedBody.type === "url_verification") {
      return c.json({ challenge: parsedBody.challenge });
    }
    else {
      // Step 5: Process Slack event
      // allow the event processing function to run in the background
      // because the response to Slack eventmust be sent in max. 3 seconds 
      c.executionCtx.waitUntil(processSlackEvent(c, rawBody));     
      return c.json({ ok: true });
    }
  }
}

