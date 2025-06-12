/* EXAMPLE USAGE TO GET A COMPANY:

    - dependencies:
        - sprintf-js
        - @hubspot/api-client
    - createDate, lastModifiedDate, recordId and owner info are returned by default, no need to be asked
    - hsConfig must be in the form: 
    {
        .... other settings as you need,

        "pipelinePropertyMap": {
            "deals": "dealstage",
            "tickets": "hs_ticket_status"
        },

        .... other settings as you need
    }

    // HubSpot internal names for the company properties
    const props =[
        'name',
        'domain',
        'industry',
        'phone',
        'website',
        'address',
        'city',
        'state',
        'zip',
        'country',
        'numberofemployees',
        'annualrevenue'
    ];

    // HubSpot objects for which we need the associations with the company
    const associationsTypes = ['contacts', 'companies', 'deals', 'tickets', 'orders'];

    const company = new HubSpotObject(
        {
            objectType: <hubspot_object_type> // such as companies, contacts, deals, etc.; 'companies' in this example
            recordId:<hubspot_company_recordId>, 
            props: props, 
            associationTypes: associationsTypes,
            hsConfig // the configuration for HubSpot, see hs-config.json, passed as valid JSON string
        }
    );

    await company.init(hsToken);
    console.log(company.hsObject());
*/

import { 
    getHSClient,
    fetchAccountInfo
} from '../../helpers/hs-api';

export class HubSpotObject {
    recordId: string;
    objectType: string;
    objectInfo: any;
    accountInfo: any;
    hsObjectLink: string;
    props: string[];
    hsSettingsDec: string;
    properties: any = {};
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    createdDate: Date;
    lastModifiedDate: Date;
    associationTypes: string[];
    associations: any = {};
    hubspotClient: any;
    propertyDefinitions: Record<string, any> = {};
    private getHSClient: (token: string) => Promise<any>;
    private fetchAccountInfo: (token: string, settings: string) => Promise<any>;

    constructor(
        { objectType, recordId, props, associationTypes, hsSettingsDec }: {objectType: string, recordId: string, props: string[], associationTypes: string[], hsSettingsDec: string}
    ) {
        if (!recordId) {
            console.error(`${this.constructor.name}/${objectType}: HubSpot RecordId is required`);
        }
        this.recordId = recordId;
        this.props = props;
        this.associationTypes = associationTypes;
        this.objectType = objectType;
        this.hsSettingsDec = hsSettingsDec;
        this.objectInfo = {};
        this.accountInfo = {};
        this.hsObjectLink = null;
        this.getHSClient = getHSClient;
        this.fetchAccountInfo = fetchAccountInfo;
    }

    async init(apiKey: string): Promise<void> {
        this.hubspotClient = await this.getHSClient(apiKey);
        this.accountInfo = await this.fetchAccountInfo(apiKey, this.hsSettingsDec);
        await this.fetchPropertyDefinitions();
        await this.fetchObjectData();
    }

    private async getHSObjectLink() {
        const { sprintf } = await import('sprintf-js');
        const defaultObjectTypeMap = JSON.parse(this.hsSettingsDec).defaultObjectTypeMap;
        const rawLink = JSON.parse(this.hsSettingsDec).linkToRecord;
        const hsObjectLink = sprintf(
            rawLink,
            this.accountInfo.info.portalId,
            Object.keys(defaultObjectTypeMap).find(k => defaultObjectTypeMap[k] === this.objectType),
            this.recordId
        );
        
        return hsObjectLink; 
    }

    private async fetchPropertyDefinitions() {
        try {
            const response = await this.hubspotClient.crm.properties.coreApi.getAll(this.objectType);
            this.propertyDefinitions = {};
    
            for (const prop of response.results || []) {
                if (prop.name) {
                    this.propertyDefinitions[prop.name] = {
                        label: prop.label || prop.name, // Fallback to the name if label is not available
                        name: prop.name,
                        options: prop.options || [],
                        type: prop.type,
                    };
                }
            }
        } catch (error: any) {
            console.error(`${this.constructor.name}: Error fetching property definitions:`, error.message || error);
        }
    }
    
