# Purpose

This repository contains the code for Cloudflare workers that can be used for different integrations having Cloudflare as API proxy.

# HubSpot

The folder hs contains the code for a Clouflare worker used to integrate HubSpot with other tools such as Slack or Jira. It is not inteded to replace the integration apps made available through HubSpot marketplace (or other marketplaces such as the one provided by Atlassian for Jira), it is designed to complement those. It uses Cloudflare as API proxy to transform the payloads provided on HubSpot events and send them to external webhooks.