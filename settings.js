// settings.js - Handles the logic for the settings page.

// Wait until the entire HTML document is loaded and parsed.
document.addEventListener('DOMContentLoaded', function() {
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 1. DEFINE DEFAULT PARAMETER VALUES
    // These are typical starting points. Users can override them.
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    const defaultSettings = {
        systemMass: 75.0,       // kilograms (e.g., 65kg rider + 8kg bike + 2kg kit)
        wheelCircumference: 2105, // millimeters (common for 700x25c tire)
        crr: 0.005,             // Coefficient of Rolling Resistance (typical for road tires)
        // CdA presets:
        cdaPresets: {
            hoods: 0.320,       // m^2 (average for riding on the hoods)
            drops: 0.290,       // m^2 (average for riding in the drops)
            outOfSaddle: 0.380  // m^2 (average for out of saddle climbing)
        },
        cdaDefaultSelection: 'hoods', // Which preset is selected by default
        airDensity: 1.225       // kg/m^3 (standard air density at sea level, 15°C)
    };
    // For CdA, we'll set the input field based on the default preset.
    defaultSettings.cda = defaultSettings.cdaPresets[defaultSettings.cdaDefaultSelection];


    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 2. GET REFERENCES TO HTML ELEMENTS
    // We need these to read user input and display/update values.
    // 'document.getElementById()' is a common way to select an HTML element
    // by its unique 'id' attribute.
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    const systemMassInput = document.getElementById('systemMass');
    const wheelCircumferenceInput = document.getElementById('wheelCircumference');
    const crrInput = document.getElementById('crr');
    const cdaInput = document.getElementById('cda');
    const airDensityInput = document.getElementById('airDensity');
    const saveSettingsButton = document.getElementById('saveSettings');
    const statusMessageElement = document.getElementById('statusMessage');

    // CdA preset radio buttons
    const cdaPresetRadios = document.getElementsByName('cdaPreset');


    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 3. FUNCTIONS TO LOAD AND SAVE SETTINGS
    // We'll use localStorage to make settings persist if the user
    // closes and reopens the browser. localStorage stores data as strings.
    // JSON.stringify() converts a JavaScript object to a string.
    // JSON.parse() converts a string back to a JavaScript object.
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---

    function saveUserSettings(settings) {
        // 'localStorage' is a built-in browser feature for storing data locally.
        // 'setItem' saves a value associated with a key (here, 'cyclingAppSettings').
        localStorage.setItem('cyclingAppSettings', JSON.stringify(settings));
        statusMessageElement.textContent = 'Settings saved successfully!';
        setTimeout(() => { statusMessageElement.textContent = ''; }, 3000); // Clear message after 3s
        console.log('Settings saved:', settings);
    }

    function loadUserSettings() {
        // 'getItem' retrieves a value by its key.
        const savedSettingsString = localStorage.getItem('cyclingAppSettings');
        if (savedSettingsString) {
            // If settings exist in localStorage, parse them (convert string to object).
            return JSON.parse(savedSettingsString);
        } else {
            // If no saved settings, return our predefined defaults.
            return defaultSettings;
        }
    }


    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 4. FUNCTION TO POPULATE INPUT FIELDS
    // This function takes a settings object and fills the HTML input fields.
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    function populateForm(settings) {
        systemMassInput.value = settings.systemMass || defaultSettings.systemMass;
        wheelCircumferenceInput.value = settings.wheelCircumference || defaultSettings.wheelCircumference;
        crrInput.value = settings.crr || defaultSettings.crr;
        cdaInput.value = settings.cda || defaultSettings.cdaPresets[defaultSettings.cdaDefaultSelection];
        
        // For air density, if it's saved as null/empty, don't populate, show placeholder.
        airDensityInput.value = settings.airDensity === null || settings.airDensity === undefined ? '' : settings.airDensity;


        // Set the correct CdA preset radio button
        let cdaIsPreset = false;
        for (const presetKey in defaultSettings.cdaPresets) {
            if (parseFloat(cdaInput.value).toFixed(3) === defaultSettings.cdaPresets[presetKey].toFixed(3)) {
                const radio = document.getElementById('cda' + presetKey.charAt(0).toUpperCase() + presetKey.slice(1));
                if(radio) radio.checked = true;
                cdaIsPreset = true;
                break;
            }
        }
        // If the current CdA value doesn't match any preset, uncheck all radios
        if (!cdaIsPreset) {
            cdaPresetRadios.forEach(radio => radio.checked = false);
        }
    }


    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 5. EVENT LISTENERS
    // These "listen" for user actions (like clicks or input changes)
    // and then run a function in response.
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---

    // Event listener for CdA preset radio buttons
    cdaPresetRadios.forEach(radio => {
        // 'addEventListener' attaches a function to run when an event occurs.
        // 'change' event fires when a radio button selection changes.
        radio.addEventListener('change', function() {
            if (this.checked) { // 'this' refers to the radio button that changed
                // 'this.value' will be 'hoods', 'drops', or 'outOfSaddle'
                cdaInput.value = defaultSettings.cdaPresets[this.value].toFixed(3);
            }
        });
    });
    
    // Event listener for manual changes to the CdA input field
    // If user types a custom value, uncheck radio buttons
    cdaInput.addEventListener('input', function() {
        let currentCdaMatchesPreset = false;
        for (const presetKey in defaultSettings.cdaPresets) {
            if (parseFloat(this.value).toFixed(3) === defaultSettings.cdaPresets[presetKey].toFixed(3)) {
                const radio = document.getElementById('cda' + presetKey.charAt(0).toUpperCase() + presetKey.slice(1));
                if(radio) radio.checked = true;
                currentCdaMatchesPreset = true;
                break;
            }
        }
        if (!currentCdaMatchesPreset) {
            cdaPresetRadios.forEach(radio => radio.checked = false);
        }
    });


    // Event listener for the "Save Settings" button
    saveSettingsButton.addEventListener('click', function() {
        // When button is clicked, gather current values from the form.
        // 'parseFloat' converts a string from an input field to a number.
        // It's important to validate these inputs in a real app (e.g., ensure they are numbers).
        const currentSettings = {
            systemMass: parseFloat(systemMassInput.value),
            wheelCircumference: parseInt(wheelCircumferenceInput.value), // Usually an integer
            crr: parseFloat(crrInput.value),
            cda: parseFloat(cdaInput.value),
            // If airDensity is empty, store null, otherwise parse it as a float.
            // The '|| null' part means if airDensityInput.value is empty (which is a "falsy" value),
            // then currentAirDensity will be null. Otherwise, it will be the parsed float.
            airDensity: airDensityInput.value ? parseFloat(airDensityInput.value) : null 
        };

        // Perform some basic validation (you can add more)
        if (isNaN(currentSettings.systemMass) || currentSettings.systemMass <= 0) {
            alert("Please enter a valid system mass.");
            return; // Stop if validation fails
        }
        if (isNaN(currentSettings.wheelCircumference) || currentSettings.wheelCircumference <= 0) {
            alert("Please enter a valid wheel circumference.");
            return; 
        }
        if (isNaN(currentSettings.crr) || currentSettings.crr < 0) { // Crr can be 0, but not negative
            alert("Please enter a valid Crr value.");
            return; 
        }
         if (isNaN(currentSettings.cda) || currentSettings.cda <= 0) {
            alert("Please enter a valid CdA value.");
            return;
        }
        if (airDensityInput.value && (isNaN(currentSettings.airDensity) || currentSettings.airDensity <=0)) {
            alert("Please enter a valid Air Density value or leave it blank for default.");
            return;
        }


        saveUserSettings(currentSettings);

        // For now, "Proceed to Ride" doesn't do anything beyond saving.
        // Later, this would navigate to the main ride screen.
        // Example: window.location.href = 'ride.html'; (if you had a ride.html page)
        console.log("Proceeding to ride with settings:", currentSettings);
        window.location.href = 'ride.html'; // Navigate to the ride screen
    });


    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    // 6. INITIALIZATION
    // Load settings when the page loads and populate the form.
    // --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    const userSettings = loadUserSettings();
    populateForm(userSettings);
    console.log('Initial settings loaded:', userSettings);

}); // End of DOMContentLoaded