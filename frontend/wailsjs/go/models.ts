export namespace main {
	
	export class FilmThicknessInputFile {
	    fileName: string;
	    dataBase64: string;
	
	    static createFrom(source: any = {}) {
	        return new FilmThicknessInputFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fileName = source["fileName"];
	        this.dataBase64 = source["dataBase64"];
	    }
	}
	export class FilmThicknessAnalyzeRequest {
	    fileName: string;
	    dataBase64: string;
	    outputRoot: string;
	    files: FilmThicknessInputFile[];
	
	    static createFrom(source: any = {}) {
	        return new FilmThicknessAnalyzeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fileName = source["fileName"];
	        this.dataBase64 = source["dataBase64"];
	        this.outputRoot = source["outputRoot"];
	        this.files = this.convertValues(source["files"], FilmThicknessInputFile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FilmThicknessWaferResult {
	    sortIndex: number;
	    date: string;
	    time: string;
	    lotId: string;
	    waferId: string;
	    slotNumber: string;
	    recipe: string;
	    pointsMeasured: string;
	    e2Avg: number;
	    e2Min: number;
	    e2Max: number;
	    e2Range: number;
	    uniformityPct: number;
	    imagePath: string;
	
	    static createFrom(source: any = {}) {
	        return new FilmThicknessWaferResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sortIndex = source["sortIndex"];
	        this.date = source["date"];
	        this.time = source["time"];
	        this.lotId = source["lotId"];
	        this.waferId = source["waferId"];
	        this.slotNumber = source["slotNumber"];
	        this.recipe = source["recipe"];
	        this.pointsMeasured = source["pointsMeasured"];
	        this.e2Avg = source["e2Avg"];
	        this.e2Min = source["e2Min"];
	        this.e2Max = source["e2Max"];
	        this.e2Range = source["e2Range"];
	        this.uniformityPct = source["uniformityPct"];
	        this.imagePath = source["imagePath"];
	    }
	}
	export class FilmThicknessDateResult {
	    date: string;
	    dirPath: string;
	    pageImages: string[];
	    waferCount: number;
	
	    static createFrom(source: any = {}) {
	        return new FilmThicknessDateResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.dirPath = source["dirPath"];
	        this.pageImages = source["pageImages"];
	        this.waferCount = source["waferCount"];
	    }
	}
	export class FilmThicknessAnalyzeResult {
	    outputRoot: string;
	    summaryPath: string;
	    waferCount: number;
	    dates: FilmThicknessDateResult[];
	    wafers: FilmThicknessWaferResult[];
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new FilmThicknessAnalyzeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.outputRoot = source["outputRoot"];
	        this.summaryPath = source["summaryPath"];
	        this.waferCount = source["waferCount"];
	        this.dates = this.convertValues(source["dates"], FilmThicknessDateResult);
	        this.wafers = this.convertValues(source["wafers"], FilmThicknessWaferResult);
	        this.warnings = source["warnings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class MergedTestItemRow {
	    wafer: string;
	    values: string[];
	
	    static createFrom(source: any = {}) {
	        return new MergedTestItemRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.wafer = source["wafer"];
	        this.values = source["values"];
	    }
	}
	export class MergedTestItemExcelRequest {
	    fileName: string;
	    testItem: string;
	    rows: MergedTestItemRow[];
	
	    static createFrom(source: any = {}) {
	        return new MergedTestItemExcelRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fileName = source["fileName"];
	        this.testItem = source["testItem"];
	        this.rows = this.convertValues(source["rows"], MergedTestItemRow);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class WaferPoint {
	    x: number;
	    y: number;
	
	    static createFrom(source: any = {}) {
	        return new WaferPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	    }
	}
	export class WaferMapExportRequest {
	    fileName: string;
	    rowCount: number;
	    colCount: number;
	    xDies: number;
	    yDies: number;
	    centerX: number;
	    centerY: number;
	    radius: number;
	    maxImageSize: number;
	    backgroundColor: string;
	    passColor: string;
	    failColor: string;
	    borderColor: string;
	    axisColor: string;
	    circleColor: string;
	    centerColor: string;
	    passPoints: WaferPoint[];
	    failPoints: WaferPoint[];
	
	    static createFrom(source: any = {}) {
	        return new WaferMapExportRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fileName = source["fileName"];
	        this.rowCount = source["rowCount"];
	        this.colCount = source["colCount"];
	        this.xDies = source["xDies"];
	        this.yDies = source["yDies"];
	        this.centerX = source["centerX"];
	        this.centerY = source["centerY"];
	        this.radius = source["radius"];
	        this.maxImageSize = source["maxImageSize"];
	        this.backgroundColor = source["backgroundColor"];
	        this.passColor = source["passColor"];
	        this.failColor = source["failColor"];
	        this.borderColor = source["borderColor"];
	        this.axisColor = source["axisColor"];
	        this.circleColor = source["circleColor"];
	        this.centerColor = source["centerColor"];
	        this.passPoints = this.convertValues(source["passPoints"], WaferPoint);
	        this.failPoints = this.convertValues(source["failPoints"], WaferPoint);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

