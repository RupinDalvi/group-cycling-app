// ride.js - Full file with Firebase Group Tracking (Sending & Receiving Locations)

document.addEventListener('DOMContentLoaded', function() {
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 1. SETTINGS, CONSTANTS & DOM ELEMENTS
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    let settings = {};
    const defaultAirDensity = 1.225; // kg/m^3
    const GRAVITY_ACCEL = 9.80665; // m/s^2
    const EARTH_RADIUS_KM = 6371; // For Haversine distance calculation

    // DOM Elements
    const currentSpeedEl = document.getElementById('currentSpeed');
    const currentPowerEl = document.getElementById('currentPower');
    const avgSpeedEl = document.getElementById('avgSpeed');
    const avgPowerEl = document.getElementById('avgPower');
    const distanceEl = document.getElementById('distance');
    const elapsedTimeEl = document.getElementById('elapsedTime');
    const altitudeEl = document.getElementById('altitude');
    const gradientEl = document.getElementById('gradient');
    const cadenceEl = document.getElementById('cadence');
    const gearRatioEl = document.getElementById('gearRatio');
    const currentSettingsTextEl = document.getElementById('currentSettingsText');
    const statusEl = document.getElementById('status');
    const windSpeedDisplayEl = document.getElementById('windSpeedDisplay');
    const windDirectionDisplayEl = document.getElementById('windDirectionDisplay');
    const mapDisplayEl = document.getElementById('mapDisplay'); 

    const connectSpeedCadenceButton = document.getElementById('connectSpeedCadenceButton');
    const bleStatusEl = document.getElementById('bleStatus');
    const bleSpeedEl = document.getElementById('bleSpeed');
    const bleCadenceEl = document.getElementById('bleCadence');
    
    const startRideButton = document.getElementById('startRideButton');
    const pauseSimButton = document.getElementById('pauseSimButton'); 
    const resumeSimButton = document.getElementById('resumeSimButton'); 
    const stopSimButton = document.getElementById('stopSimButton');

    // Group Tracking DOM Elements
    const roomNameInput = document.getElementById('roomName');
    const displayNameInput = document.getElementById('displayName');
    const consentLocationShareCheckbox = document.getElementById('consentLocationShare');
    const joinRoomButton = document.getElementById('joinRoomButton');
    const leaveRoomButton = document.getElementById('leaveRoomButton');
    const groupStatusEl = document.getElementById('groupStatus');


    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 2. RIDE STATE VARIABLES
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    let geolocWatchId = null;
    let isPaused = false;
    let isRunning = false;
    let rideStartTime = 0;
    let activeSegmentStartTime = 0;
    let totalElapsedTimeMs = 0;
    let totalDistanceKm = 0;
    let currentAltitudeM = null;
    let previousAltitudeM = null;
    let currentSpeedKmh = 0;
    let currentCadenceRpm = 0; 
    let powerReadings = [];
    let previousTimestamp = null; 
    let previousLatitude = null;
    let previousLongitude = null;
    let previousSpeedMsForSim = 0; 
    let rideDataLog = [];
    let currentLatitude = null; 
    let currentLongitude = null; 
    let wakeLock = null;
    let failsafeTickInterval = null;
    const STALE_GPS_THRESHOLD_MS = 2500; 
    let lastProcessedDataTimestamp = 0; 
    let currentWindSpeedMs = 0; 
    let currentWindDirectionDegrees = null; 
    let currentBikeBearingDegrees = null;   
    let weatherApiUpdateInterval = null;
    const WEATHER_API_UPDATE_FREQUENCY_MS = 5 * 60 * 1000; 

    let map = null;
    let ridePathPolyline = null;
    let currentPositionMarker = null;
    let mapPathCoordinates = []; 

    let bleDevice = null;
    let cscCharacteristic = null;
    let lastWheelRevolutions = null;
    let lastWheelEventTime = null;  
    let lastCrankRevolutions = null;
    let lastCrankEventTime = null; 
    let sensorSpeedKmh = null; 
    let sensorCadenceRpm = null; 
    let currentGearRatio = null; 

    // Group Tracking State
    let currentRoomName = null;
    let currentUserDisplayName = null;
    let currentUserId = null; 
    let sendLocationToGroupInterval = null;
    const GROUP_LOCATION_SEND_INTERVAL_MS = 10000; // Send location every 10 seconds
    let groupMembersListener = null; // To store the Firestore listener unsubscribe function
    let groupMembers = {}; // Stores { userId: {displayName, lat, lon, marker, lastSeen} }

    // Firebase services (initialized in HTML via SDK)
    const auth = firebase.auth();
    const db = firebase.firestore();

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 3. LOAD SETTINGS
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function loadRideSettings() {
        const savedSettingsString = localStorage.getItem('cyclingAppSettings');
        if (savedSettingsString) {
            settings = JSON.parse(savedSettingsString);
            if (settings.airDensity === null || settings.airDensity === undefined || settings.airDensity === '') {
                settings.airDensity = defaultAirDensity;
            }
            if (typeof settings.defaultCadence !== 'number') {
                settings.defaultCadence = 80; 
            }
            if (settings.wheelCircumference) {
                 settings.wheelCircumferenceM = settings.wheelCircumference / 1000;
            } else {
                settings.wheelCircumferenceM = 2.105; 
                console.warn("Wheel circumference not found in settings, using default:", settings.wheelCircumferenceM, "m for BLE/Gear Ratio.");
            }
        } else {
            alert("Settings not found. Please configure on the main page. Using defaults.");
            settings = {
                systemMass: 75, wheelCircumference: 2105, crr: 0.005,
                cda: 0.320, airDensity: defaultAirDensity, defaultCadence: 80,
                wheelCircumferenceM: 2.105 
            };
        }
        currentSettingsTextEl.textContent = JSON.stringify(settings, null, 2);
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 4. UTILITY FUNCTIONS 
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function formatElapsedTime(ms) {
        let totalSeconds = Math.floor(ms / 1000);
        let hours = Math.floor(totalSeconds / 3600);
        totalSeconds %= 3600;
        let minutes = Math.floor(totalSeconds / 60);
        let seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function haversineDistance(lat1, lon1, lat2, lon2) {
        function toRad(x) { return x * Math.PI / 180; }
        const R = EARTH_RADIUS_KM;
        if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return 0;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const radLat1 = toRad(lat1);
        const radLat2 = toRad(lat2);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(radLat1) * Math.cos(radLat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function toDegrees(radians) {
        return radians * 180 / Math.PI;
    }
    function toRadians(degrees) {
        return degrees * Math.PI / 180;
    }

    function calculateBearing(lat1, lon1, lat2, lon2) {
        if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
        const φ1 = toRadians(lat1);
        const φ2 = toRadians(lat2);
        const Δλ = toRadians(lon2 - lon1);
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        const θ = Math.atan2(y, x);
        return (toDegrees(θ) + 360) % 360;
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 5. WEATHER API FUNCTION
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    async function fetchAndUpdateWeatherData(latitude, longitude) {
        if (latitude === null || longitude === null) {
            console.log("Cannot fetch weather data: Lat/Lon is null.");
            if (windSpeedDisplayEl) windSpeedDisplayEl.textContent = "N/A";
            if (windDirectionDisplayEl) windDirectionDisplayEl.textContent = "N/A";
            return;
        }
        const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(2)}&longitude=${longitude.toFixed(2)}&current=wind_speed_10m,wind_direction_10m&forecast_days=1`;
        console.log("Fetching weather data from:", apiUrl);
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data.current && data.current.wind_speed_10m !== undefined && data.current.wind_direction_10m !== undefined) {
                const windSpeedKmh = data.current.wind_speed_10m;
                currentWindSpeedMs = windSpeedKmh / 3.6; 
                currentWindDirectionDegrees = data.current.wind_direction_10m; 
                console.log(`Updated Wind: ${currentWindSpeedMs.toFixed(2)} m/s from ${currentWindDirectionDegrees}°`);
                if (windSpeedDisplayEl) windSpeedDisplayEl.textContent = windSpeedKmh.toFixed(1);
                if (windDirectionDisplayEl) windDirectionDisplayEl.textContent = `${currentWindDirectionDegrees}°`;
            } else {
                console.warn("Wind data not found in API response:", data);
                if (windSpeedDisplayEl) windSpeedDisplayEl.textContent = "Error";
            }
        } catch (error) {
            console.error("Error fetching weather data:", error);
            if (windSpeedDisplayEl) windSpeedDisplayEl.textContent = "Error";
        }
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 6. POWER CALCULATION FUNCTIONS
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function calculateRollingResistancePower(currentSpeedMs, massKg, crr, gradientDecimal) {
        if (currentSpeedMs < 0.1) return 0;
        const cosTheta = 1 / Math.sqrt(1 + gradientDecimal * gradientDecimal);
        const normalForce = massKg * GRAVITY_ACCEL * cosTheta;
        return crr * normalForce * currentSpeedMs;
    }

    function calculateAerodynamicPower(
        bikeSpeedMs, bikeBearingDegrees, 
        windSpeedMs, windDirectionDegrees, 
        cdaM2, airDensityKgm3
    ) {
        if (bikeSpeedMs < 0.01 && (windSpeedMs === null || windSpeedMs < 0.1)) { return 0; }
        if (bikeBearingDegrees === null || windDirectionDegrees === null || windSpeedMs === null || windSpeedMs < 0.01) {
            return 0.5 * airDensityKgm3 * cdaM2 * Math.pow(bikeSpeedMs, 3);
        }
        const bikeBearingRad = toRadians(bikeBearingDegrees);
        const v_bike_x = bikeSpeedMs * Math.sin(bikeBearingRad); 
        const v_bike_y = bikeSpeedMs * Math.cos(bikeBearingRad); 
        const windBlowsToRad = toRadians((windDirectionDegrees + 180) % 360);
        const v_wind_x = windSpeedMs * Math.sin(windBlowsToRad);
        const v_wind_y = windSpeedMs * Math.cos(windBlowsToRad);
        const v_app_x = v_bike_x - v_wind_x;
        const v_app_y = v_bike_y - v_wind_y;
        const v_app_magnitude = Math.sqrt(v_app_x * v_app_x + v_app_y * v_app_y);
        if (v_app_magnitude < 0.01) return 0;
        const dot_product_app_bike = v_app_x * v_bike_x + v_app_y * v_bike_y;
        let pAero = 0.5 * airDensityKgm3 * cdaM2 * v_app_magnitude * dot_product_app_bike;
        return pAero;
    }

    function calculateGravityPowerDirect(massKg, verticalChangeM, timeDeltaS) {
        if (timeDeltaS <= 0) return 0;
        const verticalSpeedMs = verticalChangeM / timeDeltaS;
        return massKg * GRAVITY_ACCEL * verticalSpeedMs;
    }

    function calculateKineticPower(massKg, currentSpeedMs, previousSpeedMs, timeDeltaS) {
        if (timeDeltaS <= 0) return 0;
        const kineticEnergyChange = 0.5 * massKg * (Math.pow(currentSpeedMs, 2) - Math.pow(previousSpeedMs, 2));
        return kineticEnergyChange / timeDeltaS;
    }

    function calculateTotalPower(data) {
        const speedMs = data.speedKmh / 3.6;
        const prevSpeedMs = data.previousSpeedKmh / 3.6; 
        const timeDeltaS = data.timeDeltaS;
        const currentAlt = data.altitudeM !== null ? data.altitudeM : (data.previousAltitudeM || 0);
        const prevAlt = data.previousAltitudeM !== null ? data.previousAltitudeM : currentAlt;
        const altitudeChangeM = currentAlt - prevAlt;
        const avgSpeedMsForTickHorizontal = (speedMs + prevSpeedMs) / 2;
        let distanceHorizontalM = avgSpeedMsForTickHorizontal * timeDeltaS;
        let gradientDecimal = 0;
        if (Math.abs(distanceHorizontalM) > 0.01 && timeDeltaS > 0) {
            gradientDecimal = altitudeChangeM / distanceHorizontalM;
        } else if (Math.abs(altitudeChangeM) > 0.001 && timeDeltaS > 0) { 
            gradientDecimal = altitudeChangeM > 0 ? 0.30 : -0.30; 
        }
        gradientDecimal = Math.max(-0.30, Math.min(0.30, gradientDecimal));
        data.gradientPercent = gradientDecimal * 100;
        let pRolling = calculateRollingResistancePower(speedMs, settings.systemMass, settings.crr, gradientDecimal);
        let pAero = calculateAerodynamicPower(
            speedMs, data.bikeBearingDegrees, data.windSpeedMs, data.windDirectionDegrees,
            settings.cda, settings.airDensity
        );
        let pGravity = calculateGravityPowerDirect(settings.systemMass, altitudeChangeM, timeDeltaS);
        let pKinetic = calculateKineticPower(settings.systemMass, speedMs, prevSpeedMs, timeDeltaS);
        let systemPower = pRolling + pAero + pGravity + pKinetic;
        let riderPowerOutput = systemPower;
        if (data.cadenceRpm === 0) riderPowerOutput = 0; 
        else if (riderPowerOutput < 0) riderPowerOutput = 0;
        return riderPowerOutput;
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 7. WEB BLUETOOTH FUNCTIONS
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    const CSC_SERVICE_UUID = 'cycling_speed_and_cadence';
    const CSC_MEASUREMENT_UUID = 'csc_measurement';
    async function connectSpeedCadenceDevice() {
        if (!navigator.bluetooth) {
            bleStatusEl.textContent = "Web Bluetooth not supported.";
            console.error("Web Bluetooth API not available.");
            return;
        }
        try {
            bleStatusEl.textContent = "Requesting device...";
            console.log("Requesting Bluetooth device with CSC service...");
            bleDevice = await navigator.bluetooth.requestDevice({
                filters: [{ services: [CSC_SERVICE_UUID] }],
            });
            bleStatusEl.textContent = `Connecting to ${bleDevice.name || bleDevice.id}...`;
            console.log("Connecting to GATT Server...");
            const server = await bleDevice.gatt.connect();
            bleStatusEl.textContent = "Getting CSC Service...";
            const service = await server.getPrimaryService(CSC_SERVICE_UUID);
            bleStatusEl.textContent = "Getting CSC Characteristic...";
            cscCharacteristic = await service.getCharacteristic(CSC_MEASUREMENT_UUID);
            bleStatusEl.textContent = "Starting notifications...";
            await cscCharacteristic.startNotifications();
            cscCharacteristic.addEventListener('characteristicvaluechanged', handleCSCMeasurement);
            bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
            bleStatusEl.textContent = `Connected: ${bleDevice.name || bleDevice.id}`;
            console.log("Device connected and notifications started.");
        } catch (error) {
            bleStatusEl.textContent = `BLE Error: ${error.name}`;
            console.error("Bluetooth Connection Error:", error);
            if (bleDevice && bleDevice.gatt.connected) {
                bleDevice.gatt.disconnect(); 
            }
            bleDevice = null; cscCharacteristic = null;
        }
    }

    function onDisconnected() {
        bleStatusEl.textContent = "Device disconnected.";
        console.log("Bluetooth device disconnected.");
        if (cscCharacteristic) {
            try { cscCharacteristic.removeEventListener('characteristicvaluechanged', handleCSCMeasurement); }
            catch (e) { console.warn("Could not remove BLE listener on disconnect:", e); }
        }
        bleDevice = null; cscCharacteristic = null;
        sensorSpeedKmh = null; sensorCadenceRpm = null;
        lastWheelRevolutions = null; lastWheelEventTime = null;
        lastCrankRevolutions = null; lastCrankEventTime = null;
        if (bleSpeedEl) bleSpeedEl.textContent = "N/A";
        if (bleCadenceEl) bleCadenceEl.textContent = "N/A";
    }

    function handleCSCMeasurement(event) {
        const value = event.target.value; 
        const flags = value.getUint8(0);
        let index = 1;
        const wheelRevsPresent = (flags & 0x01) > 0;
        const crankRevsPresent = (flags & 0x02) > 0;

        if (wheelRevsPresent) {
            const currentWheelRevolutions = value.getUint32(index, true);
            index += 4;
            const currentWheelEventTime = value.getUint16(index, true) / 1024; 
            index += 2;
            if (lastWheelRevolutions !== null && lastWheelEventTime !== null && settings.wheelCircumferenceM) {
                let timeDelta = currentWheelEventTime - lastWheelEventTime;
                if (timeDelta < 0) timeDelta += (65536 / 1024); 
                if (timeDelta > 0.001) { 
                    let revsDelta = currentWheelRevolutions - lastWheelRevolutions;
                    if (revsDelta < 0) revsDelta += 0xFFFFFFFF + 1; 
                    if (revsDelta >= 0) {
                        const distanceMeters = revsDelta * settings.wheelCircumferenceM;
                        const speedMs = distanceMeters / timeDelta;
                        sensorSpeedKmh = speedMs * 3.6;
                        if (bleSpeedEl) bleSpeedEl.textContent = sensorSpeedKmh.toFixed(1);
                    }
                }
            }
            lastWheelRevolutions = currentWheelRevolutions;
            lastWheelEventTime = currentWheelEventTime;
        }

        if (crankRevsPresent) {
            const currentCrankRevolutions = value.getUint16(index, true);
            index += 2;
            const currentCrankEventTime = value.getUint16(index, true) / 1024; 
            if (lastCrankRevolutions !== null && lastCrankEventTime !== null) {
                let timeDelta = currentCrankEventTime - lastCrankEventTime;
                if (timeDelta < 0) timeDelta += (65536 / 1024);
                if (timeDelta > 0.001) { 
                    let crankRevsDelta = currentCrankRevolutions - lastCrankRevolutions;
                    if (crankRevsDelta < 0) crankRevsDelta += 65536;
                    if (crankRevsDelta >= 0) {
                        sensorCadenceRpm = (crankRevsDelta / timeDelta) * 60; 
                        if (bleCadenceEl) bleCadenceEl.textContent = Math.round(sensorCadenceRpm);
                    }
                }
            }
            lastCrankRevolutions = currentCrankRevolutions;
            lastCrankEventTime = currentCrankEventTime;
        }
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 8. MAP FUNCTIONS
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function initializeMap(lat, lon) {
        if (map) { 
            map.setView([lat, lon], map.getZoom() || 15);
            return;
        }
        const initialLat = lat || 51.0447; 
        const initialLng = lon || -114.0719; 
        if(mapDisplayEl) mapDisplayEl.textContent = ''; 
        else { console.error("mapDisplay element not found!"); return; }
        map = L.map('mapDisplay').setView([initialLat, initialLng], 13); 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        mapPathCoordinates = []; 
        ridePathPolyline = L.polyline(mapPathCoordinates, {color: 'blue', weight: 3}).addTo(map);
        console.log("Map initialized.");
    }

    function updateMap(lat, lon) {
        if (!map && (lat !== null && lon !== null)) { 
            initializeMap(lat,lon); 
        }
        if (lat === null || lon === null || !map) return; 
        const newLatLng = [lat, lon];
        mapPathCoordinates.push(newLatLng);
        if (ridePathPolyline) {
            ridePathPolyline.setLatLngs(mapPathCoordinates);
        } else { 
            ridePathPolyline = L.polyline(mapPathCoordinates, {color: 'blue', weight: 3}).addTo(map);
        }
        if (currentPositionMarker) {
            currentPositionMarker.setLatLng(newLatLng);
        } else {
            currentPositionMarker = L.marker(newLatLng).addTo(map); 
        }
        map.panTo(newLatLng); 
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 9. GPS POSITION PROCESSING & DATA UPDATE
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function processPositionUpdate(position) {
        if (isPaused && isRunning) return; 
        if (!isRunning) return; 

        const currentEventTimestamp = position.timestamp || performance.now();
        lastProcessedDataTimestamp = performance.now();

        let timeDeltaS = 0;
        if (previousTimestamp !== null) {
            timeDeltaS = (currentEventTimestamp - previousTimestamp) / 1000;
        }
        
        if (timeDeltaS < 0.05 && previousTimestamp !== null && !position.synthetic) { 
             if (currentLatitude === position.coords.latitude && currentLongitude === position.coords.longitude && 
                 currentAltitudeM === position.coords.altitude &&
                 (position.coords.speed !== null ? (position.coords.speed * 3.6) : 0) === currentSpeedKmh ) {
                previousTimestamp = currentEventTimestamp; 
                return; 
            }
        }
        if (timeDeltaS <= 0 && !position.synthetic) { timeDeltaS = 0.05; }
        if (position.synthetic && timeDeltaS <=0) { timeDeltaS = 1.0; }
        
        if (timeDeltaS > 0) { totalElapsedTimeMs += (timeDeltaS * 1000); }
        previousTimestamp = currentEventTimestamp; 

        const newLatitude = position.synthetic ? currentLatitude : position.coords.latitude;
        const newLongitude = position.synthetic ? currentLongitude : position.coords.longitude;
        const newAltitude = position.synthetic ? currentAltitudeM : position.coords.altitude;

        if (newLatitude !== null && newLongitude !== null) {
            updateMap(newLatitude, newLongitude);
        }
        
        if (currentLatitude !== null && currentLongitude !== null && 
            newLatitude !== null && newLongitude !== null &&
            (newLatitude !== currentLatitude || newLongitude !== currentLongitude)) {
            currentBikeBearingDegrees = calculateBearing(currentLatitude, currentLongitude, newLatitude, newLongitude);
        }
        
        if (newLatitude !== null) currentLatitude = newLatitude;
        if (newLongitude !== null) currentLongitude = newLongitude;
        
        if (previousAltitudeM === null && newAltitude !== null) { previousAltitudeM = newAltitude; }
        currentAltitudeM = newAltitude !== null ? newAltitude : (currentAltitudeM !== null ? currentAltitudeM : 100);
        
        let gpsSpeedMs = position.coords && position.coords.speed !== null ? position.coords.speed : 0;
        if (position.synthetic) gpsSpeedMs = 0;

        if (sensorSpeedKmh !== null && bleDevice && bleDevice.gatt.connected) {
            currentSpeedKmh = sensorSpeedKmh;
        } else {
            currentSpeedKmh = gpsSpeedMs * 3.6;
        }
        currentSpeedKmh = Math.max(0, currentSpeedKmh);

        if (sensorCadenceRpm !== null && bleDevice && bleDevice.gatt.connected) {
            currentCadenceRpm = sensorCadenceRpm;
        } else {
            currentCadenceRpm = (currentSpeedKmh > 1) ? (settings.defaultCadence || 80) : 0;
        }
        currentCadenceRpm = Math.max(0, Math.round(currentCadenceRpm));

        if (currentCadenceRpm > 5 && currentSpeedKmh > 0.1 && settings.wheelCircumferenceM > 0) {
            const speedMs = currentSpeedKmh / 3.6;
            const wheelRevolutionsPerSecond = speedMs / settings.wheelCircumferenceM;
            const wheelRPM = wheelRevolutionsPerSecond * 60;
            const crankRPM = currentCadenceRpm;
            if (crankRPM > 0) { currentGearRatio = wheelRPM / crankRPM; } 
            else { currentGearRatio = null; }
        } else { currentGearRatio = null; }

        let distanceThisTickKm = 0;
        if (timeDeltaS > 0) {
            distanceThisTickKm = (currentSpeedKmh / 3600) * timeDeltaS;
            totalDistanceKm += distanceThisTickKm;
        }

        if(currentLatitude !== null) previousLatitude = currentLatitude;
        if(currentLongitude !== null) previousLongitude = currentLongitude;

        const powerData = {
            speedKmh: currentSpeedKmh,
            previousSpeedKmh: previousSpeedMsForSim * 3.6,
            altitudeM: currentAltitudeM,
            previousAltitudeM: previousAltitudeM !== null ? previousAltitudeM : currentAltitudeM,
            cadenceRpm: currentCadenceRpm,
            timeDeltaS: timeDeltaS > 0 ? timeDeltaS : 1.0, 
            gradientPercent: 0,
            bikeBearingDegrees: currentBikeBearingDegrees,
            windSpeedMs: currentWindSpeedMs,
            windDirectionDegrees: currentWindDirectionDegrees 
        };
        const currentPowerW = calculateTotalPower(powerData);
        
        previousSpeedMsForSim = currentSpeedKmh / 3.6; 
        if (newAltitude !== null && !position.synthetic) { previousAltitudeM = newAltitude; } 
        else if (position.synthetic) { previousAltitudeM = currentAltitudeM; }

        if (isRunning && !isPaused) { powerReadings.push(currentPowerW); }
        
        updateDisplay(currentPowerW, powerData.gradientPercent);

        rideDataLog.push({
            timestamp: Math.floor(totalElapsedTimeMs / 1000),
            abs_timestamp_gps: position.timestamp || null,
            velocity: currentSpeedKmh.toFixed(1),
            power: Math.round(currentPowerW),
            x_longitude: currentLongitude !== null ? currentLongitude.toFixed(5) : "N/A",
            y_latitude: currentLatitude !== null ? currentLatitude.toFixed(5) : "N/A",
            z_altitude: currentAltitudeM !== null ? currentAltitudeM.toFixed(1) : "N/A",
            gradient: powerData.gradientPercent === undefined ? "N/A" : powerData.gradientPercent.toFixed(1),
            cadence: currentCadenceRpm,
            gps_accuracy: position.coords && position.coords.accuracy !== null ? position.coords.accuracy.toFixed(1) : "N/A",
            synthetic: !!position.synthetic,
            bike_bearing: currentBikeBearingDegrees !== null ? currentBikeBearingDegrees.toFixed(1) : "N/A",
            wind_speed_ms: currentWindSpeedMs !== null ? currentWindSpeedMs.toFixed(2) : "N/A",
            wind_direction_deg: currentWindDirectionDegrees !== null ? currentWindDirectionDegrees : "N/A",
            sensor_speed_kmh: (sensorSpeedKmh !== null && bleDevice && bleDevice.gatt.connected) ? sensorSpeedKmh.toFixed(1) : "N/A",
            sensor_cadence_rpm: (sensorCadenceRpm !== null && bleDevice && bleDevice.gatt.connected) ? Math.round(sensorCadenceRpm) : "N/A",
            gear_ratio: currentGearRatio !== null ? currentGearRatio.toFixed(2) : "N/A"
        });
    }

    function handleLocationError(error) {
        let message = "GPS Error: ";
        switch(error.code) {
            case error.PERMISSION_DENIED: message += "User denied Geolocation."; break;
            case error.POSITION_UNAVAILABLE: message += "Location unavailable."; break;
            case error.TIMEOUT: message += "Location request timed out."; break;
            default: message += "An unknown error occurred."; break;
        }
        statusEl.textContent = message;
        console.error(message, error);
        if (isRunning) stopRide();
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 10. DISPLAY UPDATE
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function updateDisplay(currentP, currentGrad) {
        currentSpeedEl.textContent = currentSpeedKmh.toFixed(1);
        currentPowerEl.textContent = Math.round(currentP);
        distanceEl.textContent = totalDistanceKm.toFixed(2);
        elapsedTimeEl.textContent = formatElapsedTime(totalElapsedTimeMs);
        altitudeEl.textContent = currentAltitudeM !== null ? Math.round(currentAltitudeM) : "N/A";
        gradientEl.textContent = currentGrad === undefined || currentGrad === null ? "N/A" : currentGrad.toFixed(1);
        cadenceEl.textContent = Math.round(currentCadenceRpm);

        if (windSpeedDisplayEl) {
            windSpeedDisplayEl.textContent = currentWindSpeedMs !== null ? (currentWindSpeedMs * 3.6).toFixed(1) : "N/A";
        }
        if (windDirectionDisplayEl) {
            windDirectionDisplayEl.textContent = currentWindDirectionDegrees !== null ? `${currentWindDirectionDegrees}°` : "N/A";
        }
        if (gearRatioEl) {
            gearRatioEl.textContent = currentGearRatio !== null ? currentGearRatio.toFixed(2) : "N/A";
        }
        if (bleSpeedEl) bleSpeedEl.textContent = (sensorSpeedKmh !== null && bleDevice && bleDevice.gatt.connected) ? sensorSpeedKmh.toFixed(1) : "N/A";
        if (bleCadenceEl) bleCadenceEl.textContent = (sensorCadenceRpm !== null && bleDevice && bleDevice.gatt.connected) ? Math.round(sensorCadenceRpm) : "N/A";

        if (totalElapsedTimeMs > 0) {
            const avgSpeedKmh = totalDistanceKm / (totalElapsedTimeMs / (1000 * 3600));
            avgSpeedEl.textContent = isNaN(avgSpeedKmh) ? "0.0" : avgSpeedKmh.toFixed(1);
            if (powerReadings.length > 0) {
                 const sumPower = powerReadings.reduce((acc, val) => acc + val, 0);
                 avgPowerEl.textContent = Math.round(sumPower / powerReadings.length);
            } else { avgPowerEl.textContent = "0"; }
        } else {
            avgSpeedEl.textContent = "0.0";
            avgPowerEl.textContent = "0";
        }
    }
    
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 11. SCREEN WAKE LOCK & PAGE VISIBILITY API
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    async function requestWakeLock() {
        if (!('wakeLock' in navigator)) { console.log('WakeLock API not supported.'); return; }
        if (wakeLock && wakeLock.released === false) { console.log('WakeLock already active.'); return; }
        let newSentinel = null;
        try {
            newSentinel = await navigator.wakeLock.request('screen');
            if (newSentinel && typeof newSentinel.addEventListener === 'function') {
                newSentinel.addEventListener('release', () => {
                    console.log('A WakeLock sentinel was released (event).');
                    if (wakeLock === newSentinel) { wakeLock = null; }
                });
                wakeLock = newSentinel; console.log('Screen Wake Lock acquired.');
            } else {
                console.warn('navigator.wakeLock.request did not return a valid sentinel object.');
                wakeLock = null;
            }
        } catch (err) {
            console.error(`Wake Lock request failed: ${err.name} - ${err.message}`);
            wakeLock = null;
        }
    }

    function releaseWakeLock() {
        const currentActiveLock = wakeLock;
        wakeLock = null; 
        if (currentActiveLock && typeof currentActiveLock.release === 'function' && 
            (typeof currentActiveLock.released === 'boolean' && !currentActiveLock.released)) {
            currentActiveLock.release()
                .then(() => { console.log('Wake Lock released successfully via function call.'); })
                .catch((err) => { console.error(`Error during manual Wake Lock release: ${err.name} - ${err.message}`); });
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (isRunning && !isPaused) { 
            if (document.visibilityState === 'visible') {
                console.log("Tab became visible, requesting wake lock.");
                requestWakeLock(); 
            } else {
                console.log("Tab became hidden, ensuring wake lock is released.");
                releaseWakeLock();
            }
        }
    });

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 12. FAILSAFE TICKER
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function ensurePeriodicUpdate() {
        if (!isRunning || isPaused) { return; }
        const now = performance.now();
        if ((now - lastProcessedDataTimestamp) > STALE_GPS_THRESHOLD_MS) {
            console.log("Failsafe: GPS stale or stationary, generating synthetic tick.");
            const syntheticPosition = {
                coords: {
                    latitude: currentLatitude, longitude: currentLongitude,
                    altitude: currentAltitudeM, speed: 0, accuracy: null                
                },
                timestamp: now, synthetic: true 
            };
            processPositionUpdate(syntheticPosition); 
        }
    }
    
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 13. POST-RIDE ELEVATION CORRECTION & RECALCULATION
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    async function fetchCorrectedElevations(logData) {
        if (!logData || logData.length === 0) return null;
        const validPoints = logData.filter(p => p.y_latitude !== "N/A" && p.x_longitude !== "N/A");
        if (validPoints.length === 0) {
            console.warn("No valid coordinates for elevation correction."); return null;
        }
        const latitudes = validPoints.map(p => p.y_latitude);
        const longitudes = validPoints.map(p => p.x_longitude);
        const MAX_POINTS_PER_BATCH = 200; 
        let correctedElevations = [];
        if(statusEl) statusEl.textContent = "Correcting elevation data (0%)...";
        for (let i = 0; i < latitudes.length; i += MAX_POINTS_PER_BATCH) {
            const latBatch = latitudes.slice(i, i + MAX_POINTS_PER_BATCH);
            const lonBatch = longitudes.slice(i, i + MAX_POINTS_PER_BATCH);
            const latString = latBatch.join(',');
            const lonString = lonBatch.join(',');
            const apiUrl = `https://api.open-meteo.com/v1/elevation?latitude=${latString}&longitude=${lonString}`;
            console.log(`Fetching corrected elevations batch ${Math.floor(i/MAX_POINTS_PER_BATCH) + 1}...`);
            try {
                const response = await fetch(apiUrl);
                if (!response.ok) throw new Error(`Elevation API HTTP error! status: ${response.status}`);
                const data = await response.json();
                if (data.elevation && data.elevation.length === latBatch.length) {
                    correctedElevations = correctedElevations.concat(data.elevation);
                    const progress = Math.min(100, Math.round((correctedElevations.length / latitudes.length) * 100));
                    if(statusEl) statusEl.textContent = `Correcting elevation data (${progress}%)...`;
                } else { throw new Error("Elevation API response mismatched or missing data."); }
            } catch (error) {
                console.error("Error fetching corrected elevations batch:", error);
                if(statusEl) statusEl.textContent = "Error correcting elevation data. Using GPS altitude.";
                return null;
            }
        }
        const correctedLog = JSON.parse(JSON.stringify(logData));
        let elevationApiIndex = 0;
        for (let i = 0; i < correctedLog.length; i++) {
            if (correctedLog[i].y_latitude !== "N/A" && correctedLog[i].x_longitude !== "N/A") {
                if (elevationApiIndex < correctedElevations.length) {
                    correctedLog[i].z_altitude_corrected = parseFloat(correctedElevations[elevationApiIndex]).toFixed(1);
                    correctedLog[i].altitude_source = "API";
                    elevationApiIndex++;
                } else {
                     correctedLog[i].altitude_source = "GPS (API data short)";
                     correctedLog[i].z_altitude_corrected = correctedLog[i].z_altitude;
                }
            } else {
                correctedLog[i].altitude_source = "GPS (Invalid Coords)";
                correctedLog[i].z_altitude_corrected = correctedLog[i].z_altitude;
            }
        }
        if(statusEl) statusEl.textContent = "Elevation data corrected.";
        return correctedLog;
    }

    function recalculateMetricsWithCorrectedElevation(logDataWithCorrectedAlt) {
        if (!logDataWithCorrectedAlt) return { recalculatedLog: null, summary: null };
        console.log("Recalculating metrics with corrected elevation...");
        if(statusEl) statusEl.textContent = "Recalculating power...";
        let recalculatedLog = JSON.parse(JSON.stringify(logDataWithCorrectedAlt));
        let newPowerReadings = [];
        let totalAscentM = 0;
        let totalDescentM = 0;
        let prevCorrectedAlt = null;

        for (let i = 0; i < recalculatedLog.length; i++) {
            const currentPoint = recalculatedLog[i];
            const currentAlt = parseFloat(currentPoint.z_altitude_corrected || currentPoint.z_altitude);
            let timeDeltaS = 1.0; 
            if (i > 0) {
                const prevPoint = recalculatedLog[i-1];
                prevCorrectedAlt = parseFloat(prevPoint.z_altitude_corrected || prevPoint.z_altitude);
                if (currentPoint.timestamp > prevPoint.timestamp) {
                    timeDeltaS = currentPoint.timestamp - prevPoint.timestamp;
                } else if (currentPoint.timestamp === prevPoint.timestamp && timeDeltaS === 0 && i > 0){
                     timeDeltaS = 0.1; 
                }
            } else {
                prevCorrectedAlt = currentAlt;
            }
            const altitudeChangeM = currentAlt - prevCorrectedAlt;
            if (i > 0) { 
                 if (altitudeChangeM > 0) totalAscentM += altitudeChangeM;
                 else totalDescentM += Math.abs(altitudeChangeM);
            }
            const speedKmh = parseFloat(currentPoint.velocity);
            const speedMs = speedKmh / 3.6;
            const prevSpeedKmh = (i > 0) ? parseFloat(recalculatedLog[i-1].velocity) : speedKmh;
            const prevSpeedMs = prevSpeedKmh / 3.6;
            const avgSpeedMsForTickHorizontal = (speedMs + prevSpeedMs) / 2;
            let distanceHorizontalM = avgSpeedMsForTickHorizontal * timeDeltaS;
            let gradientDecimal = 0;
            if (Math.abs(distanceHorizontalM) > 0.01 && timeDeltaS > 0) {
                gradientDecimal = altitudeChangeM / distanceHorizontalM;
            } else if (Math.abs(altitudeChangeM) > 0.001 && timeDeltaS > 0) {
                gradientDecimal = altitudeChangeM > 0 ? 0.30 : -0.30;
            }
            gradientDecimal = Math.max(-0.30, Math.min(0.30, gradientDecimal));
            currentPoint.gradient_corrected = (gradientDecimal * 100).toFixed(1);

            const powerData = {
                speedKmh: speedKmh, previousSpeedKmh: prevSpeedKmh,
                altitudeM: currentAlt, previousAltitudeM: prevCorrectedAlt,
                cadenceRpm: parseInt(currentPoint.cadence), timeDeltaS: timeDeltaS > 0 ? timeDeltaS : 1.0,
                gradientPercent: parseFloat(currentPoint.gradient_corrected),
                bikeBearingDegrees: currentPoint.bike_bearing !== "N/A" ? parseFloat(currentPoint.bike_bearing) : null,
                windSpeedMs: currentPoint.wind_speed_ms !== "N/A" ? parseFloat(currentPoint.wind_speed_ms) : 0,
                windDirectionDegrees: currentPoint.wind_direction_deg !== "N/A" ? parseFloat(currentPoint.wind_direction_deg) : null
            };
            
            let pRolling = calculateRollingResistancePower(speedMs, settings.systemMass, settings.crr, gradientDecimal);
            let pAero = calculateAerodynamicPower(
                speedMs, powerData.bikeBearingDegrees, powerData.windSpeedMs, powerData.windDirectionDegrees,
                settings.cda, settings.airDensity
            );
            let pGravity = calculateGravityPowerDirect(settings.systemMass, altitudeChangeM, timeDeltaS);
            let pKinetic = calculateKineticPower(settings.systemMass, speedMs, prevSpeedMs, timeDeltaS);
            let systemPower = pRolling + pAero + pGravity + pKinetic;
            let riderPowerOutput = systemPower;
            if (powerData.cadenceRpm === 0) riderPowerOutput = 0;
            else if (riderPowerOutput < 0) riderPowerOutput = 0;
            currentPoint.power_corrected = Math.round(riderPowerOutput);
            newPowerReadings.push(riderPowerOutput);
        }
        const newAvgPower = newPowerReadings.length > 0 ? Math.round(newPowerReadings.reduce((a, b) => a + b, 0) / newPowerReadings.length) : 0;
        if(statusEl) statusEl.textContent = "Recalculation complete.";
        return { 
            recalculatedLog: recalculatedLog, 
            summary: { 
                totalAscentM: totalAscentM.toFixed(1), totalDescentM: totalDescentM.toFixed(1),
                avgPowerCorrected: newAvgPower
            }
        };
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 14. GROUP RIDE TRACKING FUNCTIONS (Firebase)
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    async function signInAnonymouslyIfNeeded() {
        if (!auth) { console.error("Firebase auth is not initialized."); if(statusEl) statusEl.textContent = "Error: Firebase not ready."; return; }
        if (!auth.currentUser) {
            try {
                if(statusEl) statusEl.textContent = "Signing in anonymously...";
                const userCredential = await auth.signInAnonymously();
                currentUserId = userCredential.user.uid;
                console.log("Signed in anonymously. User ID:", currentUserId);
                if(statusEl) statusEl.textContent = "Anonymous sign-in successful.";
            } catch (error) {
                console.error("Error signing in anonymously:", error);
                if(statusEl) statusEl.textContent = "Error: Could not sign in for group features.";
                throw error; 
            }
        } else {
            currentUserId = auth.currentUser.uid;
            console.log("Already signed in. User ID:", currentUserId);
        }
    }

    async function joinGroupRideRoom() {
        const roomName = roomNameInput.value.trim();
        const displayName = displayNameInput.value.trim();

        if (!roomName) { alert("Please enter a Room Name."); return; }
        if (!displayName) { alert("Please enter Your Display Name."); return; }
        if (!consentLocationShareCheckbox.checked) {
            alert("You must consent to location sharing to join a group room.");
            return;
        }

        try {
            await signInAnonymouslyIfNeeded(); 
            if (!currentUserId) {
                if(groupStatusEl) groupStatusEl.textContent = "Failed to get user ID for room.";
                return;
            }

            currentRoomName = roomName;
            currentUserDisplayName = displayName;

            const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('rooms').doc(currentRoomName).collection('members').doc(currentUserId).set({
                displayName: currentUserDisplayName,
                joinedAt: serverTimestamp,
                lastSeen: serverTimestamp,
                location: null 
            }, { merge: true });

            if(groupStatusEl) groupStatusEl.textContent = `Joined room: ${currentRoomName} as ${currentUserDisplayName}`;
            if(joinRoomButton) joinRoomButton.disabled = true;
            if(leaveRoomButton) leaveRoomButton.disabled = false;
            if(roomNameInput) roomNameInput.disabled = true;
            if(displayNameInput) displayNameInput.disabled = true;

            if (sendLocationToGroupInterval) clearInterval(sendLocationToGroupInterval);
            sendLocationToGroupInterval = setInterval(sendMyLocationToGroup, GROUP_LOCATION_SEND_INTERVAL_MS);

            listenForGroupMembers(); // Start listening for others

            console.log(`Joined room ${currentRoomName}`);
        } catch (error) {
            console.error("Error joining group room:", error);
            if(groupStatusEl) groupStatusEl.textContent = `Error joining room: ${error.message.substring(0,50)}`;
        }
    }

    async function sendMyLocationToGroup() {
        if (!isRunning || isPaused || !currentRoomName || !currentUserId || currentLatitude === null || currentLongitude === null) {
            return;
        }
        const locationData = {
            latitude: currentLatitude,
            longitude: currentLongitude,
            altitude: currentAltitudeM,
            speedKmh: currentSpeedKmh,
            bearing: currentBikeBearingDegrees,
            updatedAt: new Date().toISOString() 
        };
        try {
            await db.collection('rooms').doc(currentRoomName).collection('members').doc(currentUserId).update({
                location: locationData,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp() 
            });
        } catch (error) {
            console.error("Error sending location to group:", error);
        }
    }

    function listenForGroupMembers() {
        if (!currentRoomName || !db) return; // Ensure db is initialized
        if (groupMembersListener) groupMembersListener(); 

        groupMembersListener = db.collection('rooms').doc(currentRoomName).collection('members')
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(change => {
                    const memberId = change.doc.id;
                    const memberData = change.doc.data();

                    if (memberId === currentUserId) return; 

                    if (change.type === "added" || change.type === "modified") {
                        if (memberData.location && memberData.location.latitude !== undefined && memberData.location.longitude !== undefined) {
                            if (!groupMembers[memberId]) { 
                                groupMembers[memberId] = {
                                    displayName: memberData.displayName || "Cyclist",
                                    lat: memberData.location.latitude,
                                    lon: memberData.location.longitude,
                                    marker: null,
                                    lastSeen: memberData.lastSeen ? memberData.lastSeen.toMillis() : 0
                                };
                            } else { 
                                groupMembers[memberId].lat = memberData.location.latitude;
                                groupMembers[memberId].lon = memberData.location.longitude;
                                groupMembers[memberId].displayName = memberData.displayName || groupMembers[memberId].displayName;
                                groupMembers[memberId].lastSeen = memberData.lastSeen ? memberData.lastSeen.toMillis() : groupMembers[memberId].lastSeen;
                            }
                            updateGroupMemberMarker(memberId);
                        }
                    } else if (change.type === "removed") {
                        removeGroupMemberMarker(memberId);
                        delete groupMembers[memberId];
                    }
                });
            }, error => {
                console.error("Error listening to group members:", error);
                if(groupStatusEl) groupStatusEl.textContent = "Error in group connection.";
            });
    }

    function updateGroupMemberMarker(memberId) {
        if (!map || !groupMembers[memberId] || groupMembers[memberId].lat === null || groupMembers[memberId].lon === null) {
            return;
        }
        const member = groupMembers[memberId];
        const latLng = [member.lat, member.lon];
        if (member.marker) {
            member.marker.setLatLng(latLng);
        } else {
            // Simple green dot marker for other riders
            const otherRiderIcon = L.divIcon({
                className: 'other-rider-marker',
                html: `<div style="background-color: green; width: 10px; height: 10px; border-radius: 50%; border: 1px solid white;"></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });
            member.marker = L.marker(latLng, { icon: otherRiderIcon }).addTo(map);
        }
        member.marker.bindTooltip(member.displayName, {permanent: false, direction: 'top'}); //.openTooltip(); // Tooltip on hover is better
    }

    function removeGroupMemberMarker(memberId) {
        if (groupMembers[memberId] && groupMembers[memberId].marker && map) {
            map.removeLayer(groupMembers[memberId].marker);
        }
    }

    async function leaveGroupRideRoom() {
        if (sendLocationToGroupInterval) clearInterval(sendLocationToGroupInterval);
        sendLocationToGroupInterval = null;

        if (groupMembersListener) {
            groupMembersListener(); 
            groupMembersListener = null;
        }
        Object.keys(groupMembers).forEach(memberId => {
            removeGroupMemberMarker(memberId);
        });
        groupMembers = {}; 

        const roomToLeave = currentRoomName; // Capture before nullifying
        const userToLeave = currentUserId;

        currentRoomName = null; // Nullify global state first
        currentUserDisplayName = null;

        if (!roomToLeave || !userToLeave || !db) {
             if(groupStatusEl) groupStatusEl.textContent = "Not in a room or user ID missing.";
        } else {
            try {
                await db.collection('rooms').doc(roomToLeave).collection('members').doc(userToLeave).delete();
                console.log(`Left room ${roomToLeave} and removed data.`);
            } catch (error) {
                console.error("Error leaving group room / deleting data:", error);
            }
        }

        if(groupStatusEl) groupStatusEl.textContent = "Not in a room.";
        if(joinRoomButton) joinRoomButton.disabled = false;
        if(leaveRoomButton) leaveRoomButton.disabled = true;
        if(roomNameInput) roomNameInput.disabled = false;
        if(displayNameInput) displayNameInput.disabled = false;
    }


    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 15. EVENT LISTENERS FOR CONTROLS
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    if (connectSpeedCadenceButton) {
        connectSpeedCadenceButton.addEventListener('click', connectSpeedCadenceDevice);
    }
    if (joinRoomButton) { 
        joinRoomButton.addEventListener('click', joinGroupRideRoom);
    }
    if (leaveRoomButton) { 
        leaveRoomButton.addEventListener('click', leaveGroupRideRoom);
    }

    startRideButton.addEventListener('click', function() {
        if (isRunning) return;
        if (!navigator.geolocation) { 
            statusEl.textContent = "Geolocation is not supported by your browser."; return; 
        }
        isRunning = true; isPaused = false;
        rideStartTime = performance.now(); activeSegmentStartTime = rideStartTime;
        lastProcessedDataTimestamp = rideStartTime;
        totalDistanceKm = 0; currentAltitudeM = null; previousAltitudeM = null;
        currentSpeedKmh = 0; currentCadenceRpm = (settings.defaultCadence || 80);
        powerReadings = []; rideDataLog = []; totalElapsedTimeMs = 0; 
        previousTimestamp = null; previousLatitude = null; previousLongitude = null;
        currentLatitude = null; currentLongitude = null; previousSpeedMsForSim = 0;
        currentWindSpeedMs = 0; currentWindDirectionDegrees = null; currentBikeBearingDegrees = null;
        currentGearRatio = null; 
        mapPathCoordinates = []; 
        if (map) { 
            if (ridePathPolyline) ridePathPolyline.setLatLngs(mapPathCoordinates);
            if (currentPositionMarker) { map.removeLayer(currentPositionMarker); currentPositionMarker = null; }
            try { map.setView([settings.defaultLat || 51.0447, settings.defaultLon || -114.0719], 10); } 
            catch(e) { console.warn("Map not ready for setView yet or defaultLat/Lon not in settings.")}
        } else {
             if(mapDisplayEl) mapDisplayEl.textContent = 'Initializing Map... Waiting for GPS...';
        }
                                                 
        updateDisplay(0,0); 
        statusEl.textContent = "Attempting to get GPS signal...";
        const geoOptions = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };
        geolocWatchId = navigator.geolocation.watchPosition(processPositionUpdate, handleLocationError, geoOptions);
        setTimeout(() => {
            if (isRunning && currentLatitude !== null && currentLongitude !== null) {
                fetchAndUpdateWeatherData(currentLatitude, currentLongitude);
                 if (!map && currentLatitude && currentLongitude) { 
                    initializeMap(currentLatitude, currentLongitude);
                }
            } else if (isRunning && !map) { 
                initializeMap(settings.defaultLat || 51.0447, settings.defaultLon || -114.0719);
            }
        }, 3000); 
        if (weatherApiUpdateInterval) clearInterval(weatherApiUpdateInterval);
        weatherApiUpdateInterval = setInterval(() => {
            if (isRunning && !isPaused && currentLatitude !== null && currentLongitude !== null) {
                fetchAndUpdateWeatherData(currentLatitude, currentLongitude);
            }
        }, WEATHER_API_UPDATE_FREQUENCY_MS);
        if (failsafeTickInterval) clearInterval(failsafeTickInterval);
        failsafeTickInterval = setInterval(ensurePeriodicUpdate, 1000); 
        startRideButton.disabled = true; pauseSimButton.disabled = false;
        resumeSimButton.disabled = true; stopSimButton.disabled = false;
        requestWakeLock();
    });

    pauseSimButton.addEventListener('click', function() {
        if (!isRunning || isPaused) return;
        isPaused = true;
        if (failsafeTickInterval) clearInterval(failsafeTickInterval);
        if (sendLocationToGroupInterval) clearInterval(sendLocationToGroupInterval); // Stop sending location when paused
        sendLocationToGroupInterval = null; 
        
        pauseSimButton.disabled = true; resumeSimButton.disabled = false;
        statusEl.textContent = "Ride paused."; releaseWakeLock(); 
    });

    resumeSimButton.addEventListener('click', function() {
        if (!isRunning || !isPaused) return;
        isPaused = false;
        activeSegmentStartTime = performance.now(); 
        previousTimestamp = activeSegmentStartTime; 
        lastProcessedDataTimestamp = activeSegmentStartTime;
        if (failsafeTickInterval) clearInterval(failsafeTickInterval);
        failsafeTickInterval = setInterval(ensurePeriodicUpdate, 1000);

        if (currentRoomName && currentUserId) { // Restart sending location if in a room
            if (sendLocationToGroupInterval) clearInterval(sendLocationToGroupInterval);
            sendLocationToGroupInterval = setInterval(sendMyLocationToGroup, GROUP_LOCATION_SEND_INTERVAL_MS);
        }

        pauseSimButton.disabled = false; resumeSimButton.disabled = true;
        statusEl.textContent = "Ride resumed."; requestWakeLock(); 
    });

    async function stopRide() { 
        if (!isRunning && geolocWatchId === null && failsafeTickInterval === null) return;
        isRunning = false; isPaused = false;
        if (geolocWatchId !== null) { navigator.geolocation.clearWatch(geolocWatchId); geolocWatchId = null; }
        if (failsafeTickInterval) clearInterval(failsafeTickInterval); failsafeTickInterval = null;
        if (weatherApiUpdateInterval) clearInterval(weatherApiUpdateInterval); weatherApiUpdateInterval = null;
        
        if (sendLocationToGroupInterval) clearInterval(sendLocationToGroupInterval); // Stop sending group locations
        sendLocationToGroupInterval = null;
        if (currentRoomName && currentUserId) { // If in a room, also leave it
            await leaveGroupRideRoom(); 
        }
        
        if (bleDevice && bleDevice.gatt.connected) {
            try {
                if (cscCharacteristic && typeof cscCharacteristic.stopNotifications === 'function') {
                    await cscCharacteristic.stopNotifications();
                    cscCharacteristic.removeEventListener('characteristicvaluechanged', handleCSCMeasurement);
                }
                bleDevice.gatt.disconnect();
                console.log("BLE device disconnected on ride stop.");
                onDisconnected(); 
            } catch (error) {
                console.error("Error during BLE disconnection:", error);
                 onDisconnected(); 
            }
        }
        releaseWakeLock(); 

        if (map && ridePathPolyline && mapPathCoordinates.length > 0) {
            try { map.fitBounds(ridePathPolyline.getBounds()); } 
            catch (e) { console.warn("Could not fit map to bounds:", e); }
        }
        
        let finalAvgSpeed = totalElapsedTimeMs > 0 ? (totalDistanceKm / (totalElapsedTimeMs / (1000 * 3600))) : 0;
        let initialAvgPower = powerReadings.length > 0 ? (powerReadings.reduce((acc, val) => acc + val, 0) / powerReadings.length) : 0;
        statusEl.textContent = `Ride Stopped. Distance: ${totalDistanceKm.toFixed(2)} km. Processing final data...`;
        let logToDownload = JSON.parse(JSON.stringify(rideDataLog)); 
        let finalSummaryText = `Ride Summary (Original GPS Altitude):\nDistance: ${totalDistanceKm.toFixed(2)} km\nTime: ${formatElapsedTime(totalElapsedTimeMs)}\nAvg Speed: ${finalAvgSpeed.toFixed(1)} km/h\nAvg Power: ${Math.round(initialAvgPower)} W`;
        let finalAvgPowerForDisplay = initialAvgPower;

        if (logToDownload.length > 0) {
            const correctedLogWithElevations = await fetchCorrectedElevations(logToDownload);
            if (correctedLogWithElevations) {
                const recalced = recalculateMetricsWithCorrectedElevation(correctedLogWithElevations);
                if (recalced.recalculatedLog) {
                    logToDownload = recalced.recalculatedLog; 
                    finalAvgPowerForDisplay = recalced.summary.avgPowerCorrected;
                    finalSummaryText = `Ride Summary (Corrected Altitude):\nDistance: ${totalDistanceKm.toFixed(2)} km\nTime: ${formatElapsedTime(totalElapsedTimeMs)}\nAvg Speed: ${finalAvgSpeed.toFixed(1)} km/h\nAvg Power: ${Math.round(finalAvgPowerForDisplay)} W\nTotal Ascent (Corrected): ${recalced.summary.totalAscentM}m`;
                    statusEl.textContent = `Ride Stopped. Corrected Data. Ascent: ${recalced.summary.totalAscentM}m.`;
                    if (avgPowerEl) avgPowerEl.textContent = Math.round(finalAvgPowerForDisplay);
                } else { statusEl.textContent += " Recalculation failed. Using original GPS data."; }
            } else { statusEl.textContent += " Elevation correction failed. Using original GPS data."; }
        }
        alert(finalSummaryText); 
        if (logToDownload.length > 0) { downloadRideDataCSV(logToDownload); }
        else { statusEl.textContent += " No data to download."; }

        startRideButton.disabled = false; pauseSimButton.disabled = true;
        resumeSimButton.disabled = true; stopSimButton.disabled = true;
        totalElapsedTimeMs = 0; previousTimestamp = null; previousLatitude = null;
        previousLongitude = null; previousAltitudeM = null; currentLatitude = null; 
        currentLongitude = null; currentAltitudeM = null; powerReadings = [];
    }

    stopSimButton.addEventListener('click', stopRide);

    function downloadRideDataCSV(dataLog) {
        const headers = [
            "Timestamp (s)", "Abs GPS Timestamp", "Velocity (km/h)", "Power (W) (Original)", "Power Corrected (W)",
            "Longitude (X)", "Latitude (Y)", 
            "Altitude GPS (Z) (m)", "Altitude API Corrected (Z) (m)", "Altitude Source",
            "Gradient GPS (%)", "Gradient Corrected (%)", 
            "Cadence (RPM)", "GPS Accuracy (m)", "Synthetic Tick",
            "Bike Bearing (deg)", "Wind Speed (m/s)", "Wind Direction (deg)",
            "Sensor Speed (km/h)", "Sensor Cadence (RPM)", "Gear Ratio"
        ];
        let csvContent = headers.join(",") + "\n";
        dataLog.forEach(row => {
            const rowValues = [
                row.timestamp, row.abs_timestamp_gps || "N/A",
                row.velocity, row.power, 
                row.power_corrected !== undefined ? row.power_corrected : row.power,
                row.x_longitude, row.y_latitude, 
                row.z_altitude, 
                row.z_altitude_corrected || row.z_altitude, 
                row.altitude_source || "GPS",
                row.gradient, 
                row.gradient_corrected || row.gradient, 
                row.cadence, row.gps_accuracy,
                row.synthetic ? "1" : "0",
                row.bike_bearing !== null && row.bike_bearing !== "N/A" ? row.bike_bearing : "N/A",
                row.wind_speed_ms !== null && row.wind_speed_ms !== "N/A" ? row.wind_speed_ms : "N/A",
                row.wind_direction_deg !== null && row.wind_direction_deg !== "N/A" ? row.wind_direction_deg : "N/A",
                row.sensor_speed_kmh || "N/A",
                row.sensor_cadence_rpm || "N/A",
                row.gear_ratio || "N/A"
            ];
            csvContent += rowValues.map(val => {
                const strVal = String(val === null || val === undefined ? "N/A" : val);
                if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
                    return `"${strVal.replace(/"/g, '""')}"`;
                }
                return strVal;
            }).join(",") + "\n";
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            const now = new Date();
            const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
            const timeStr = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
            link.setAttribute("download", `ride_data_${dateStr}_${timeStr}.csv`);
            link.style.visibility = 'hidden'; document.body.appendChild(link);
            link.click(); document.body.removeChild(link);
        } else {
            alert("CSV download is not supported by your browser.");
        }
    }

    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 16. INITIALIZATION
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    loadRideSettings();
    if (mapDisplayEl) { 
       initializeMap(settings.defaultLat || 51.0447, settings.defaultLon || -114.0719); 
    }
    updateDisplay(0,0);

    signInAnonymouslyIfNeeded().catch(err => {
        console.warn("Initial anonymous sign-in failed (might retry on join):", err);
    });

}); // End of DOMContentLoaded