    private async fetchObjectData() {
        try {
            // adding hubspot_owner_id to be retrieved by default
            const propertiesToFetch = [...new Set([...this.props, 'hubspot_owner_id'])];
            const companyResponse = await this.hubspotClient.crm[this.objectType].basicApi.getById(this.recordId, propertiesToFetch);
            const properties = companyResponse?.properties || {};
    
            const allProps = await this.hubspotClient.crm.properties.coreApi.getAll(this.objectType);
            const propMetaMap = Object.fromEntries(allProps.results.map((p: any) => [p.name, p]));
    
            const pipelinePropertyMap: Record<string, string> = JSON.parse(this.hsSettingsDec).pipelinePropertyMap;
            const pipelineStageLabelMap: Record<string, Record<string, string>> = {};
    
            for (const [type, pipelineProp] of Object.entries(pipelinePropertyMap)) {
                if (this.objectType === type && this.props.includes(pipelineProp)) {
                    try {
                        const pipelines = await this.hubspotClient.crm.pipelines.pipelinesApi.getAll(type);
                        pipelineStageLabelMap[pipelineProp] = {};
    
                        for (const pipeline of pipelines.results) {
                            for (const stage of pipeline.stages) {
                                pipelineStageLabelMap[pipelineProp][stage.id] = stage.label;
                            }
                        }
                    } catch {
                        pipelineStageLabelMap[pipelineProp] = {};
                    }
                }
            }
    
            this.properties = {};
    
            for (const prop of this.props) {
                const meta = propMetaMap[prop];
                const rawValue = properties[prop];
                let displayLabel = rawValue;
    
                if (meta?.options?.length && rawValue != null) {
                    const match = meta.options.find(o => o.value === rawValue);
                    if (match) displayLabel = match.label;
                } else if (rawValue && pipelineStageLabelMap[prop]?.[rawValue]) {
                    displayLabel = pipelineStageLabelMap[prop][rawValue];
                }
    
                this.properties[prop] = {
                    label: displayLabel,
                    name: prop,
                    value: rawValue,
                };
            }
    
            // metadata timestamps
            this.createdDate = properties.createdate ? new Date(properties.createdate) : new Date();
            this.lastModifiedDate = properties.hs_lastmodifieddate ? new Date(properties.hs_lastmodifieddate) : new Date();
    
            // Resolve owner ID info (even if not explicitly requested in props)
            this.ownerId = properties.hubspot_owner_id || null;
            await this.fetchOwnerData();
    
            // Fetch any associations
            await this.fetchAllAssociations();

            // Fetch information about the object
            // - objectType such as contacts, companies, deals, etc.
            // - HubSpot object type such as 0-1, 0-2, 0-3, etc.
            // - direct link to the object in HubSpot in the format specified in hs/config/hs-config.json
            // (usually https://app.hubspot.com/contacts/<portalId>/record/<HubSpot object type>/<recordId>)
            await this.fetchObjectInfo();
    
        } catch (error: any) {
            console.error(`${this.constructor.name}: Error fetching ${this.objectType} data:`, error.message || error);
            if (error.response) {
                console.error(`${this.constructor.name}: HubSpot error response:`, JSON.stringify(error.response.body, null, 2));
            }
        }
    }
    
    private async fetchOwnerData() {
        let ownerName = null;
        let ownerEmail = null;

        const ownerId = this.ownerId;
        if (ownerId) {
            try {
                const ownerResponse = await this.hubspotClient.crm.owners.ownersApi.getById(ownerId);

                if (ownerResponse && !ownerResponse.archived) {
                    const owner = ownerResponse;
                    ownerName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();
                    ownerEmail = owner.email;
                }
            } catch (error) {
                console.warn(`${this.constructor.name}: Failed to fetch owner info.`, error.message || error);
            }
        }

        this.ownerName = ownerName;
        this.ownerEmail = ownerEmail;
    }

    private async fetchAllAssociations() {
        for (const assocType of this.associationTypes) {
            try {
                let assocResponse: any;
    
                // Check if the association API exists for the given type
                if (this.hubspotClient.crm[this.objectType]?.associationsApi?.getAll) {
                    assocResponse = await this.hubspotClient.crm[this.objectType].associationsApi.getAll(this.recordId, assocType);
                } else {
                    assocResponse = await this.hubspotClient.crm.associations.v4.basicApi.getPage(
                        this.objectType,
                        this.recordId,
                        assocType
                    );
                }
    
                // Map the associated IDs from the response
                const ids = assocResponse.results?.map((r: any) => r.id || r.toObjectId) || [];
    
                // Fetch association details for each associated ID
                const assocObjects = [];
                for (const id of ids) {
                    try {
                        const assocObj = await this.hubspotClient.crm[assocType].basicApi.getById(id);
                        const enrichedProperties: any = {};
    
                        // Enrich each property with label, name, and value
                        for (const key in assocObj.properties) {
                            const rawValue = assocObj.properties[key];
                            const definition = this.propertyDefinitions[key];
    
                            if (definition) {
                                // Handle enumeration properties
                                if (definition.type === 'enumeration') {
                                    const option = (definition.options || []).find((opt: any) => opt.value === rawValue);
                                    enrichedProperties[key] = {
                                        label: option ? option.label : rawValue,  // Human-readable label or raw value
                                        name: key,  // Internal HubSpot name
                                        value: rawValue,  // The value of the property
                                    };
                                } else {
                                    // Handle non-enumeration properties
                                    enrichedProperties[key] = {
                                        label: definition.label || key,  // Use definition label or fall back to the key name
                                        name: key,  // Internal HubSpot name
                                        value: rawValue,  // The value of the property
                                    };
                                }
                            } else {
                                // If no definition is found, fallback to using the property key as label
                                enrichedProperties[key] = {
                                    label: key,  // Fallback to using the property key as label
                                    name: key,  // Internal HubSpot name
                                    value: rawValue,  // The value of the property
                                };
                            }
                        }
    
                        assocObjects.push({ id, properties: enrichedProperties });
                    } catch {
                        // Skip individual failures
                    }
                }
    
                this.associations[assocType] = assocObjects;
    
            } catch {
                this.associations[assocType] = [];
            }
        }
    }
    
    private async fetchObjectInfo() {
        const defaultObjectTypeMap = JSON.parse(this.hsSettingsDec).defaultObjectTypeMap;
        const link = await this.getHSObjectLink();
        this.objectInfo =  {
            objectType: this.objectType,
            hsObjectType: Object.keys(defaultObjectTypeMap).find(k => defaultObjectTypeMap[k] === this.objectType),
            hsObjectLink: link,
            recordId: this.recordId,
            portalId: this.accountInfo.info.portalId,
            createdDate: this.createdDate,
            lastModifiedDate: this.lastModifiedDate,
        }
    }

    hsObject() {
        return {
            objectInfo: this.objectInfo,
            properties: this.properties,
            owner: {
                id: this.ownerId,
                name: this.ownerName,
                email: this.ownerEmail,
            },
            associations: this.associations,
        };
    }
}

export default HubSpotObject;