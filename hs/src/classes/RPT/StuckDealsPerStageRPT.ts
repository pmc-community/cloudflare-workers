import { 
    sendIternalRequest,
    getTimestamp14DaysAgoMillis,
    encodeLinkJsonQueryParams,
    interpolateObject,
    formatDateToString 
} from '../../helpers/utilities';

import { getHSConfigDec } from '../../helpers/hs-api';
import { 
    getSlackConfigDec, 
    getSlackUsersByEmails,
    splitBlocksWithHeaderFooter 
} from '../../helpers/slack-api';

import { 
    Env,
    SlackMessageBlock
 } from '../../types';

import { sprintf } from 'sprintf-js';

import * as XLSX from 'xlsx/xlsx.mjs'; // to generate the excel buffer

/*
 * This class is used to get the data from the StuckDealsPerStageDO durable object,
 * and send a summary report as Slack message and a detailed report as Excel file
 * The reports are sent to:
 *  - executive users defined in hs-configuration.json
 *  - HubSpot admins defined in hs-configuration.json
 * 
 * Sales team and reporting admins defined in hs-configuration.json receives a message that the report was generated.
*/

export class StuckDealsPerStageRPT {
    
    private rptData: any;
    private hsSettings: any;
    private slackSettings: any;
    private slackToken: string;

    private execEmails: string[];
    private salesEmails: string[];
    private hsAdminsEmails: string[];
    private reportAdminsEmails: string[];

    private execUsers: [];
    private salesUsers: [];
    private hsAdminsUsers: [];
    private reportAdminsUsers: [];

    private execReportBlockMessageParameters: any;
    private hsAdminReportBlockMessageParameters: any;
    private salesTeamReportBlockMessageParameters: any;

    private slackDMList: any[];

    private rptCreatedBy: string;
    private rptTitle: string;
    private rptSubject: string;
    private rptComments: string;
    private rptKeywords: string;

    private xlsRpt: Uint8Array;
    private allowedStuckDealsPercentage: number;

    url: string;
    method: string;
    body: any;
    env: Env;
    ctx: ExecutionContext;
    
    private sendInternalRequest: (
        url: string,
        method: string,
        body: any,
        env: Env,
        ctx: ExecutionContext
    ) => Promise<any>;

    private getHSConfigDec: (
        c: any,
        type: boolean
    ) => Promise<any>;

    private getSlackConfigDec: (
        c: any,
        type: boolean
    ) => Promise<any>;

    private getSlackUsersByEmails: (
        emails: string[], 
        slackToken: string
    ) => Promise<any>;

    private getTimestamp14DaysAgoMillis: (
        interval: number
    ) => number;

    private encodeLinkJsonQueryParams: (
        rawUrl: string
    ) => string;

    private interpolateObject: (
        template: any, 
        values: any
    ) => any;

    private splitBlocksWithHeaderFooter: (
        blocks: { blocks: SlackMessageBlock[] },
        partHeader: boolean,
        maxMessageLength: number,
    ) => any[];

    private formatDateToString: (
        date: Date
    ) => string;

    constructor() {
        this.sendInternalRequest = (url, method, body = null, env, ctx) => sendIternalRequest(url, method, body, env, ctx);
        this.getHSConfigDec = (c, type = null) => getHSConfigDec(c, type);
        this.getSlackConfigDec = (c, type = null) => getSlackConfigDec(c, type);
        this.getSlackUsersByEmails = (emails, slackToken) => getSlackUsersByEmails(emails, slackToken);
        this.getTimestamp14DaysAgoMillis = (interval) => getTimestamp14DaysAgoMillis(interval);
        this.getTimestamp14DaysAgoMillis = (interval) => getTimestamp14DaysAgoMillis(interval);
        this.encodeLinkJsonQueryParams = (rawUrl) => encodeLinkJsonQueryParams(rawUrl);
        this.interpolateObject = (template, values) => interpolateObject(template, values);
        this.splitBlocksWithHeaderFooter = (blocks, partHeader, maxMessageLength) => splitBlocksWithHeaderFooter(blocks, partHeader, maxMessageLength);
        this.formatDateToString = (date) => formatDateToString(date);

        this.slackDMList = [];
    }

