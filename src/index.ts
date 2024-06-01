import * as util from "util";
import * as child from "child_process";
import { notify } from "node-notifier";
import { readFile, readFileSync, writeFileSync } from "fs";
import { join, parse } from "path";
import { createPromptModule } from "inquirer";
import Logger from "@ptkdev/logger";
import "dotenv/config";
import SysTray from "systray";
import * as luxon from "luxon";
import { ParcelResponse } from "./types";
import { lastPackageState } from "./laststate.json";
import { TRACK_NUMBER, COUNTRY } from "./tracking.json";

// Configuring logger
const options: object = {
	language: "en",
	colors: true,
	debug: true,
	info: true,
	warning: true,
	error: true,
	sponsor: true,
	write: true,
	type: "log",
	rotate: {
		size: "10M",
		encoding: "utf8"
	},
	path: {
		debug_log: "./debug.log",
		error_log: "./errors.log"
	}
};

// Initializing logger
const logger = new Logger(options);

// Notifications
function notification(title: string, message: string, silent: boolean) {
	notify({
		title: title,
		message: message,
		icon: join(__dirname, "assets/courier.png"),
		sound: silent
	});
}

// Getting user input (Tracking number and destination country)
async function getTracking(): Promise<any> {
	logger.info("Asking for prompt", "getTracking");
	const questions = [
		{
			type: "input",
			name: "TRACK_NUMBER_Q",
			message: "Enter your tracking number or leave it blank if you saved it before"
		},
		{
			type: "input",
			name: "COUNTRY_Q",
			message: "Enter destination country or leave it blank if you saved it before"
		}
	];

	const prompt = createPromptModule();
	const answer: any = await prompt(questions);

	return answer;
}

// Parsing user input and checking if we got new info from user
async function parseTracking(): Promise<void> {
	logger.info("Parsing answers", "parseTracking");
	const answer = await getTracking();

	const TRACK_NUMBER_Q = answer["TRACK_NUMBER_Q"];
	const COUNTRY_Q = answer["COUNTRY_Q"];

	if (TRACK_NUMBER_Q.length || COUNTRY_Q.length > 0) {
		logger.warning(
			"Track number or country length are not equal to 0, overwriting",
			"parseTracking"
		);
		const newTracking: object = {
			TRACK_NUMBER: TRACK_NUMBER_Q.length ? TRACK_NUMBER_Q : TRACK_NUMBER,
			COUNTRY: COUNTRY_Q.length ? COUNTRY_Q : COUNTRY
		};

		writeFileSync(join(__dirname, "tracking.json"), JSON.stringify(newTracking), "utf-8");
	}
}

// Reading tracking.json
async function readTrackingInfo(): Promise<any> {
	const tracker = readFileSync(join(__dirname, "tracking.json"));
	const trackingJSON = JSON.parse(tracker.toString());

	const apiKey = process.env.PARCELSAPP_API_KEY;
	const trackingUrl = "https://parcelsapp.com/api/v3/shipments/tracking";
	const shipments = [
		{
			trackingId: trackingJSON.TRACK_NUMBER,
			language: "en",
			country: trackingJSON.COUNTRY
		}
	];

	const trackingInfoObject: object = {
		apiKey: apiKey,
		trackingUrl: trackingUrl,
		shipments: shipments
	};

	return trackingInfoObject;
}

// Reading laststate.json
async function readLastState(): Promise<any> {
	const ls = readFileSync(join(__dirname, "laststate.json"));
	const lsJSON = JSON.parse(ls.toString());

	const lastPackageStateObject: object = {
		lastPackageState: lsJSON.lastPackageState
	};

	return lastPackageStateObject;
}

// POST request to ParcelsApp API (which documentation is shit)
async function getData(): Promise<ParcelResponse> {
	const info = await readTrackingInfo();

	const url = info["trackingUrl"];
	const body = {
		apiKey: info["apiKey"],
		shipments: info["shipments"]
	};
	const customHeaders = {
		"Content-Type": "application/json"
	};

	if (!body.shipments) {
		logger.warning("No data was received! Either ParcelsApp API returned only UUID or connection was unsuccessful.", "getData");
		return {
			shipments: [
				{
					states: [],
					origin: "No data",
					destination: "No data",
					carriers: [],
					externalTracking: [],
					attributes: [
						{
							l: "days_transit",
							n: "Days in transit",
							val: "No data"
						}
					],
					services: [],
					detected: [],
					detectedCarrier: {
						name: "No data",
						slug: "No data"
					},
					carrier: 0,
					checkedCountry: "No data",
					checkedCountryCode: "N/A",
					destinationCode: "N/A",
					originCode: "N/A",
					status: "No data",
					trackingId: "No data",
					lastState: {
						date: new Date(),
						carrier: 0,
						status: "No data"
					}
				}
			],
			"done": true,
			"fromCache": true
		}
	}

	const res = await fetch(url, {
		method: "POST",
		headers: customHeaders,
		body: JSON.stringify(body)
	});
	const data = await res.json();
	return data;
}

// Check which OS are we running on and use proper method to kill tray
function destroyTray(): void {
	switch (process.platform) {
		case "win32":
			child.execSync("taskkill /f /im tray_windows_release.exe");
			break;
		case "linux":
			child.execSync("killall -r tray_linux_release");
			break;
	}
}

// Loading icon (which will be converted to Base64 string)
const icon = readFileSync(join(__dirname, `./assets/courier.ico`));

