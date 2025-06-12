# HubSpot integration worker
This is a Cloudflare Worker with OpenAPI 3.1 using [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

This is the code needed to integrate HubSpot with other tools such as Slack or Jira. It is not inteded to replace the integration apps made available through HubSpot marketplace (or other marketplaces such as the one provided by Atlassian for Jira), it is designed to complement those. It uses Cloudflare as API proxy to transform the payloads provided on HubSpot events and send them to external webhooks.

The code includes also a custom hooking feature that can be invoked at the function level and send logs to external logging systems (such as New Relic or similar). Any number of `hooks` can be defined for each function execution and will be automatically invoked after the function is executed.

## Get started
1. Sign up for [Cloudflare Workers](https://workers.dev). The free tier is more than enough for most use cases.
2. Clone this project and install dependencies with `npm install`
3. Run `wrangler login` to login to your Cloudflare account in wrangler
4. Run `wrangler deploy` to publish the API to Cloudflare Workers

## Project structure
1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development
1. Run `dl.bat` (or sh equivalent) to start a local instance of the API.
2. Open `http://localhost:8787/` in your browser to see the Swagger interface where you can try the endpoints.
3. Changes made in the `src/` folder will automatically trigger the server to reload, you only need to refresh the Swagger interface.

## Build
Run `b.bat` (or sh equivalent) to start a local instance of the API.

## Deploy
Run `d.bat` (or sh equivalent) to deploy to Cloudflare.

## Config
1. Run `kv.bat` (or sh equivalent) to create the needed Cloudflare KV name spaces (prod and preview).
2. Create `.env` file and add the env variables for KVs with the values returned by `kv.bat` (see `wrangler.template.jsonc`to understand the names of the env variables; should be in the form `${VAR}`)
3. Create `config` directory, copy the config templates (i.e. slack-webhooks.json) and personalise them
4. Run `<>.bat`(or sh equivalents) from `utilites` directory to generate the key-values pairs in the KV name spaces. It should be one `.bat` (or sh) file for each integration (i.e. `slack.bat` for Slack integration).
5. Do the needed configs on the other systems (i.e. create the needed Slack app)
6. Create the HubSpot private app and grant its needed scopes
7. Create the additional secrets in Cloudflare (HS_APP_CLIENT_SECRET = HubSpot private app client secret; HS_APP_PAT = HubSpot private app access token)

## Logging
The code includes also a custom hooking feature that can be invoked at the function level and send logs to external logging systems (such as New Relic or similar). Any number of `hooks` can be defined for each function execution and will be automatically invoked after the function is executed. This feature can be aso very useful during development because console outputs can be seen (best in dev environment using browser developer tools, but also in Cloudflare environment using `wrangler tail <worker-name>`,  in this case `wrangler tail hs`). 

For best use of this feature be sure that each function returns relevant information, even if this returned info is not further used in the code. It can be used by the hooks attached to the functions.

# Important
1. You need `openssl` and `jq` to be installed on your computer
2. If you deploy from git or you use git for your code, check if your `.gitignore` mention `.env`, `wrangler.jsonc` and the whole `config` directory to be ignored, since all these contains sensitive information. 
3. Each time after runing KV pairs generation scripts you need to stop and relaunch the local dev env (`dl.bat`) in order to be sure that everything is loaded correctly, otherwise the worker may not work well in dev env (if testing the endpoints with Postman you may get `500 Internal server error`). The production env on Cloudflare shouldn't be affected.
4. Since this worker only takes data from HubSpot events, it is not needed for the private app to have `<>.<>.write` among the scopes. If is needed to write data to HubSpot (in case if you extend the code of this worker), although it is not technically necessary, it is advisable to have a dedicated private app for this purpose. 

# Bonus
Browser dev tools can be used (meaning the console.log can be available, for example) in dev mode by pressing `d` in the terminal window where local instance of the API is running. Get that terminal window in focus and press `d`.
