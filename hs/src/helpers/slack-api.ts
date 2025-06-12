import { 
    getValueOrFalse, 
    objectIsEmpty, 
    isValidUrl,
    isValidDate,
    formatDate,
    interpolateObject,
} from './utilities';

import { proxiedGlobals } from '../helpers/hooks';

import { IncomingWebhook } from '@slack/webhook';
import _ from 'lodash';
import { sprintf } from 'sprintf-js'; // lodash _.template() cannot be used in Cloudflare

import { WebClient, ErrorCode } from '@slack/web-api';

import { 
    getValFromKV, 
    decrypt, 
} from '../helpers/utilities';

import { SlackMessageBlock } from '../types';


// we stay to require in this case because of some issues with import {...} from crypto
// chunks may get over chunkSizeWarningLimit from vite.config.ts and
// will generate the security warning of using eval() in browserify
const crypto = require('crypto'); 

// this function is set for monitoring, thus is added to proxiedGlobals object
// and exported from there 
proxiedGlobals.slackMessage = async (webhook: string, message: string, messageParams: Array<any>) => {
    let slackMessage = '';
    if (!messageParams) slackMessage = message;
    else slackMessage = sprintf(message, ...messageParams);
    const wh = new IncomingWebhook(webhook);
    try {
        await wh.send({text:slackMessage}); // send the entire object, not just .blocks
        return {
            status: 200,
        };
    } catch (err) {
        return {
            status: 500,
            error: err.message || 'Unknown error',
        };
    }

};
export const slackMessage = proxiedGlobals.slackMessage;

const slackBlockMessage =  async (webhook: string, message: any, messageParameters: any) => {
    let slackMessage = {};
    if(!messageParameters) slackMessage = message;
    else {
        slackMessage = interpolateObject(message, messageParameters);
    }
    const wh = new IncomingWebhook(webhook);
    try {
        await wh.send(slackMessage);
        return {
            status: 200,
        };
    } catch (err) {
        return {
            status: 500,
            error: err.message || 'Unknown error',
        };
    }
    
};

proxiedGlobals.getSlackWebhooks = (bodyRecord: any,  slackWebhooksConfig: any) => {

    const propertyChangeWebhooksObj = JSON.parse(slackWebhooksConfig);
    const subscriptionType = getValueOrFalse(bodyRecord,'subscriptionType');
    const objectTypeId = getValueOrFalse(bodyRecord, 'objectTypeId');

    if ( subscriptionType === '' || objectTypeId === '' ) return null;

    // handle object.propertyChange HubSpot event
    if (subscriptionType === 'object.propertyChange') {
        const propertyName = getValueOrFalse(bodyRecord,'propertyName');
        const propertyValue = getValueOrFalse(bodyRecord,'propertyValue');

        if ( propertyName === '' || propertyValue === '' ) return null;

        const propertyChangeWebhooks = propertyChangeWebhooksObj['object.propertyChange'];
        if (!propertyChangeWebhooks || objectIsEmpty(propertyChangeWebhooks)) return null;

        const webhookKey =  `${objectTypeId}/${propertyName}/${propertyValue}`;
        const webhookData = propertyChangeWebhooks[webhookKey];

        if (!webhookData || objectIsEmpty(webhookData) || webhookData === undefined) return null;

        const webhooks = webhookData['webhooks'];
        if (!webhooks || objectIsEmpty(webhooks)) return null;
        
        const webhooksCode = webhookData['code'];
        const props = webhookData['props'];
        const associations = webhookData['associations'];

        return {
            hooks:webhooks, 
            code: webhooksCode,
            props: props,
            associations: associations
        };
    }
}

