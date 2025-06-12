import { z } from "zod";

export const HubSpotWebhookPayload = z.array(z.record(z.any()));
export const HubSpotStatusResponse = z.object({}).catchall(z.any());
export const SlackMessageResponse = z.object({}).catchall(z.string());
export const SlackAppInteractivityPayload = z.any();
export const SlackAppEventsSubPayload = z.any();

export interface Env {
    API_TOKEN: string;
    SLACK_TEST_INTEGRATION_CHANNEL: string;
    SLACK_TOKEN: string;
    HS_KV: KVNamespace;
	STUCK_DEALS_PER_STAGE_DO: DurableObjectNamespace;
    STUCK_DEALS_PER_OWNER_DO: DurableObjectNamespace;
}

export type Bindings = Env;

export type SlackMessageBlock = {
    type: string;
    text?: {
        type: string;
        text: string;
    };
    fields?: {
        type: string;
        text: string;
    }[];
    [key: string]: any;
};

export interface UploadResult {
  success: boolean;
  fileId?: string;
  error?: string;
}