    async init(c: any): Promise<void> {
        this.env = c.env;
        this.ctx = c.executionCtx;
        this.slackToken = this.env.SLACK_TOKEN;

        this.hsSettings = JSON.parse(await this.getHSConfigDec(c, false));
        this.url = this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageDataRetrieveInternalLink.url;
        this.method = this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageDataRetrieveInternalLink.method;
        this.rptData = JSON.parse(await this.sendInternalRequest(this.url, this.method, null, this.env, this.ctx));

        this.rptCreatedBy = this.hsSettings.executiveReports.reportCreatedBy;
        this.rptTitle = this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageRptStageMeta.rptTitle;
        this.rptSubject = this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageRptStageMeta.rptSubject;
        this.rptComments = this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageRptStageMeta.rptComments;
        this.rptKeywords = this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageRptStageMeta.rptKeywords;

        this.execEmails = this.hsSettings.executiveReports.stuckDeals.execUsers;
        this.execUsers = await this.getSlackUsersByEmails(this.execEmails, this.slackToken);
        this.salesEmails = this.hsSettings.executiveReports.stuckDeals.salesTeam;
        this.salesUsers = await this.getSlackUsersByEmails(this.salesEmails, this.slackToken);
        this.hsAdminsEmails = this.hsSettings.executiveReports.stuckDeals.hsAdmins;
        this.hsAdminsUsers = await this.getSlackUsersByEmails(this.hsAdminsEmails, this.slackToken);
        this.reportAdminsEmails = this.hsSettings.executiveReports.stuckDeals.reportAdmins;
        this.reportAdminsUsers = await this.getSlackUsersByEmails(this.reportAdminsEmails, this.slackToken);

        this.allowedStuckDealsPercentage = this.hsSettings.executiveReports.stuckDeals.allowedStuckDealsPercentage;

        this.slackSettings = JSON.parse(await this.getSlackConfigDec(c, false));

        this.xlsRpt = await this.createExecMessagesXLS(this.rptData);

        this.execReportBlockMessageParameters = this.createExecReportBlockMessageParameters(this.rptData);
        await this.createExecMessages(this.execUsers, this.execReportBlockMessageParameters);

        this.hsAdminReportBlockMessageParameters = this.createHSAdminsReportBlockMessageParameters(this.rptData);
        await this.createHsAdminMessages(this.hsAdminsUsers, this.hsAdminReportBlockMessageParameters)

        this.salesTeamReportBlockMessageParameters = this.createSalesTeamReportBlockMessageParameters(this.rptData);
        await this.createSalesTeamMessages(this.salesUsers, this.salesTeamReportBlockMessageParameters);

        await this.createReportAdminMessages(this.reportAdminsUsers);
    }

    // Slack message to executive team
    private async createExecMessages(execUsers: any[], execMessageParameters: any) {
        let execMessageTemplate = this.hsSettings.executiveReports.stuckDeals.execReportsMessageTemplate;
        execMessageTemplate.blocks.push(execMessageParameters.execReportDetails);
        this.addToSlackDMList(execUsers, execMessageTemplate, execMessageParameters, this.xlsRpt);
    }

    private createExecReportBlockMessageParameters(data: any) {
        let params: any;
        const totalDeals = data.totalDeals;
        const stuckDeals = data.stuckDeals
        const stuckDealsPercentage = Math.round((stuckDeals / totalDeals) * 100);

        const portalId = data.portalId;
        const stages = data.stages;

        const messageDetailsItem = ':small_orange_diamond: *<%s|%s>*: %d';
        const filteredStageLinkTemplate = this.hsSettings.executiveReports.stuckDeals.filteredStageLink;
        const idleTime = this.hsSettings.executiveReports.stuckDeals.idleTime;

        let stageFields = {
			type: 'section',
			fields: []
		}

        stages.forEach((stage: any) => {
            const agoTimestamp = this.getTimestamp14DaysAgoMillis(idleTime);
            const stageLink = this.encodeLinkJsonQueryParams(sprintf(filteredStageLinkTemplate, portalId, stage.stage, agoTimestamp));
            const stageItem = sprintf(messageDetailsItem, stageLink, stage.label, stage.count);

            const stageField = this.interpolateObject(
                this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageRptStageBlockTemplate,
                {stageDetails: stageItem}
            );
            stageFields.fields.push(stageField);
        })

        params = {
            totalDeals: totalDeals,
            stuckDeals: stuckDeals,
            stuckDealsPercentage: stuckDealsPercentage,
            execReportDetails: stageFields
        }
        return params;
    }

