import * as child from "child_process";
import { notify } from "node-notifier";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createPromptModule } from "inquirer";
import Logger from "@ptkdev/logger";
import "dotenv/config";
import SysTray from "systray";
import * as luxon from "luxon";
import { LastState, ParcelResponse, Prompt, Tracking } from "./types";
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
let updateInterval = 300000;

if (["", "<key>"].includes(process.env.PARCELSAPP_API_KEY!)) {
	logger.error("Empty or default placeholder token string!", "root");
	logger.error(`Expected API key, received: ${process.env.PARCELSAPP_API_KEY}`);
	throw new Error("Empty token string!");
}

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
async function getTracking(): Promise<Prompt> {
	logger.info("Initializing prompts", "getTracking");
	if (TRACK_NUMBER == "") {
		logger.warning("Tracking number entry is empty. Please enter valid track number.");
	}
	const questions = [
		{
			type: "input",
			name: "TRACK_NUMBER_Q",
			message: `Tracking number [${TRACK_NUMBER == "" ? "None" : TRACK_NUMBER}]`
		},
		{
			type: "input",
			name: "COUNTRY_Q",
			message: `Destination country [${COUNTRY == "" ? "None" : COUNTRY}]`
		},
		{
			type: "input",
			name: "UPDATE_INTERVAL_Q",
			message: "Update interval [Default 300000ms]"
		}
	];

	const prompt = createPromptModule();
	const answer: Prompt = await prompt(questions);

	return answer;
}

// Parsing user input and checking if we got new info from user
async function parseTracking(): Promise<void> {
	logger.info("Parsing answers", "parseTracking");
	const answer = await getTracking();

	const TRACK_NUMBER_Q = answer["TRACK_NUMBER_Q"];
	const COUNTRY_Q = answer["COUNTRY_Q"];
	const UPDATE_INTERVAL_Q = answer["UPDATE_INTERVAL_Q"];

	if ((TRACK_NUMBER_Q.length || COUNTRY_Q.length) > 0) {
		logger.warning(
			"Track number or country length are not equal to 0, overwriting",
			"parseTracking"
		);
		const newTracking: object = {
			TRACK_NUMBER: TRACK_NUMBER_Q ? TRACK_NUMBER_Q : TRACK_NUMBER,
			COUNTRY: COUNTRY_Q ? COUNTRY_Q : COUNTRY
		};

		writeFileSync(join(__dirname, "tracking.json"), JSON.stringify(newTracking), "utf-8");
	}

	if (UPDATE_INTERVAL_Q.toString().length > 0 && UPDATE_INTERVAL_Q >= 30000) {
		updateInterval = UPDATE_INTERVAL_Q;
	} else {
		logger.warning(
			"Got empty or invalid update interval, falling back to default.",
			"parseTracking"
		);
	}
}

// Reading tracking.json
async function readTrackingInfo(): Promise<Tracking> {
	const tracking = JSON.parse(readFileSync(join(__dirname, "tracking.json")).toString());

	const trackingInfoObject: Tracking = {
		apiKey: process.env.PARCELSAPP_API_KEY!,
		trackingUrl: "https://parcelsapp.com/api/v3/shipments/tracking",
		shipments: [
			{
				trackingId: tracking.TRACK_NUMBER,
				language: "en",
				country: tracking.COUNTRY
			}
		]
	};

	return trackingInfoObject;
}

// Reading laststate.json
async function readLastState(): Promise<LastState> {
	const lastState = JSON.parse(
		readFileSync(join(__dirname, "laststate.json")).toString()
	);

	const lastStateObject: LastState = {
		lastPackageState: lastState.lastPackageState
	};

	return lastStateObject;
}

// POST request to ParcelsApp API (which documentation is shit)
async function getData(): Promise<ParcelResponse> {
	const info = await readTrackingInfo();

	const url = info["trackingUrl"];
	const body = {
		apiKey: info["apiKey"],
		shipments: info["shipments"]
	};

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(body)
	});

	let data = await res.json();
	if (data.uuid) {
		logger.warning(
			"Could not retrieve data from ParcelsApp API. This error is fine to see in most cases. Data will be retrieved on next update.",
			"getData"
		);
		data = {
			shipments: [
				{
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
						status: lastPackageState.length == 0 ? "No data" : lastPackageState
					}
				}
			]
		};
	}

	return data;
}