// Main loop
async function main(): Promise<void> {
	logger.info("Updating data", "main");
	const data = await getData();
	console.log(data);
	const lastPackState = await readLastState();

	// Checking if package state changed
	try {
		if (lastPackState.lastPackageState != data.shipments[0].lastState.status) {
			notification("State changed!", data.shipments[0].states[0].status, true);
			logger.warning("State changed!", "main");
			logger.debug(`Previous state: ${lastPackageState}`, "main");
			logger.debug(`New state: ${data.shipments[0].lastState.status}`, "main");

			const newPackageState: object = {
				lastPackageState: data.shipments[0].states[0].status
			};
			writeFileSync(
				join(__dirname, "laststate.json"),
				JSON.stringify(newPackageState),
				"utf-8"
			);
		} else {
			logger.sponsor("State is the same", "main");
		}
	} catch (err: any) {
		logger.error(err);
	}

	if (data.error) throw new Error(`Error while getting parcel info. ${data.error}`);

	// Tray icon
	const systray = new SysTray({
		menu: {
			icon: icon.toString("base64"),
			title: "",
			tooltip: "Courier",
			items: [
				{
					title: "Close Tracker",
					tooltip: "Closes tracker",
					checked: false,
					enabled: true
				},
				{
					title: `Currently tracking: ${data.shipments[0].trackingId} (click to copy)`,
					tooltip: "Short package info",
					checked: true,
					enabled: true
				},
				{
					title: "= - = - = - = - = - = - = - = - = - = - = - =",
					tooltip: "= - = - = - = - = - = - = - = - = - = - = - =",
					checked: false,
					enabled: false
				},
				{
					title: `Origin: ${data.shipments[0].origin} (${data.shipments[0].originCode})`,
					tooltip: "Shipment origin",
					checked: false,
					enabled: true
				},
				{
					title: `Destination: ${data.shipments[0].destination} (${data.shipments[0].destinationCode})`,
					tooltip: "Shipment destination",
					checked: false,
					enabled: true
				},
				{
					title: `Carrier: ${data.shipments[0].detectedCarrier.name}`,
					tooltip: "Shipment carrier",
					checked: false,
					enabled: true
				},
				{
					title: `Status: ${data.shipments[0].status}`,
					tooltip: "Shipment status",
					checked: false,
					enabled: true
				},
				{
					title: data.shipments[0].attributes[data.shipments[0].attributes.length - 1]
						? `Days in transit: ${data.shipments[0].attributes[data.shipments[0].attributes.length - 1].val}`
						: "No data",
					tooltip: "Showing 10 recent events",
					checked: false,
					enabled: true
				},
				{
					title: "= - = - = - = - = - = - = - = - = - = - = - =",
					tooltip: "= - = - = - = - = - = - = - = - = - = - = - =",
					checked: false,
					enabled: false
				},
				{
					title: data.shipments[0].states[0]
						? `--> [ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[0].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[0].location ? ` at ${data.shipments[0].states[0].location} ] ` : " ] "}${data.shipments[0].states[0].status}`
						: "No data",
					tooltip: "-",
					checked: true,
					enabled: data.shipments[0].states[0] ? true : false
				},
				{
					title: data.shipments[0].states[1]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[1].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[1].location ? ` at ${data.shipments[0].states[1].location} ] ` : " ] "}${data.shipments[0].states[1].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[1] ? true : false
				},
				{
					title: data.shipments[0].states[2]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[2].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[2].location ? ` at ${data.shipments[0].states[2].location} ] ` : " ] "}${data.shipments[0].states[2].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[2] ? true : false
				},
				{
					title: data.shipments[0].states[3]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[3].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[3].location ? ` at ${data.shipments[0].states[3].location} ] ` : " ] "}${data.shipments[0].states[3].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[3] ? true : false
				},
				{
					title: data.shipments[0].states[4]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[4].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[4].location ? ` at ${data.shipments[0].states[4].location} ] ` : " ] "}${data.shipments[0].states[4].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[4] ? true : false
				},
				{
					title: data.shipments[0].states[5]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[5].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[5].location ? ` at ${data.shipments[0].states[5].location} ] ` : " ] "}${data.shipments[0].states[5].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[5] ? true : false
				},
				{
					title: data.shipments[0].states[6]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[6].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[6].location ? ` at ${data.shipments[0].states[6].location} ] ` : " ] "}${data.shipments[0].states[6].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[6] ? true : false
				},
				{
					title: data.shipments[0].states[7]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[7].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[7].location ? ` at ${data.shipments[0].states[7].location} ] ` : " ] "}${data.shipments[0].states[7].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[7] ? true : false
				},
				{
					title: data.shipments[0].states[8]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[8].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[8].location ? ` at ${data.shipments[0].states[8].location} ] ` : " ] "}${data.shipments[0].states[8].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[8] ? true : false
				},
				{
					title: data.shipments[0].states[9]
						? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[9].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[9].location ? ` at ${data.shipments[0].states[9].location} ] ` : " ] "}${data.shipments[0].states[9].status}`
						: "No data",
					tooltip: "-",
					checked: false,
					enabled: data.shipments[0].states[9] ? true : false
				}
			]
		}
	});

	// Tray interactivity
	systray.onClick((action) => {
		switch (action.seq_id) {
			case 0:
				logger.warning("Stopping process");
				systray.kill();
				break;
			case 1:
				notification(
					"Tracking number",
					"Copied tracking number into clipping board",
					false
				);
				logger.docs(
					`Copying tracking number (${data.shipments[0] ? data.shipments[0].trackingId : "None"}) to clipboard!`,
					"systray"
				);
				child
					.spawn("clip")
					.stdin.end(
						util.inspect(data.shipments[0] ? data.shipments[0].trackingId : "None")
					);
				break;
		}
	});

	// If we don't use this, new tray icon will be displayed each N minutes
	setTimeout(() => {
		destroyTray();
	}, 299500);
}

parseTracking().then(() => {
	main();
	setInterval(main, 300000);
});
