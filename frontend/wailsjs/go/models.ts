export namespace main {
	
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