    // Slack message to HubSpot admins
    private async createHsAdminMessages(hsAdminsUsers: any[], hsAdminsMessageParameters: any) {
        let hsAdminsReportsMessageTemplate = this.hsSettings.executiveReports.stuckDeals.hsAdminsReportsMessageTemplate;
        hsAdminsReportsMessageTemplate.blocks.push(hsAdminsMessageParameters.execReportDetails);
        this.addToSlackDMList(hsAdminsUsers, hsAdminsReportsMessageTemplate, hsAdminsMessageParameters, this.xlsRpt);
    }

    private createHSAdminsReportBlockMessageParameters(data: any) {
        let params: any;
        const totalDeals = data.totalDeals;
        const stuckDeals = data.stuckDeals
        const stuckDealsPercentage = Math.round((stuckDeals / totalDeals) * 100);

        const portalId = data.portalId;
        const stages = data.stages;

        const messageDetailsItem = ':small_orange_diamond: *<%s|%s>*: %d';
        const filteredStageLinkTemplate = this.hsSettings.executiveReports.stuckDeals.filteredStageLink;
        const idleTime = this.hsSettings.executiveReports.stuckDeals.idleTime;

        let stageFields = {
			type: 'section',
			fields: []
		}

        stages.forEach((stage: any) => {
            const agoTimestamp = this.getTimestamp14DaysAgoMillis(idleTime);
            const stageLink = this.encodeLinkJsonQueryParams(sprintf(filteredStageLinkTemplate, portalId, stage.stage, agoTimestamp));
            const stageItem = sprintf(messageDetailsItem, stageLink, stage.label, stage.count);

            const stageField = this.interpolateObject(
                this.hsSettings.executiveReports.stuckDeals.stuckDealsPerStageRptStageBlockTemplate,
                {stageDetails: stageItem}
            );
            stageFields.fields.push(stageField);
        })

        params = {
            totalDeals: totalDeals,
            stuckDeals: stuckDeals,
            stuckDealsPercentage: stuckDealsPercentage,
            execReportDetails: stageFields
        }
        return params;
    }
    // Slack message to sales team
    private async createSalesTeamMessages(salesTeamUsers: any[], salesTeamMessageParameters: any) {
        let salesTeamReportsMessageTemplate = this.hsSettings.executiveReports.stuckDeals.salesTeamReportsMessageTemplate;
        this.addToSlackDMList(salesTeamUsers, salesTeamReportsMessageTemplate, salesTeamMessageParameters); // no xlsx report attached
    }    

    private createSalesTeamReportBlockMessageParameters(data: any) {
        let params: any;
        const totalDeals = data.totalDeals;
        const stuckDeals = data.stuckDeals
        const stuckDealsPercentage = Math.round((stuckDeals / totalDeals) * 100);
    
        const stuckDealsAcceptablePercentageEmoji = stuckDealsPercentage > this.allowedStuckDealsPercentage 
            ? ':no_entry:' 
            : ':white_check_mark:';

        const stuckDealsAcceptablePercentagePosition  = stuckDealsPercentage > this.allowedStuckDealsPercentage 
            ? 'above' 
            : 'below';
        
        params = {
            totalDeals: totalDeals,
            stuckDeals: stuckDeals,
            stuckDealsPercentage: stuckDealsPercentage,
            stuckDealsAcceptablePercentageEmoji: stuckDealsAcceptablePercentageEmoji,
            stuckDealsAcceptablePercentagePosition: stuckDealsAcceptablePercentagePosition,
            stuckDealsAcceptablePercentage: this.allowedStuckDealsPercentage
        }
        return params;
    }
    
