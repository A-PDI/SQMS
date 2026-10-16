/// <reference types="node" />
export function normaliseTests(report: any): any[];
export function mapReportToInjector(report: any): any;
export function hydrateInjectorRow(row: any): any;
export function injectorScorecard(report: any): {outcome:string;overallPass:number|null;stepsTotal:number;stepsPassed:number;stepsFailed:number};
export function normaliseSerial(serial: string): string;
export function unitResolver(serials: string[]): (serial: string)=>string;
export function unitKeyer(rows:any[]):(row:any)=>string;
export function partKey(part: string):string;
export function generateInspectionPdf(inspection:any, template:any, attachments?:any[]):Promise<Buffer>;
export function generateNcrPdf(ncr:any, content?:any):Promise<Buffer>;
export function buildCustomerReport(reports:any[],opts?:any):Promise<{buffer:Buffer;filename:string}>;
export function buildShipmentEvaluationReport(reports:any[],opts?:any):Promise<{buffer:Buffer;filename:string}>;
export function buildReportPreview(reports:any[]):any;
export function buildExportModel(reports:any[],opts?:any):any;
export function buildInjectorWorkbook(model:any):Promise<any>;
export function calculateDelta(before:any,after:any):any;
export function stepCode(step:any):string;
export function stepLabel(step:any,role?:string,name?:string):string;
export function isFlushStep(step:any):boolean;
export function numericValue(v:any):number|null;
export function measurementSnapshot(report:any):Map<string,any>;
export function exclusionReasons(report:any):string[];
export function shouldImportReport(report:any):boolean;
export function zonedTimeToInstant(day:string, time?:{hour?:number;minute?:number;second?:number}, zone?:string):Date;
export const STANDARD_PLANS:any[];
export function initSectionData(sections:any):any;
export function mergeSectionData(saved:any,fresh:any):any;
export function readPartWorkbook(bytes:Buffer,extension:string):Promise<{row:number;partNumber:string;description:string;productType:string;identifierIsText:boolean}[]>;
export function writePartWorkbook(rows:any[]):Promise<Buffer>;

export function buildDimensionalFromTests(tests: any[]): { items: any[]; answers: any[] };
export function buildItemForInjector(test: any, sections: any): any;
export function buildSharedSections(sections: any): any;
export function buildExportRows(tests: any[], timeZone?: string): string[][];
export function unmappedPartsIn(tests: any[]): string[];
export function buildInjectorAnalyticsFromRows(data: any, filters?: any, details?: boolean): any;
export function buildInjectorAnalyticsWorkbookFromReport(report: any): Promise<Buffer>;
export const INJECTOR_ANALYTICS_DEFINITIONS: string[][];

export function inspectionSummaryWorkbook(report: any): Promise<Buffer>;
export function inspectionSummaryPdf(report: any): Promise<Buffer>;

export function zonedDayRange(day: string, zone?: string): {from: string;to: string};
export function currentZonedDay(now?: Date, zone?: string): string;
export function previousDay(day: string): string;

export function seedItemSerials(items: any[], lotSerialNo: string): any[];

export function matchesStepCriteria(test: any, criteria: any): boolean;