proxiedGlobals.processSlack = async (
    rqBody: any, 
    slackRoutesDec: string, 
    hsConfigDec: string, 
    hsPAT: string, 
    resolver: any, 
    isAsyncResolver: boolean
) => {
   
    let slackMessageStatuses = {};
    
    // loop trough rqBody records
    // cannot use forEach(...) because forEach loop doesn't wait for aysnc functions
    // and we need to send slack messages with async functions
    slackMessageStatuses = await Promise.all(
        rqBody.map(async (record: any) => {
            let slackWHObject = await proxiedGlobals.getSlackWebhooks(record, slackRoutesDec);
      
            // If webhook object is not found, skip the rest and return a 400-style status
            if (!slackWHObject) {
                return [{
                    eventId: record.eventId,
                    slackWebhooksGroup: 'not found',
                    slackStatus: {
                        status: 400,
                        message: 'No Slack webhook object resolved',
                        details: 'proxiedGlobals.getSlackWebhooks returned null'
                    },
                    hookCode: null
                }];
            }
      
            let resolved = null;
            if (isAsyncResolver) {
                resolved = await resolver(
                    record,
                    slackWHObject.props ?? [],
                    slackWHObject.associations ?? [],
                    hsPAT,
                    hsConfigDec
                );
            } else {
                resolved = resolver(
                    record,
                    slackWHObject.props ?? [],
                    slackWHObject.associations ?? [],
                    hsPAT,
                    hsConfigDec
                );
            }
      
            let allSlackStatus = [];
      
            if (!resolved) {
                allSlackStatus.push({
                    eventId: record.eventId,
                    slackWebhooksGroup: 'not executed',
                    slackStatus: {
                        status: 504,
                        message: 'not executed',
                        details: 'the HubSpot record couldn\'t be resolved'
                    },
                    hookCode: 'not executed'
                });
                return allSlackStatus;
            }

            const slackWebhooks = slackWHObject.hooks ?? null;
            const slackWebhooksGroup = slackWHObject.code ?? 'not found';
            

            if (!slackWebhooks) {
                allSlackStatus.push({
                    eventId: record.eventId,
                    slackWebhooksGroup: slackWebhooksGroup,
                    slackStatus: {
                        status: 502,
                        message: 'No Slack webhooks found!',
                        details: 'Most probably the expected key is missing in slack-webhooks'
                    },
                    hookCode: null
                });
            } else {
                await Promise.all(
                    slackWebhooks.map(async (hook: any) => {
                        if (!hook.url || !isValidUrl(hook.url)) {
                            allSlackStatus.push({
                            eventId: record.eventId,
                            slackWebhooksGroup,
                            slackStatus: {
                                status: 501,
                                message: 'slack webhook invalid'
                            },
                            hookCode: hook.code
                        });
                        } else {
                            if (hook.active) {
                                const messageParameters = await getSlackMessageParameters(record, resolved, hsConfigDec);
                                const status = hook.blockMessage && !objectIsEmpty(hook.blockMessage)
                                    ? await slackBlockMessage(hook.url, hook.blockMessage, messageParameters)
                                    : await slackMessage(hook.url, hook.message, null);
        
                                allSlackStatus.push({
                                    eventId: record.eventId,
                                    slackWebhooksGroup,
                                    slackStatus: status,
                                    hookCode: hook.code
                                });
                            } else {
                                allSlackStatus.push({
                                    eventId: record.eventId,
                                    slackWebhooksGroup,
                                    slackStatus: {
                                        status: '201',
                                        message: 'hook inactive',
                                        details: 'modify slack-webhooks.json to activate the hook'
                                    },
                                    hookCode: hook.code
                                });
                            }
                                
                        }
                    })
                );
            }
      
            return allSlackStatus;
        })
    );
    return slackMessageStatuses;
}
export const processSlack = proxiedGlobals.processSlack;

proxiedGlobals.getSlackMessageParameters = (record: any, resolved: any, hsConfigDec: string) => {
    // handle object.propertyChange HubSpot event
    const hsObjectLink = sprintf(
        JSON.parse(hsConfigDec).linkToRecord,
        record.portalId,
        record.objectTypeId,
        record.objectId
    );

    let output: any;

    if (record.subscriptionType === 'object.propertyChange') {
        output = {
            link: hsObjectLink,
            owner: resolved.ownerName,
            ownerEmail: resolved.ownerEmail,
            properties: _.map(resolved.properties, prop => {
              const rawValue = prop.value;
              const formattedValue =
                typeof rawValue === 'string' && isValidDate(rawValue)
                  ? formatDate(rawValue)
                  : rawValue;
        
              return {
                name: prop.label,
                value: formattedValue
              };
            }),
            associations: _.map(resolved.associations, (items, type) => ({
              type,
              value: items.map( (item: any) => item.properties.name)
            }))
        };
    }

    return output;

}
export const getSlackMessageParameters = proxiedGlobals.getSlackMessageParameters;