    // Slack message to reporting admins
    private async createReportAdminMessages(reportAdminsUsersUsers: any[]) {
        let rptAdminsReportsMessageTemplate = this.hsSettings.executiveReports.stuckDeals.reportAdminsReportsMessageTemplate;
        this.addToSlackDMList(reportAdminsUsersUsers, rptAdminsReportsMessageTemplate, null); // no xlsx report attached, no parameters
    }  

    // XLSX creation and styling cannot be general available functions
    // should be personalised for the specific report
    private async createExecMessagesXLS(data: any): Promise<Uint8Array> {

        // some method globals to be visible in the separated sheet code blocks 
        const stages = data.stages;

        // create empty sheets
        const ws_Summary = XLSX.utils.aoa_to_sheet([]);
        const ws_Details = XLSX.utils.aoa_to_sheet([]);

        // get some vars that to be used later and should be in the method general scope
        const idleTime = this.hsSettings.executiveReports.stuckDeals.idleTime;
        const filteredStageLinkTemplate = this.hsSettings.executiveReports.stuckDeals.filteredStageLink;
        const portalId = data.portalId;
        const agoTimestamp = this.getTimestamp14DaysAgoMillis(idleTime);

        /* SUMMARY worksheet */
        {
            // Create sheet data
            // preamble
            interface preambleItem {
                info: string;
                infoValue: any;
            };

            let preamble: preambleItem[] = [];
            
            preamble.push({
                info: 'Date',
                infoValue: this.formatDateToString(new Date()),
            });

            preamble.push({
                info: 'Total deals',
                infoValue: data.totalDeals,
            });

            preamble.push({
                info: 'Stuck deals',
                infoValue: data.stuckDeals,
            });

            // stage summary
            
            let stagesSummary: preambleItem[] = [];
            stages.forEach( (stage: any) => {
                stagesSummary.push({
                    info: stage.label,
                    infoValue: stage.count,
                });
            });

            // headers (none in this case)
            
            XLSX.utils.sheet_add_json(ws_Summary, preamble, {
                origin: 'B2',
                skipHeader: true
            });

            // headers for stage summary table
            XLSX.utils.sheet_add_aoa(ws_Summary, [['Stage', 'Count']], { origin: `B6` });

            // Add stage data with hyperlinks row-by-row (because of links)

            stages.forEach((stage: any, i: number) => {
                const stageLink = this.encodeLinkJsonQueryParams(sprintf(filteredStageLinkTemplate, portalId, stage.stage, agoTimestamp));
                const row = 6 + i; // starting from row 7 (B7)

                // Stage label as a hyperlink
                const cellRef = XLSX.utils.encode_cell({ r: row, c: 1 }); // B7, B8, etc.
                ws_Summary[cellRef] = {
                    t: 's', // type: string
                    v: stage.label, // display value
                    l: { Target: stageLink } // hyperlink
                };

                // Count value (no hyperlink)
                const countRef = XLSX.utils.encode_cell({ r: row, c: 2 }); // C7, C8, etc.
                ws_Summary[countRef] = {
                    t: 'n', // type: number
                    v: stage.count
                };
            });

            // Make stage rows visible
            // decode whatever range sheet_add_json / sheet_add_aoa set for you
            let range = XLSX.utils.decode_range(ws_Summary['!ref']!);
            // ensure the end‐row covers all the stages (in this case is starting from row 6)
            range.e.r = Math.max(range.e.r, 6 + stages.length);
            // ensure at least through column C
            range.e.c = Math.max(range.e.c, 2);
            ws_Summary['!ref'] = XLSX.utils.encode_range(range);
        }

        /* DEALS DETAILS worksheet */
        {
            // create sheet json data
            interface stageDealsItem {
                stageName: string;
                stageLink: string;
                dealName: string;
                dealLink: string;
                dealLastModified: string;
            };

            let stageDetails: stageDealsItem[] = [];
            const dealLinkTemplate = this.hsSettings.linkToRecord;
            const hsObjectMap = this.hsSettings.defaultObjectTypeMap;
            const keyForDeals = Object.keys(hsObjectMap).find(
                key => hsObjectMap[key] === "deals"
            );

            // create sheet data
            stages.forEach((stage: any)  => {
                const stageLink = this.encodeLinkJsonQueryParams(sprintf(filteredStageLinkTemplate, portalId, stage.stage, agoTimestamp));
                const stageName = stage.label;
                const deals = stage.stuck_deals;
                deals.forEach((deal: any) => {
                    const dealName = deal.name;
                    const dealCode = deal.recordId;
                    const dealLastModified = this.formatDateToString(new Date(deal.stageLastModifiedDate));
                    const dealLink = this.encodeLinkJsonQueryParams(sprintf(dealLinkTemplate, portalId, keyForDeals, dealCode));
                    stageDetails.push({
                        stageName: stageName,
                        stageLink: stageLink,
                        dealName: dealName,
                        dealLink: dealLink,
                        dealLastModified: dealLastModified
                    });
                });

            });

            // create sheet and headers
            let customHeaders = [['Stage', 'Deal', 'Last modified']];

            // set autofilter 
            ws_Details['!autofilter'] = { ref: "B2:D2" };

            XLSX.utils.sheet_add_aoa(ws_Details, customHeaders, { origin: `B2` });

            // add stage details with links, row-by-row
            const startRow = 2; // zero-based row for Excel row 3
            const startCol = 1; // zero-based col for column B

            stageDetails.forEach((item, i) => {
                const r = startRow + i;

                // stageName in column B (c = 1)
                const stageNameCell = XLSX.utils.encode_cell({ r, c: startCol });
                ws_Details[stageNameCell] = {
                    t: 's',
                    v: item.stageName,
                    l: { Target: item.stageLink }
                };

                // dealName in column C (c = 2)
                const dealNameCell = XLSX.utils.encode_cell({ r, c: startCol + 1 });
                ws_Details[dealNameCell] = {
                    t: 's',
                    v: item.dealName,
                    l: { Target: item.dealLink }
                };

                // dealLastModified in column D (c = 3)
                const lastModifiedCell = XLSX.utils.encode_cell({ r, c: startCol + 2 });
                ws_Details[lastModifiedCell] = {
                    t: 's',
                    v: item.dealLastModified
                };
            });

            // Update worksheet range to include all rows and columns used and make them visible
            let range = XLSX.utils.decode_range(ws_Details['!ref'] || 'A1');
            range.e.r = Math.max(range.e.r, startRow + stageDetails.length - 1);
            range.e.c = Math.max(range.e.c, startCol + 2); // up to column D
            ws_Details['!ref'] = XLSX.utils.encode_range(range);
        }

        // Create workbook and add meta (props)
        const wb = XLSX.utils.book_new();
        wb.Props = {
            Title: this.rptTitle,
            Subject: this.rptSubject,
            Author: this.rptCreatedBy,
            Keywords: this.rptKeywords,
            CreatedDate: new Date(),
            Comments: this.rptComments,
        };

        /* Add worksheets */
        XLSX.utils.book_append_sheet(wb, ws_Summary, 'Summary');
        XLSX.utils.book_append_sheet(wb, ws_Details, 'Details');

        /* Generate the byte array, send it to syling and returning the syled workbook as byte array */
        const xlsxArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const styledBuffer = await this.styleSheetJSBuffer(xlsxArrayBuffer)
        return styledBuffer;
        //return xlsxArrayBuffer; // skip styling to check data only
    }

