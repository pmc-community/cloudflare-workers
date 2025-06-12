import { proxiedGlobals } from '../helpers/hooks';
import _ from 'lodash';

import { 
    getValFromKV, 
    decrypt, 
} from '../helpers/utilities';

// we stay to 'require' in this case because of some issues with import {...} from crypto
// chunks may get over chunkSizeWarningLimit from vite.config.ts and
// will generate the security warning of using eval() in browserify
const crypto = require('crypto'); 

export const getHSClient = async (accessToken: string) => {
    // dynamic import because the module is quite big and
    // even with splitting in chunks in vite.config.ts will not be fine 
    // (still will get chunks bigger than chunkSizeWarningLimit from vite.config.ts)
    const { Client } = await import('@hubspot/api-client');
    const hubspotClient = new Client({accessToken: accessToken,});
    return hubspotClient;
}

// HEADS UP!!!
// To test HubSpot status we use classic api requests
// to be sure that HubSpot Client API doesn't influence the check
export const checkHubSpotStatus = async (hsToken: string, hsSettingsDec: string) => {

    // for test purposes
    // ----------------------------------------------------------------
    //console.log(await fetchStuckDealsByStage(hsToken, hsSettingsDec));
    //console.log(await fetchStuckDealsByOwner(hsToken, hsSettingsDec));
    // ----------------------------------------------------------------

    try {
        const res = await fetch(JSON.parse(hsSettingsDec).accountInfoEndpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${hsToken}`,
                'Content-Type': 'application/json',
            },
        });

        const status = res.status;
        const body = await res.json();
        return {status: status, response: body};
        
    } catch (err: any) {
        return {
            status: 500,
            error: err.message || 'Unknown error',
        };
    }
};

export const validateHSSignature = (rqSignature: string, reqBody: any, clientSecret: string) => {
    const reqBodyStr = JSON.stringify(reqBody).trim();
    const source_string = clientSecret + reqBodyStr;
    const hash = crypto.createHash('sha256').update(source_string).digest('hex');

    if (rqSignature === hash) return true;
    else return false;
}

/**
 * @param {Object} event - The event object from HubSpot
 * @param {string[]} propertiesToResolve - Array of internal property names to resolve
 * @param {string[]} associationTypes - Array of object names to retrieve as associations (e.g., ['contacts', 'companies'])
 * @param {string} pat - Personal access token for HubSpot API
 * @param {string} config - JSON stringified config, including defaultObjectTypeMap
 * @returns {Promise<Object>}
 */
proxiedGlobals.resolveHubSpotObjectInfo = async (
    event: any,
    propertiesToResolve: string[] = [],
    associationTypes: string[] = [],
    pat: string,
    config: string
): Promise<any> => {
    const hubspotClient = await getHSClient(pat);
    const { objectTypeId, objectId } = event;

    const parsedConfig = JSON.parse(config);
    const defaultObjectTypeMap = parsedConfig.defaultObjectTypeMap;
    let objectName = defaultObjectTypeMap[objectTypeId] || null;
    let objectLabel = objectName;

    if (!objectName) {
        try {
            const schemas = await hubspotClient.crm.schemas.coreApi.getAll();
            const customSchema = schemas.results.find(s => s.objectTypeId === objectTypeId);

            if (!customSchema) {
                return {
                    error: 'object not found',
                    message: 'check the defaultObjectTypeMap',
                };
            }

            objectName = customSchema.fullyQualifiedName;
            objectLabel = customSchema.labels?.singular || objectName;
        } catch (err) {
            return {
                error: 'object not found',
                message: 'check the defaultObjectTypeMap',
            };
        }
    }

    const propertiesToFetch = [...new Set([...propertiesToResolve, 'hubspot_owner_id'])];
    const object = await hubspotClient.crm[objectName].basicApi.getById(objectId, propertiesToFetch);
    const properties = object?.properties || {};

    const allProps = await hubspotClient.crm.properties.coreApi.getAll(objectName);
    const propMetaMap = Object.fromEntries(allProps.results.map(p => [p.name, p]));

    const pipelinePropertyMap: Record<string, string> = parsedConfig.pipelinePropertyMap || {};
    const pipelineStageLabelMap: Record<string, Record<string, string>> = {};

    for (const [type, prop] of Object.entries(pipelinePropertyMap)) {
        if (objectName === type && propertiesToResolve.includes(prop)) {
            try {
                const pipelines = await hubspotClient.crm.pipelines.pipelinesApi.getAll(type);
                pipelineStageLabelMap[prop] = {};
                for (const pipeline of pipelines.results) {
                    for (const stage of pipeline.stages) {
                        pipelineStageLabelMap[prop][stage.id] = stage.label;
                    }
                }
            } catch {
                pipelineStageLabelMap[prop] = {};
            }
        }
    }

    const resolvedProperties: Record<string, any> = {};

    for (const prop of propertiesToResolve) {
        const meta = propMetaMap[prop];
        const rawValue = properties[prop];
        let displayValue = rawValue;

        if (meta?.options?.length && rawValue != null) {
            const match = meta.options.find(o => o.value === rawValue);
            if (match) displayValue = match.label;
        } else if (rawValue && pipelineStageLabelMap[prop]?.[rawValue]) {
            displayValue = pipelineStageLabelMap[prop][rawValue];
        }

        resolvedProperties[prop] = {
            label: meta?.label || prop,
            value: displayValue,
        };
    }

    let ownerName = `${parsedConfig.defaultOwner.name} (as default owner)`;
    let ownerEmail = parsedConfig.defaultOwner.email;
    const ownerId = properties.hubspot_owner_id;

    if (ownerId) {
        try {
            const owner = await hubspotClient.crm.owners.ownersApi.getById(ownerId);
            if (!owner.archived) {
                ownerName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();
                ownerEmail = owner.email;
            }
        } catch {
            // silently ignore owner resolution failure
        }
    }

    const associations: Record<string, any[]> = {};

    for (const assocType of associationTypes) {
        try {
            let assocResponse: any;

            if (hubspotClient.crm[objectName]?.associationsApi?.getAll) {
                assocResponse = await hubspotClient.crm[objectName].associationsApi.getAll(objectId, assocType);
            } else {
                assocResponse = await hubspotClient.crm.associations.v4.basicApi.getPage(
                    objectName,
                    objectId,
                    assocType
                );
            }

            const ids = assocResponse.results?.map((r: any) => r.id || r.toObjectId) || [];

            const assocObjects = [];
            for (const id of ids) {
                try {
                    const assocObj = await hubspotClient.crm[assocType].basicApi.getById(id);
                    assocObjects.push({ id, properties: assocObj.properties });
                } catch {
                    // skip individual failures
                }
            }

            associations[assocType] = assocObjects;
        } catch {
            associations[assocType] = [];
        }
    }

    return {
        objectName: objectLabel,
        ownerName,
        ownerEmail,
        properties: resolvedProperties,
        associations,
    };
};

export const getStuckDealsByStageWithLabels = async (
  accessToken: string,
  hsSettings: string,
  afterCursor?: string
) => {
  const hubspot = await getHSClient(accessToken);
  const parsedSettings = JSON.parse(hsSettings);
  const idleTime = parsedSettings.executiveReports.stuckDeals.idleTime;
  const ignoredStages = parsedSettings.executiveReports.stuckDeals.ignoredStages;
  const maxPageSize = parsedSettings.maxPageSize || 100;

  const idleCutoffDate = new Date();
  idleCutoffDate.setDate(idleCutoffDate.getDate() - idleTime);

  const properties = [
    'dealstage',
    'dealname',
    'hs_object_id',
    'archived',
    'hubspot_owner_id',
  ];

  // 1. Build stage metadata map
  const pipelinesRes = await hubspot.crm.pipelines.pipelinesApi.getAll('deal');
  const stageMetadata = new Map<
    string,
    {
      label: string;
      pipeline_readable_label: string;
      pipeline_hubspot_name: string;
      pipeline_hubspot_id: string;
    }
  >();

  pipelinesRes.results.forEach((pipeline: any) => {
    pipeline.stages.forEach((stage: any) => {
      stageMetadata.set(stage.id, {
        label: stage.label,
        pipeline_readable_label: pipeline.label,
        pipeline_hubspot_name: pipeline.pipelineId,
        pipeline_hubspot_id: pipeline.id,
      });
    });
  });

  // 2. Search for deal IDs
  const searchResp = await hubspot.crm.deals.searchApi.doSearch({
    limit: maxPageSize,
    after: afterCursor,
    properties: ['hubspot_owner_id', 'archived'],
  });

  // Filter out archived deals here
  const dealIds = searchResp.results
    .filter((d: any) => !d.archived && !d.properties?.archived )
    .map((d: any) => d.id);

  if (dealIds.length === 0) {
    return { stages: [], hasMore: false, nextAfter: null };
  }

  // 3. Fetch full deal data with history
  const batchResp = await hubspot.crm.deals.batchApi.read({
    properties,
    propertiesWithHistory: ['dealstage'],
    inputs: dealIds.map((id: string) => ({ id })),
  });

  const deals = batchResp.results;

  // 4. Resolve unique owner IDs
  const ownerIds = Array.from(
    new Set(deals.map((d: any) => d.properties?.hubspot_owner_id).filter(Boolean))
  );

  const ownerArchivedMap = new Map<string, boolean>();
  const BATCH_SIZE = 100;

  for (let i = 0; i < ownerIds.length; i += BATCH_SIZE) {
    const batchResult = await hubspot.crm.owners.ownersApi.getPage(undefined, undefined, undefined, false);
    for (const owner of batchResult.results) {
      ownerArchivedMap.set(owner.id.toString(), owner.archived);
    }
  }

  // 5. Process deals
  const stageCounts = new Map<
    string,
    {
      count: number;
      stuckDeals: { name: string; recordId: string; last_stage_change: string }[];
    }
  >();

  for (const deal of deals) {
    const stage = deal.properties?.dealstage;
    const dealName = deal.properties?.dealname;
    const hsObjectId = deal.properties?.hs_object_id;
    const ownerId = deal.properties?.hubspot_owner_id;
    const isOwnerArchived = ownerArchivedMap.get(ownerId || '') ?? false;
    const isArchived = deal.archived || deal.properties?.archived === 'true';

    if (!stage || isArchived || !ownerId || isOwnerArchived) {
      continue;
    }

    // Extract the dealstage history
    const history = deal.propertiesWithHistory?.dealstage || [];
    const currentStageVersion = history.find((v: any) => v.value === stage);

    let stageEnteredDate = currentStageVersion?.timestamp
      ? new Date(currentStageVersion.timestamp)
      : null;

    if (stageEnteredDate && stageEnteredDate < idleCutoffDate) {
      if (!stageCounts.has(stage)) {
        stageCounts.set(stage, { count: 0, stuckDeals: [] });
      }

      const stageDetails = stageCounts.get(stage)!;
      stageCounts.set(stage, {
        count: stageDetails.count + 1,
        stuckDeals: [
          ...stageDetails.stuckDeals,
          {
            name: dealName,
            recordId: hsObjectId,
            last_stage_change: stageEnteredDate.toISOString(),
          },
        ],
      });
    }
  }

  // 6. Format result
  const formatted = Array.from(stageCounts.entries())
    .map(([stage, { count, stuckDeals }]) => {
      const meta = stageMetadata.get(stage);
      return {
        stage,
        label: meta?.label || stage,
        count,
        pipeline_readable_label: meta?.pipeline_readable_label || null,
        pipeline_hubspot_id: meta?.pipeline_hubspot_id || null,
        stuck_deals: stuckDeals,
      };
    })
    .filter((item) => !ignoredStages.includes(item.stage));

  return {
    stages: formatted,
    hasMore: Boolean(searchResp.paging?.next?.after),
    nextAfter: searchResp.paging?.next?.after || null,
  };
};

export const fetchStuckDealsByStage = async (hsToken: string, hsSettingsDec: string) => {
    let after: string | undefined = undefined;
    let combinedStages = [];

    do {
        const { stages, nextAfter, hasMore } = await getStuckDealsByStageWithLabels(hsToken, hsSettingsDec, after);
        combinedStages.push(...stages);
        after = nextAfter;
    } while (after);
    const accountInfo = await fetchAccountInfo(hsToken, hsSettingsDec);
    const totalDeals = await getTotalDealsExcludingStages(hsToken, hsSettingsDec);
    return ({
        portalId: accountInfo.info.portalId, 
        totalDeals:totalDeals,  
        stuckDeals: _.sumBy(combinedStages, 'count'), 
        stages:combinedStages
    });

}
   
export const getStuckDealsByOwnerWithLabels = async (
  accessToken: string,
  hsSettings: string,
  afterCursor?: string
) => {
  const hubspot = await getHSClient(accessToken);
  const parsedSettings = JSON.parse(hsSettings);
  const { idleTime, ignoredStages } = parsedSettings.executiveReports.stuckDeals;
  const maxPageSize = parsedSettings.maxPageSize || 100;

  const idleDateThreshold = new Date();
  idleDateThreshold.setDate(idleDateThreshold.getDate() - idleTime);

  const properties = [
    'dealstage',
    'hubspot_owner_id',
    'hs_object_id',
    'dealname',
    'archived',
  ];

  // 1. Get pipeline/stage metadata
  const pipelinesRes = await hubspot.crm.pipelines.pipelinesApi.getAll('deal');
  const stageMetadata = new Map<string, {
    label: string;
    pipeline_readable_label: string;
    pipeline_hubspot_name: string;
    pipeline_hubspot_id: string;
  }>();

  pipelinesRes.results.forEach((pipeline: any) => {
    pipeline.stages.forEach((stage: any) => {
      stageMetadata.set(stage.id, {
        label: stage.label,
        pipeline_readable_label: pipeline.label,
        pipeline_hubspot_name: pipeline.pipelineId,
        pipeline_hubspot_id: pipeline.id,
      });
    });
  });

  // 2. Fetch a page of deals (just IDs first)
  const pageResp = await hubspot.crm.deals.basicApi.getPage(maxPageSize, afterCursor, ['hs_object_id']);
  const dealIds = pageResp.results.map(d => d.id);

  // 3. Fetch detailed deals with history
  const batchResp = await hubspot.crm.deals.batchApi.read({
    properties,
    propertiesWithHistory: ['dealstage'],
    inputs: dealIds.map(id => ({ id })),
  });

  const deals = batchResp.results;

  // 4. Extract and deduplicate owner IDs
  const ownerIds = Array.from(new Set(
    deals.map(d => d.properties.hubspot_owner_id).filter(Boolean)
  ));

  // 5. Batch fetch owners in chunks
  const ownerDetails = new Map<string, { name: string; email: string; archived: boolean }>();
  const BATCH_SIZE = 100;
  for (let i = 0; i < ownerIds.length; i += BATCH_SIZE) {
    const batchOwnerIds = ownerIds.slice(i, i + BATCH_SIZE);

    for (const ownerId of batchOwnerIds) {
      try {
        const numericOwnerId = Number(ownerId);
        if (isNaN(numericOwnerId)) continue;

        try {
          const batchOwner = await hubspot.crm.owners.ownersApi.getById(numericOwnerId);
          ownerDetails.set(ownerId, {
            name: (batchOwner.firstName === '' && batchOwner.lastName === '') ? 'ORPHAN DEAL' : `${batchOwner.firstName} ${batchOwner.lastName}` || 'ORPHAN DEAL',
            email: batchOwner.email || '',
            archived: batchOwner.archived || false,
          });
        } catch {
          continue;
        }
      } catch (error) {
        if (error.response?.body) {
          console.error(`Error fetching owner details for ID ${ownerId}:`, error.response.body);
        } else {
          console.error(`Error fetching owner details for ID ${ownerId}:`, error);
        }
      }
    }
  }

  // 6. Determine last dealstage update
  const getLastDealStageUpdate = (deal: any): Date | null => {
    const history = deal.propertiesWithHistory?.dealstage;
    if (!history || !history.length) return null;

    const sorted = history.sort((a: any, b: any) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return new Date(sorted[0].timestamp);
  };

  // 7. Process and filter deals
  const ownerDealCounts = new Map<string, {
    count: number;
    name: string;
    email: string;
    ownerId: string;
    archived: boolean;
    stuckDeals: {
      name: string;
      recordId: string;
      lastStageUpdate: string | null;
      stageLabel: string;
    }[];
  }>();

  for (const deal of deals) {
    const stage = deal.properties.dealstage;
    const ownerId = deal.properties.hubspot_owner_id;
    const dealName = deal.properties.dealname;
    const hsObjectId = deal.properties.hs_object_id;
    const isArchived = deal.properties.archived || false;

    const lastStageUpdate = getLastDealStageUpdate(deal);

    if (
      stage &&
      lastStageUpdate &&
      lastStageUpdate < idleDateThreshold &&
      !ignoredStages.includes(stage) &&
      !isArchived &&
      ownerId &&
      !ownerDetails.get(ownerId)?.archived
    ) {
      if (!ownerDealCounts.has(ownerId)) {
        const meta = ownerDetails.get(ownerId) || { name: '', email: '', archived: false };
        ownerDealCounts.set(ownerId, {
          count: 0,
          name: meta.name,
          email: meta.email,
          ownerId,
          archived: meta.archived,
          stuckDeals: [],
        });
      }

      const ownerDetailsForDeal = ownerDealCounts.get(ownerId)!;
      ownerDealCounts.set(ownerId, {
        ...ownerDetailsForDeal,
        count: ownerDetailsForDeal.count + 1,
        stuckDeals: [
          ...ownerDetailsForDeal.stuckDeals,
          {
            name: dealName,
            recordId: hsObjectId,
            lastStageUpdate: lastStageUpdate?.toISOString() || null,
            stageLabel: stageMetadata.get(stage)?.label || '',
          },
        ],
      });
    }
  }

  // 8. Return the result
  return {
    owners: Array.from(ownerDealCounts.values()).map(o => ({
      owner_id: o.ownerId,
      owner_name: o.name === '' ? 'ORPHAN DEAL' : o.name,
      owner_email: o.email,
      stuck_deals_count: o.count,
      stuck_deals: o.stuckDeals,
    })),
    hasMore: Boolean(pageResp.paging?.next?.after),
    nextAfter: pageResp.paging?.next?.after || null,
  };
};

export const fetchStuckDealsByOwner = async (hsToken: string, hsSettingsDec: string) => {
    let after: string | undefined = undefined;
    const allOwners: any[] = [];

    do {
        const { owners, nextAfter, hasMore } = await getStuckDealsByOwnerWithLabels(hsToken, hsSettingsDec, after);
        allOwners.push(...owners);
        after = nextAfter;
    } while (after);
    const accountInfo = await fetchAccountInfo(hsToken, hsSettingsDec);
    const totalDeals = await getTotalDealsExcludingStages(hsToken, hsSettingsDec);
    return ({
        portalId: accountInfo.info.portalId, 
        totalDeals:totalDeals, 
        stuckDeals:_.sumBy(allOwners, 'stuck_deals_count'), 
        owners:allOwners
    });

}
  
export const fetchAccountInfo = async (apiKey: string, hsSettingsDec: string): Promise<any> => {
    try {
        const res = await fetch(JSON.parse(hsSettingsDec).accountInfoEndpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        const status = res.status
        const body = await res.json();
        return {status: status, info: body};
        
    } catch (err: any) {
        return {
            status: 500,
            error: err.message || 'Unknown error',
        };
    }
}
export const resolveHubSpotObjectInfo = proxiedGlobals.resolveHubSpotObjectInfo;

const isOwnerArchived = async (
    accessToken: string,
    hubspotOwnerId: string | number
): Promise<boolean | null> => {
    if (!hubspotOwnerId) return null; // No owner assigned
  
    const hubspot = await getHSClient(accessToken);
  
    try {
        const res = await hubspot.crm.owners.ownersApi.getById(Number(hubspotOwnerId));
        return res.archived ?? false;
    } catch (error: any) {
        if (error.response?.status === 404) {
            return null; 
        }
    }
};

export const getTotalDealsExcludingStages = async (
    accessToken: string,
    hsSettings: string
): Promise<number> => {
    const hubspot = await getHSClient(accessToken);
    const excludedStages = JSON.parse(hsSettings).executiveReports.stuckDeals.ignoredStages;
    const response = await hubspot.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: excludedStages.map((stage: string) => ({
            propertyName: 'dealstage',
            operator: 'NEQ' as any,
            value: stage,
          })),
        },
      ],
      properties: ['dealname'],
      limit: 1,
    });
  
    return response.total;
};

export const getHSConfigDec = async (c: any, type: boolean = null) => {
    const hsConfigEnc = !type 
        ? await getValFromKV(c.env.HS_KV, 'HS_CONFIG_ENC')
        : await getValFromKV(c.HS_KV, 'HS_CONFIG_ENC' );

    const hskey = !type 
        ? c.env.HS_CONFIG_ENC_KEY
        : c.HS_CONFIG_ENC_KEY;

    const hsiv = !type  
        ? c.env.HS_CONFIG_ENC_IV
        : c.HS_CONFIG_ENC_IV;

    const hsConfigDec = decrypt(hsConfigEnc, hskey, hsiv);
    return hsConfigDec;
}

  
  
  