export const validateSlackSignature = async (c: any, rawBody: string) => {

    if (!c.env.SLACK_VALIDATE_SIGNATURE) {
        return new Response('Slack verification disabled!', { status: 200 });
    }
    
    const timestamp = c.req.header('X-Slack-Request-Timestamp');
    const slackSig = c.req.header('x-slack-signature')
    const secret = c.env.SLACK_SIGNING_SECRET
    
    // Reject requests older than 5 minutes
    if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return new Response('Request too old or timestamp header missing or invalid request origin', { status: 400 })
    }
  
    const sigBase = `v0:${timestamp}:${rawBody}`
    const hash = crypto.createHmac('sha256', secret).update(sigBase).digest('hex')
    const computedSig = `v0=${hash}`
  
    if (computedSig !== slackSig) {
      return new Response('Invalid Slack signature', { status: 403 })
    }

    return new Response('Slack verification passed!', { status: 200 });
}

export const getSlackInteractivityPayload = async (c: any) => {
    const rawBody = await c.req.text()
    // Valid request — handle payload
    const formData = new URLSearchParams(rawBody)
    const payload = JSON.parse(formData.get('payload') || '{}')
    return payload;
}

export const getSlackUsersByEmails = async (emails: string[], slackToken: string) => {
    const client = new WebClient(slackToken);
    const results = [];
  
    for (const email of emails) {
      try {
        const res = await client.users.lookupByEmail({ email });
  
        results.push({
          email,
          id: res.user?.id || null,
        });
      } catch (err) {
        results.push({
          email,
          id: null,
          error: err.data?.error || err.message,
        });
      }
    }
  
    return results;
}

export const sendDirectMessage = async (
    userId: string, 
    message: string, 
    token: string,
    messageParams: Array<any> = null
) => {
    let slackMessage = '';
    if (!messageParams) slackMessage = message;
    else slackMessage = sprintf(message, ...messageParams);
    
    const client = new WebClient(token);
  
    // Open or get DM channel with user
    const { channel } = await client.conversations.open({ users: userId });
  
    if (!channel?.id) {
      console.error('Unable to open conversation with user.');
    }
  
    // Send message
    const result = await client.chat.postMessage({
      channel: channel.id,
      text: slackMessage,
    });

    return result;
}

export const sendMultipleDirectMessages = async (
    users :Array<any>, 
    message: string,
    token: string,
    messageParams: Array<any> = null
) => {
        
    for (const user of users) {

        try {
            await sendDirectMessage(user.id, message, token, messageParams);
          } catch (error) {
            console.error(`Failed to send message to ${user}:`, error);
          }
    }
}

export const sendDirectBlockMessage = async (
    userId: string,
    blocksPayload: { blocks: any[] },
    token: string,
    messageParameters: any = null,
    text: string = null
) => {
    const client = new WebClient(token);
  
    let slackMessage: any;

    if(!messageParameters) slackMessage = blocksPayload;
    else {
        slackMessage = interpolateObject(blocksPayload, messageParameters);
    }

    // Open or get DM channel with user
    const { channel } = await client.conversations.open({ users: userId });
  
    if (!channel?.id) {
      console.error('Unable to open conversation with user.');
    }
    
    const blocks = slackMessage.blocks;
    // Send message with blocks only
    try {
        const result = await client.chat.postMessage({
            channel: channel.id,
            blocks,
            text: text
        });
        return result;
    } catch (err) {
        console.error('Unable to send message: ', JSON.stringify(err));
        return err;
    }
};

export const sendMultipleBlockMessages = async (
    users :Array<any>,
    blocksPayload: { blocks: any[] },
    token: string,
    messageParameters: any = null
) => {
    for (const user of users) {

        try {
            await sendDirectBlockMessage(user.id, blocksPayload, token, messageParameters);
          } catch (error) {
            console.error(`Failed to send message to ${user}:`, error);
          }
    }
}

