import * as child from "child_process";
import { notify } from "node-notifier";
import { readFileSync, writeFileSync } from "fs";
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
		},
		{
			type: "input",
			name: "UPDATE_INTERVAL_Q",
			message: "Enter custom update interval in ms if needed (>=30000). Default is 300000"
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

	if (
		typeof UPDATE_INTERVAL_Q === "number" &&
		UPDATE_INTERVAL_Q.toString().length > 0 &&
		UPDATE_INTERVAL_Q >= 30000
	) {
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

	const data = await res.json();

	return data;
}

const icon = readFileSync(
	join(__dirname, `./assets/courier.${process.platform == "win32" ? "ico" : "png"}`)
);

// Main loop
async function main(): Promise<void> {
	logger.info("Updating data", "main");
	let data = await getData();
	const lastPackageStateObject = await readLastState();

	if (data.uuid) {
		logger.warning(
			"Received parcel UUID instead of response. Re-invoking getData()",
			"main"
		);
		data = await getData();
	}

	// Checking if package state changed
	if (lastPackageStateObject.lastPackageState != data.shipments[0].lastState.status) {
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
					tooltip: "Used heap",
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
						data.shipments[0].states[0].status != "No data"
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
				if (process.platform === "linux")
					return logger.warning(
						"Copying to clipboard is not implemented on Linux.",
						"systray"
					);
				notification(
					"Tracking number",
					"Copied tracking number into clipping board",
					false
				);
				logger.docs(
					`Copying tracking number (${data.shipments[0].trackingId}) to clipboard!`,
					"systray"
				);
				process.platform == "win32"
					? child.spawn("clip").stdin.end(data.shipments[0].trackingId)
					: child.spawn("xclip").stdin.end(data.shipments[0].trackingId);
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
