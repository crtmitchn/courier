export interface ParcelResponse {
	uuid?: string;
	shipments: Shipment[];
	done: boolean;
	fromCache: boolean;
	error?: string;
}

export interface Shipment {
	states: State[];
	origin: string;
	destination: string;
	carriers: string[];
	externalTracking: ExternalTracking[];
	services: DetectedCarrier[];
	detected: number[];
	detectedCarrier: DetectedCarrier;
	carrier: number;
	checkedCountry: string;
	checkedCountryCode: string;
	destinationCode: string;
	originCode: string;
	status: string;
	attributes: Attribute[];
	trackingId: string;
	lastState: State;
}

export interface Attribute {
	l: string;
	val: string;
	code?: string;
	n?: string;
}

export interface DetectedCarrier {
	name: string;
	slug: string;
}

export interface ExternalTracking {
	url: string;
	method: string;
	slug: string;
	title: string;
}

export interface State {
	location?: string;
	date: Date;
	carrier: number;
	status: string;
}

export interface Tracking {
	apiKey: string;
	trackingUrl: string;
	shipments: object[];
}

export interface LastState {
	lastPackageState: string;
}

export interface Prompt {
	TRACK_NUMBER_Q: string;
	COUNTRY_Q: string;
	UPDATE_INTERVAL_Q: number;
}