export const getChannelIdByName = async (token: string, channelName: string) => {
    const client = new WebClient(token);
  
    try {
        // Fetch list of all channels
        const result = await client.conversations.list({
            types: 'public_channel,private_channel', // Include public and private channels
        });
    
        // Find the channel with the matching name
        const channel = result.channels.find(ch => ch.name === channelName);
    
        if (channel) {
            return channel.id; // Return the channel ID
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error fetching channels:', error);
    }
};

export const getMessageChannel = async (messageTimestamp: any, channel: string, token: string) => {
    const client = new WebClient(token);
  
    try {
      // Retrieve the message details using the timestamp of the message
      const channelId = channel;
  
      const result = await client.conversations.history({
        channel: channelId,  // Specify the channel ID
        latest: messageTimestamp,
        limit: 1,
        inclusive: true,
      });
  
      const message = result.messages[0];
  
      // If the message is found, return the channel ID
      if (message) {
        console.log(`Message was sent in channel: ${channelId}`);
        return channelId;  // Return the channel ID
      } else {
        throw new Error('Message not found.');
      }
    } catch (error) {
      console.error('Error fetching message:', error);
    }
};

export const getLastMessageTimestamp = async (channelId: string, token: string): Promise<string | undefined> => {
    const client = new WebClient(token);
  
    try {
      const res = await client.conversations.history({
        channel: channelId,
        limit: 1,
      });
  
      const lastMessage = res.messages?.[0];
  
      if (lastMessage?.ts) {
        console.log(`Last message timestamp: ${lastMessage.ts}`);
        return lastMessage.ts;
      } else {
        console.log('No messages found.');
        return undefined;
      }
    } catch (error) {
      console.error('Error fetching last message timestamp:', error);
      return undefined;
    }
};
export const getLastMessage = async (
    channelId: string,
    token: string
  ): Promise<{
        timestamp: string;
        message: any;
    } | undefined> => {
    const client = new WebClient(token);
  
    try {
      const res = await client.conversations.history({
        channel: channelId,
        limit: 1,
      });
  
      const lastMessage = res.messages?.[0];
  
      if (lastMessage?.ts) {
        return {
          timestamp: lastMessage.ts,
          message: lastMessage,
        };
      } else {
        console.log('No messages found.');
        return undefined;
      }
    } catch (error) {
      console.error('Error fetching last message:', error);
      return undefined;
    }
};

proxiedGlobals.processSlackEvent = async (c: any, data: any) =>{
    const event = JSON.parse(data).event.type;
    switch (event) {
        default: break;

        case 'app_home_opened':
            await proxiedGlobals.publishHomeTab(c, data);
            return event; // returning something to be picked up by the hook (see hooks-def.ts)
    }
}
export const processSlackEvent = proxiedGlobals.processSlackEvent;

proxiedGlobals.publishHomeTab = async (c: any, data: any) => {

    const event = JSON.parse(data).event;
    const token = c.env.SLACK_TOKEN;
    const client = new WebClient(token);
    const view = await updateHomeTabView(c, event.user);
    
    try {
        const res =  await client.views.publish({
            user_id: event.user,
            view: JSON.parse(view)
        })
        return res;
    } catch (error) {
        // Check the code property, and when its a PlatformError, log the whole response.
        if (error.code === ErrorCode.PlatformError) {
            return error.data;
        } else {
            // Some other error, oh no!
            return {err: 'Well, that was unexpected.'};
        }
    }

}
export const publishHomeTab = proxiedGlobals.publishHomeTab;

const updateHomeTabView = async (c: any, user: string) => {
    const slackConfigDec = await getSlackConfigDec(c);
    const view = JSON.parse(slackConfigDec).homeTabView;
    return JSON.stringify(view);
}

export const getSlackConfigDec = async (c: any, type: boolean = null) => {
    const SlackConfigEnc = !type 
        ? await getValFromKV(c.env.HS_KV, 'SLACK_CONFIG_ENC')
        : await getValFromKV(c.HS_KV, 'SLACK_CONFIG_ENC' );

    const hskey = !type 
        ? c.env.SLACK_CONFIG_ENC_KEY
        : c.SLACK_CONFIG_ENC_KEY;

    const hsiv = !type  
        ? c.env.SLACK_CONFIG_ENC_IV
        : c.SLACK_CONFIG_ENC_IV;

    const slackConfigDec = decrypt(SlackConfigEnc, hskey, hsiv);
    return slackConfigDec;
}

/**
 * Splits the given Slack blocks into chunks with a maximum length of MAX_MESSAGE_LENGTH.
 * Each chunk will have a header or footer indicating the part number.
 *
 * @param blocks - The block kit structure: { blocks: [...] }
 * @param partHeader - Whether to include a header/footer in each chunk for continuity
 * @returns Array of chunked blocks with headers/footers
 */
export const splitBlocksWithHeaderFooter = (
  blocks: { blocks: SlackMessageBlock[] },
  partHeader: boolean = true,
  maxMessageLength: number,
): any[] => {
  const rawChunks: any[] = [];
  let currentChunk: any[] = [];
  let currentLength = 0;

  for (const block of blocks.blocks) {
    const blockStr = JSON.stringify(block);
    const blockLength = blockStr.length;

    // Split oversized section block text
    if (block.type === 'section' && block.text && block.text.text.length > maxMessageLength) {
      const splits = smartSplitText(block.text.text, maxMessageLength);
      for (const part of splits) {
        const newBlock = {
          ...block,
          text: {
            ...block.text,
            text: part,
          },
        };
        rawChunks.push([newBlock]); // Each goes in its own chunk
      }
      continue;
    }

    // Flush current chunk if adding the block would exceed max length
    if (currentLength + blockLength > maxMessageLength && currentChunk.length > 0) {
      rawChunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(block);
    currentLength += blockLength;
  }

  if (currentChunk.length > 0) {
    rawChunks.push(currentChunk);
  }

  // Add headers only if there are multiple chunks and partHeader is true
  const chunks: any[] = rawChunks.map((chunk, index) => {
    const total = rawChunks.length;
    const partNumber = index + 1;

    // Only add headers if enabled and more than 1 chunk, and NOT on last chunk
    if (partHeader && total > 1 && partNumber < total) {
      return {
        blocks: addHeaderFooterToChunk(chunk, partNumber, total),
      };
    }

    return { blocks: chunk };
  });

  return chunks;
};

/**
 * Smartly splits text on newlines or spaces, without breaking words or markdown syntax.
 */
const smartSplitText = (text: string, limit: number): string[] => {
  const result: string[] = [];

  let remaining = text;

  while (remaining.length > limit) {
    // Try to split on two newlines
    let splitIndex = remaining.lastIndexOf('\n\n', limit);

    // Fallback: single newline
    if (splitIndex < 0) {
      splitIndex = remaining.lastIndexOf('\n', limit);
    }

    // Fallback: space
    if (splitIndex < 0) {
      splitIndex = remaining.lastIndexOf(' ', limit);
    }

    // Fallback: force split
    if (splitIndex < 0) {
      splitIndex = limit;
    }

    result.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    result.push(remaining);
  }

  return result;
}

/**
 * Adds a "Part X of Y" footer/header to a chunk for continuity.
 */
const addHeaderFooterToChunk = (chunk: any[], partNumber: number, totalParts: number): any[] => {
  const headerFooter = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `_Part ${partNumber} of ${totalParts}_`,
    },
  };

  // Add header to first chunk
  if (partNumber === 1) {
    chunk.unshift(headerFooter);
  } else {
    // Add footer to subsequent chunks
    chunk.push(headerFooter);
  }

  return chunk;
}

