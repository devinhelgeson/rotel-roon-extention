"use strict";

require("dotenv").config();
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const RoonApi = require("node-roon-api");
const RoonApiSettings = require("node-roon-api-settings");
const RoonApiStatus = require("node-roon-api-status");
const RoonApiVolumeControl = require("node-roon-api-volume-control");

const SERIAL_PORT = process.env.SERIAL_PORT || "/dev/tty.usbserial";
const VOLUME_MIN = 1;
const VOLUME_MAX = 96;

let roon = new RoonApi({
    extension_id: "com.you.roon.rotel-rs232",
    display_name: "Rotel RA-1570 RS232",
    display_version: "1.0.0",
    publisher: "Your Name",
    email: "you@example.com"
});

let svc_status = new RoonApiStatus(roon);
let svc_volume = new RoonApiVolumeControl(roon);

let serial; 
let volume_control;
let currentVolume = 40;

function init_serial() {
    serial = new SerialPort({
      path: SERIAL_PORT,
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none"
    });

    const parser = serial.pipe(new ReadlineParser({ delimiter: "!" }));

    parser.on("data", data => {
        const cleaned = data.trim(); // `data` comes with trailing `!` removed by parser
        console.log("[ROTEL] Received:", cleaned);
    
        if (cleaned.startsWith("volume=")) {
            const vol = parseInt(cleaned.replace("volume=", ""), 10);
            if (!isNaN(vol)) {
                currentVolume = vol;
                volume_control.update_state({ volume_value: vol });
            }
        }
    });

    serial.on("open", () => {
        console.log("[ROTEL] Serial port open:", SERIAL_PORT);
        svc_status.set_status("Connected to Rotel RA-1570", false);

        volume_control = svc_volume.new_device({
            state: {
                display_name: "Rotel RA-1570",
                volume_type: "number",
                volume_min: VOLUME_MIN,
                volume_max: VOLUME_MAX,
                volume_value: 40,
                volume_step: 1,
                is_muted: false
            },
            set_volume: function (req, mode, value) {
                let newVol = mode === "absolute" ? value : currentVolume + value;
                newVol = Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, newVol));
                console.log("[ROTEL] Set volume to", newVol);
            
                serial.write(`volume_${newVol}!`);
            
                currentVolume = newVol; // <-- update our local tracker
                volume_control.update_state({ volume_value: newVol });
            
                req.send_complete("Success");
            },
            set_mute: (req, mode) => {
                const mute = mode === "on";
                serial.write(mute ? "mute_on!\r" : "mute_off!\r");
                volume_control.update_state({ is_muted: mute });
                req.send_complete("Success");
            }
        });

        // Optional: Query current volume on start
        serial.write("volume=?\r");
    });

    serial.on("error", err => {
        console.error("[ROTEL] Serial error:", err.message);
        svc_status.set_status("Error: " + err.message, true);
    });
}

roon.init_services({
    provided_services: [svc_status, svc_volume]
});

roon.start_discovery();
init_serial();
