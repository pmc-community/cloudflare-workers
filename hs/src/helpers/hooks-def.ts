// register hooks to be executed after the function
// here can add custom logging (to New Relic or similar)

import { registerFunctionCallback } from './hooks';
import { flattenObject } from '../helpers/utilities';

export const registerHooks = () => {

    registerFunctionCallback("slackMessage", (name, result, args) => {
        console.log(`[AFTER] Function: ${name} returned:`);
        console.log({result: result});
    });

    registerFunctionCallback("getSlackWebhooks", (name, result, args) => {
        console.log(`[AFTER] Function: ${name} returned:`);
        console.log({result: result});
    });

    registerFunctionCallback("processSlack", (name, result, args) => {
        console.log(`[AFTER] Function: ${name} returned:`);
        console.log({result: result});
    });

    registerFunctionCallback("resolveHubSpotObjectInfo", (name, result, args) => {
        console.log(`[AFTER] Function: ${name} returned:`);
        console.log({result: result});
    });

    registerFunctionCallback("getSlackMessageParameters", (name, result, args) => {
        console.log(`[AFTER] Function: ${name} returned:`);
        console.log({result: result});
        console.log({flat: flattenObject(result)})
    });

    registerFunctionCallback("processSlackEvent", (name, result, args) => {
        console.log(`[AFTER] Function: ${name} returned: ${JSON.stringify({result: result})}`);
        //console.log({result: result});
    });

    registerFunctionCallback("publishHomeTab", (name, result, args) => {
        console.log(`[AFTER] Function: ${name} returned: ${JSON.stringify({result: result})}`);
        //console.log({result: result});
    });
    
}