export const uploadFileExternal = async (
  slackToken: string,
  userId: string,
  bufferJson: Uint8Array,
  fileName: string,
  fileTitle: string,
  fileType: string
) => {
  const web = new WebClient(slackToken);

  try {
    // Ensure fileName does not already have the extension
    const fullFileName = fileName.endsWith(`.${fileType}`) ? fileName : `${fileName}.${fileType}`;
    const length = bufferJson.byteLength;

    // Step 1: Get external upload URL
    const uploadUrlResp = await web.files.getUploadURLExternal({
      filename: fullFileName,
      length,
    });


    if (!uploadUrlResp.ok || !uploadUrlResp.upload_url || !uploadUrlResp.file_id) {
      console.error('Slack getUploadURLExternal failed:', uploadUrlResp.error);
      return null;
    }

    const uploadUrl = uploadUrlResp.upload_url;
    const fileId = uploadUrlResp.file_id;

    // Step 2: Upload the file to the pre-signed URL

    let mimeType: string;
    switch (fileType) {
      case 'xlsx': 
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        break;
      default:
        mimeType = 'application/octet-stream';
    }
    const formData = new FormData();
    formData.append('file', new File([bufferJson], fullFileName, {
      type: mimeType,
    }));

    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Disposition': `attachment; filename="${fullFileName}"`
      },
      body: formData,
    });


    if (!uploadResp.ok) {
      const errorText = await uploadResp.text();
      console.error('File upload failed:', errorText);
      return null;
    }

    // Step 3: Open a DM with the user
    const dmResp = await web.conversations.open({ users: userId });
    const channelId = dmResp.channel?.id;

    if (!channelId) {
      console.error('Could not open DM with user:', dmResp.error);
      return null;
    }

    // Step 4: Complete the upload to the DM channel
    const completeResp = await web.files.completeUploadExternal({
      files: [{ id: fileId, title: fileTitle }],
      channels: channelId,
      initial_comment: `:inbox_tray: *${fileTitle}* is ready for review/download.`
    } as any);

    const file = (completeResp as any).files?.[0];

    //console.log('Uploaded file metadata:', file);

    if (!file) {
      console.error('Failed to complete upload:', completeResp.error);
      return null;
    }
    return file;
  } catch (err) {
    console.error('Unexpected error during uploadExcelExternal:', err);
    return null;
  }
};