const icon = readFileSync(
	join(__dirname, `./assets/courier.${process.platform == "win32" ? "ico" : "png"}`)
);

// Main loop
async function main(): Promise<void> {
	logger.info("Updating data", "main");
	const data = await getData();
	const lastPackageStateObject = await readLastState();

	// Checking if package state changed
	if (lastPackageStateObject.lastPackageState != data.shipments[0]?.lastState.status) {
		notification("State changed!", data.shipments[0].states[0].status, true);
		logger.warning("State changed!", "main");
		logger.debug(`Previous state: ${lastPackageState}`, "main");
		logger.debug(`New state: ${data.shipments[0].lastState.status}`, "main");

		const newPackageState: LastState = {
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
					title: `RSS: ${Math.round((process.memoryUsage().rss / 1024 / 1024) * 100) / 100} MB / heapTotal: ${Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100} MB / heapUsed: ${Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100} MB`,
					tooltip: "Memory usage",
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
					title:
						(data.shipments[0].states && data.shipments[0].states[0])
							? `--> [ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[0].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[0].location ? ` at ${data.shipments[0].states[0].location} ] ` : " ] "}${data.shipments[0].states[0].status}`
							: "No data",
					tooltip: "-",
					checked: true,
					enabled: (data.shipments[0].states && data.shipments[0].states[0]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[1])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[1].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[1].location ? ` at ${data.shipments[0].states[1].location} ] ` : " ] "}${data.shipments[0].states[1].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[1]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[2])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[2].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[2].location ? ` at ${data.shipments[0].states[2].location} ] ` : " ] "}${data.shipments[0].states[2].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[2]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[3])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[3].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[3].location ? ` at ${data.shipments[0].states[3].location} ] ` : " ] "}${data.shipments[0].states[3].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[3]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[4])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[4].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[4].location ? ` at ${data.shipments[0].states[4].location} ] ` : " ] "}${data.shipments[0].states[4].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[4]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[5])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[5].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[5].location ? ` at ${data.shipments[0].states[5].location} ] ` : " ] "}${data.shipments[0].states[5].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[5]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[6])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[6].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[6].location ? ` at ${data.shipments[0].states[6].location} ] ` : " ] "}${data.shipments[0].states[6].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[6]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[7])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[7].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[7].location ? ` at ${data.shipments[0].states[7].location} ] ` : " ] "}${data.shipments[0].states[7].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[7]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[8])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[8].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[8].location ? ` at ${data.shipments[0].states[8].location} ] ` : " ] "}${data.shipments[0].states[8].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[8]) ? true : false
				},
				{
					title:
						(data.shipments[0].states && data.shipments[0].states[9])
							? `[ ${luxon.DateTime.fromISO(new Date(data.shipments[0].states[9].date).toISOString()).toLocaleString(luxon.DateTime.DATETIME_MED_WITH_WEEKDAY)}${data.shipments[0].states[9].location ? ` at ${data.shipments[0].states[9].location} ] ` : " ] "}${data.shipments[0].states[9].status}`
							: "No data",
					tooltip: "-",
					checked: false,
					enabled: (data.shipments[0].states && data.shipments[0].states[9]) ? true : false
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
					`Copying tracking number (${data.shipments[0].trackingId}) to clipboard!`,
					"systray"
				);
				if (process.platform == "win32") {
					child.spawn("clip").stdin.end(data.shipments[0].trackingId);
				} else {
					for (const path of process.env.PATH!.split(":")) {
						if (existsSync(path + "/xclip")) {
							child.spawn("xclip").stdin.end(data.shipments[0].trackingId);
						} else {
							logger.error("xclip package not found!");
						}
					}
				}
				break;
		}
	});

	// If we don't use this, new tray icon will be displayed each N minutes
	setTimeout(() => {
		try {
			child.execSync(
				`${process.platform == "win32" ? "taskkill /f /im tray_windows_release.exe" : "killall -r tray_linux_release"}`
			);
		} catch (error: unknown) {
			logger.error(error as string);
		}
	}, updateInterval - 500);
}

parseTracking().then(() => {
	logger.info(`Updating data every ${updateInterval} ms`, "cycle");
	main();
	setInterval(main, updateInterval);
});