    private async styleSheetJSBuffer(sheetJSBuffer: Uint8Array): Promise<Uint8Array>  {
        const XlsxPopulate = await import('xlsx-populate'); // better to import it dynamically to reduce the size of the output
        const workbook = await XlsxPopulate.default.fromDataAsync(sheetJSBuffer);
        const sheets = [workbook.sheet(0), workbook.sheet(1)];

        // set the columns width to the max content on column + 2 chars
        for (const sheet of sheets) {
            const usedRange = sheet.usedRange();
            const rowCount = usedRange.endCell().rowNumber();
            const colCount = usedRange.endCell().columnNumber();

            for (let col = 1; col <= colCount; col++) {
                let maxLen = 0;

                for (let row = 1; row <= rowCount; row++) {
                    const cell = sheet.cell(row, col);
                    const value = cell.value();

                    if (value !== undefined && value !== null) {
                        const str = String(value);
                        if (str.length > maxLen) {
                            maxLen = str.length;
                        }
                    }
                }

                // Add 2-character padding
                sheet.column(col).width(maxLen + 2);
            }
        }

        const ws_Summary = workbook.sheet(0);

        // Apply styles to the first sheet (ws_Summary)
        {
            // B2:B4 → Bold
            ws_Summary.range("B2:B4").style("bold", true);

            // C2 → Right align
            ws_Summary.cell("C2").style("horizontalAlignment", "right");

            // B6 and C6 → Bold, center, yellow background
            ws_Summary.range("B6:C6").style({
                bold: true,
                horizontalAlignment: "center",
                fill: "ffff00"
            });

            // B2:C4 → Plain borders
            ws_Summary.range("B2:C4").style("border", true);

            // From B6 downward → Apply plain borders while content exists
            {
                const colStart = 2; // Column B
                const colEnd = 3;   // Column C
                let row = 6;
                while (true) {
                    const bCell = ws_Summary.cell(row, colStart).value();
                    const cCell = ws_Summary.cell(row, colEnd).value();

                    if (bCell == null && cCell == null) break;

                    ws_Summary.range(`B${row}:C${row}`).style("border", true);
                    row++;
                }
            }

            // From B7 downwards until no content, set text color blue in col B
            {
                let row = 7;
                const colB = 2;
                while (true) {
                    const cell = ws_Summary.cell(row, colB);
                    const val = cell.value();
                    if (val == null) break;
                    cell.style("fontColor", "0000FF"); // Blue color hex
                    row++;
                }
            }
        }
      
        const ws_Details = workbook.sheet(1);
        
        //Apply styles to the second sheet (ws_Details)
        {
            ws_Details.freezePanes('A3');

            // From B2 downward → Apply plain borders while content exists
            {
                const colStart = 2; // Column B
                const colEnd = 4;   // Column D
                let row = 2;
                while (true) {
                    const bCell = ws_Details.cell(row, colStart).value();
                    const cCell = ws_Details.cell(row, colEnd).value();

                    if (bCell == null && cCell == null) break;

                    ws_Details.range(`B${row}:D${row}`).style("border", true);
                    row++;
                }
            }

            // B2:D2 → Bold, yellow background
            ws_Details.range("B2:D2").style({
                bold: true,
                fill: "ffff00"
            });

            // From B3 downwards until no content, set text color blue in col B
            {
                let row = 3;
                const colB = 2;
                while (true) {
                    const cell = ws_Details.cell(row, colB);
                    const val = cell.value();
                    if (val == null) break;
                    cell.style("fontColor", "0000FF"); // Blue color hex
                    row++;
                }
            }

            // From C3 downwards until no content, set text color purple in col C
            {
                let row = 3;
                const colC = 3;
                while (true) {
                    const cell = ws_Details.cell(row, colC);
                    const val = cell.value();
                    if (val == null) break;
                    cell.style("fontColor", "800080"); // Blue color hex
                    row++;
                }
            }

        }
        
        // Export styled workbook
        return await workbook.outputAsync();
    }

    private addToSlackDMList = (users: any[], message: any, messageParams: any, xlsRpt: any = null) => {
        const maxMessageLength = this.slackSettings.maxMessageLength;
        const messageChunks = this.splitBlocksWithHeaderFooter(message, false, maxMessageLength);
        const chunksNo = messageChunks.length;
        let chunkIndex = 0;
        users.forEach(user => {
            chunkIndex = 0;
            messageChunks.forEach( chunk => {
                chunkIndex++;
                const isLast = chunkIndex === chunksNo ? true : false;
                this.slackDMList.push({
                    user: user.id,
                    message: chunk,
                    messageParams: messageParams,
                    xlsRpt: xlsRpt,
                    isLast: isLast
                });
            });
            
        });
    }

    reportData() {
        return {
            reportData: this.rptData,
            slackDMList: this.slackDMList,
            execUsers: this.execUsers,
            salesUsers: this.salesUsers,
            hsAdminsUsers: this.hsAdminsUsers,
            reportAdminsUsers: this.reportAdminsUsers,
        };
    }
}

// usage
// const rpt =  new StuckDealsPerStageRPT();
// await rpt.init(c);
// do something with rpt.reportData()
