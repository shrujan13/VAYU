// Remove old map if live reload runs script again
if (window.vayuMap) {
    window.vayuMap.remove();
}

// App status memory
const vayuStatus = {
    hchoLayer: "Loading...",
    hotspotsCount: "Loading...",
    threshold: "Loading..."
};

// Create map
window.vayuMap = L.map("map").setView([22.5, 79], 5);

// Base map
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
}).addTo(window.vayuMap);


// Format HCHO value
function formatHchoValue(value) {
    if (value !== null && value !== undefined) {
        return Number(value).toExponential(3);
    }

    return "No data";
}


// Format pollutant value
function formatPollutantValue(value) {
    if (value !== null && value !== undefined) {
        return Number(value).toFixed(2);
    }

    return "No data";
}


// Format weather value
function formatWeatherValue(value, unit) {
    if (value !== null && value !== undefined) {
        return Number(value).toFixed(1) + " " + unit;
    }

    return "No data";
}


// Format AQI forecast short list
function formatForecastPreview(forecast) {
    if (!forecast || forecast.length === 0) {
        return "No forecast data";
    }

    const preview = forecast.slice(0, 6);

    return preview.map(point => {
        const timeText = point.time ? point.time.replace("T", " ") : "Time unavailable";
        return `${timeText}: AQI ${point.aqi}`;
    }).join("<br>");
}


// Smart environmental analysis
function getEnvironmentalAnalysis(hchoRisk, aqiCategory, weather, forecastData) {
    const insights = [];

    const windSpeed = weather.wind_speed_10m;
    const humidity = weather.relative_humidity_2m;
    const precipitation = weather.precipitation;
    const cloudCover = weather.cloud_cover;

    if (aqiCategory === "Good") {
        insights.push("Current AQI is good, so outdoor activity is generally safe.");
    } else if (aqiCategory === "Moderate") {
        insights.push("AQI is moderate. Sensitive people should monitor outdoor exposure.");
    } else if (aqiCategory === "Unhealthy for Sensitive Groups") {
        insights.push("Sensitive people should reduce prolonged outdoor activity.");
    } else if (aqiCategory === "Unhealthy" || aqiCategory === "Very Unhealthy" || aqiCategory === "Hazardous") {
        insights.push("Air quality is poor. Outdoor exposure should be reduced.");
    }

    if (hchoRisk === "High" || hchoRisk === "Hotspot") {
        insights.push("HCHO level indicates possible emission hotspot influence.");
    }

    if (forecastData && forecastData.trend) {
        if (forecastData.trend === "Improving") {
            insights.push("AQI forecast shows improving air quality over the next 24 hours.");
        } else if (forecastData.trend === "Increasing") {
            insights.push("AQI forecast shows pollution may increase in the next 24 hours.");
        } else if (forecastData.trend === "Stable") {
            insights.push("AQI forecast appears stable for the next 24 hours.");
        }
    }

    if (windSpeed !== null && windSpeed !== undefined) {
        if (windSpeed < 6) {
            insights.push("Low wind speed may reduce pollutant dispersion.");
        } else if (windSpeed > 15) {
            insights.push("Higher wind speed may help disperse pollutants.");
        }
    }

    if (humidity !== null && humidity !== undefined && humidity > 75) {
        insights.push("High humidity may contribute to haze or pollution persistence.");
    }

    if (precipitation !== null && precipitation !== undefined && precipitation > 0) {
        insights.push("Rainfall may help reduce suspended particles in air.");
    }

    if (cloudCover !== null && cloudCover !== undefined && cloudCover > 70) {
        insights.push("High cloud cover may affect satellite observation quality.");
    }

    if (insights.length === 0) {
        return "Environmental condition appears stable based on available data.";
    }

    return insights.join(" ");
}


// Show HCHO + AQI + Weather + Forecast popup for any location
function showLocationData(lat, lon, title, addressText) {

    const popup = L.popup({
        maxWidth: 460
    })
        .setLatLng([lat, lon])
        .setContent(`
            <b>${title}</b><br>
            ${addressText ? addressText + "<br>" : ""}
            <hr>
            Latitude: ${lat.toFixed(5)}<br>
            Longitude: ${lon.toFixed(5)}<br>
            HCHO: Loading...<br>
            AQI: Loading...<br>
            Weather: Loading...<br>
            Forecast: Loading...
        `)
        .openOn(window.vayuMap);

    const hchoUrl = `http://127.0.0.1:5000/get_hcho_value?lat=${lat}&lon=${lon}`;
    const aqiUrl = `http://127.0.0.1:5000/get_aqi_value?lat=${lat}&lon=${lon}`;
    const weatherUrl = `http://127.0.0.1:5000/get_weather_value?lat=${lat}&lon=${lon}`;
    const forecastUrl = `http://127.0.0.1:5000/get_aqi_forecast?lat=${lat}&lon=${lon}`;

    Promise.all([
        fetch(hchoUrl).then(response => response.json()),
        fetch(aqiUrl).then(response => response.json()),
        fetch(weatherUrl).then(response => response.json()),
        fetch(forecastUrl).then(response => response.json())
    ])
        .then(([hchoData, aqiData, weatherData, forecastData]) => {

            const hchoText = formatHchoValue(hchoData.hcho);
            const pollutants = aqiData.pollutants || {};
            const weather = weatherData.weather || {};

            const analysis = getEnvironmentalAnalysis(
                hchoData.risk,
                aqiData.category,
                weather,
                forecastData
            );

            popup.setContent(`
                <b>${title}</b><br>
                ${addressText ? addressText + "<br>" : ""}
                <hr>

                <b>Location</b><br>
                Latitude: ${lat.toFixed(5)}<br>
                Longitude: ${lon.toFixed(5)}<br>

                <hr>

                <b>HCHO Satellite Data</b><br>
                HCHO: ${hchoText}<br>
                HCHO Risk: ${hchoData.risk}<br>

                <hr>

                <b>AQI & Pollutants</b><br>
                Current AQI: ${aqiData.aqi}<br>
                Category: ${aqiData.category}<br>
                AQI Time: ${aqiData.time}<br>
                PM2.5: ${formatPollutantValue(pollutants.pm2_5)} µg/m³<br>
                PM10: ${formatPollutantValue(pollutants.pm10)} µg/m³<br>
                NO₂: ${formatPollutantValue(pollutants.nitrogen_dioxide)} µg/m³<br>
                SO₂: ${formatPollutantValue(pollutants.sulphur_dioxide)} µg/m³<br>
                CO: ${formatPollutantValue(pollutants.carbon_monoxide)} µg/m³<br>
                O₃: ${formatPollutantValue(pollutants.ozone)} µg/m³<br>

                <hr>

                <b>Weather Intelligence</b><br>
                Weather Time: ${weatherData.time}<br>
                Temperature: ${formatWeatherValue(weather.temperature_2m, "°C")}<br>
                Humidity: ${formatWeatherValue(weather.relative_humidity_2m, "%")}<br>
                Wind Speed: ${formatWeatherValue(weather.wind_speed_10m, "km/h")}<br>
                Cloud Cover: ${formatWeatherValue(weather.cloud_cover, "%")}<br>
                Rainfall: ${formatWeatherValue(weather.precipitation, "mm")}<br>

                <hr>

                <b>24-Hour AQI Forecast</b><br>
                Average AQI: ${forecastData.average_aqi}<br>
                Minimum AQI: ${forecastData.min_aqi}<br>
                Maximum AQI: ${forecastData.max_aqi}<br>
                Trend: ${forecastData.trend}<br>
                Forecast Category: ${forecastData.forecast_category}<br>
                Forecast Hours: ${forecastData.hours}<br>

                <br>
                <b>Next 6 Hours</b><br>
                ${formatForecastPreview(forecastData.forecast)}

                <hr>

                <b>Smart Analysis</b><br>
                ${analysis}<br>

                <hr>

                <b>Health Advisory</b><br>
                ${aqiData.advisory}
            `);
        })
        .catch(error => {
            console.error("Error loading location data:", error);

            popup.setContent(`
                <b>${title}</b><br>
                ${addressText ? addressText + "<br>" : ""}
                Latitude: ${lat.toFixed(5)}<br>
                Longitude: ${lon.toFixed(5)}<br>
                Data loading failed
            `);
        });
}


// Status panel
const statusPanel = L.control({ position: "topleft" });

statusPanel.onAdd = function () {
    const div = L.DomUtil.create("div", "status-panel");

    div.innerHTML = `
        <h4>VAYU Status</h4>
        <div>HCHO Layer: ${vayuStatus.hchoLayer}</div>
        <div>Hotspots Detected: ${vayuStatus.hotspotsCount}</div>
        <div>Threshold: ${vayuStatus.threshold}</div>
    `;

    return div;
};

statusPanel.addTo(window.vayuMap);


function renderStatusPanel() {
    const panel = document.querySelector(".status-panel");

    if (panel) {
        panel.innerHTML = `
            <h4>VAYU Status</h4>
            <div>HCHO Layer: ${vayuStatus.hchoLayer}</div>
            <div>Hotspots Detected: ${vayuStatus.hotspotsCount}</div>
            <div>Threshold: ${vayuStatus.threshold}</div>
        `;
    }
}


// Search panel
const searchPanel = L.control({ position: "topright" });

searchPanel.onAdd = function () {
    const div = L.DomUtil.create("div", "search-panel");

    div.innerHTML = `
        <h4>Search City</h4>
        <input id="cityInput" type="text" placeholder="Enter any Indian city">
        <button id="citySearchButton">Search</button>
        <div id="citySearchMessage"></div>
    `;

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
};

searchPanel.addTo(window.vayuMap);


// Search any Indian city using OpenStreetMap and directly show full data
function searchCity() {
    const input = document.getElementById("cityInput");
    const message = document.getElementById("citySearchMessage");

    const cityName = input.value.trim();

    if (cityName === "") {
        message.innerHTML = "Enter a city name";
        return;
    }

    message.innerHTML = "Searching...";

    const searchUrl =
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(cityName)}`;

    fetch(searchUrl)
        .then(response => response.json())
        .then(results => {

            if (!results || results.length === 0) {
                message.innerHTML = "City not found";
                return;
            }

            const place = results[0];

            const lat = parseFloat(place.lat);
            const lon = parseFloat(place.lon);
            const address = place.display_name;

            window.vayuMap.setView([lat, lon], 10);

            message.innerHTML = "City found";

            showLocationData(
                lat,
                lon,
                cityName,
                address
            );
        })
        .catch(error => {
            console.error("City search error:", error);
            message.innerHTML = "Search failed";
        });
}


setTimeout(function () {
    const button = document.getElementById("citySearchButton");
    const input = document.getElementById("cityInput");

    button.addEventListener("click", searchCity);

    input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            searchCity();
        }
    });
}, 500);


// Hotspot marker layer
const hotspotLayer = L.layerGroup().addTo(window.vayuMap);


// Load HCHO satellite layer from Flask backend
fetch("http://127.0.0.1:5000/get_hcho_tile")
    .then(response => response.json())
    .then(data => {

        console.log("Earth Engine Tile URL:", data.tile_url);

        L.tileLayer(data.tile_url, {
            opacity: 0.65,
            attribution: "Google Earth Engine | Sentinel-5P HCHO"
        }).addTo(window.vayuMap);

        vayuStatus.hchoLayer = "Active";
        renderStatusPanel();

    })
    .catch(error => {
        console.error("Error loading HCHO layer:", error);

        vayuStatus.hchoLayer = "Error";
        renderStatusPanel();
    });


// Load automatic HCHO hotspots
function loadHchoHotspots() {

    vayuStatus.hotspotsCount = "Loading...";
    vayuStatus.threshold = "Loading...";
    renderStatusPanel();

    fetch("http://127.0.0.1:5000/get_hcho_hotspots")
        .then(response => response.json())
        .then(data => {

            console.log("HCHO Hotspots:", data);

            hotspotLayer.clearLayers();

            vayuStatus.hotspotsCount = data.count;
            vayuStatus.threshold = data.threshold;
            renderStatusPanel();

            if (!data.hotspots || data.hotspots.length === 0) {
                console.log("No HCHO hotspots found");
                return;
            }

            data.hotspots.forEach(point => {

                const hchoText = formatHchoValue(point.hcho);

                L.circleMarker([point.lat, point.lon], {
                    radius: 9,
                    color: "red",
                    fillColor: "red",
                    fillOpacity: 0.85,
                    weight: 2
                })
                    .bindPopup(`
                        <b>HCHO Hotspot</b><br>
                        Latitude: ${point.lat.toFixed(4)}<br>
                        Longitude: ${point.lon.toFixed(4)}<br>
                        HCHO: ${hchoText}<br>
                        Risk: ${point.risk}
                    `)
                    .addTo(hotspotLayer);
            });
        })
        .catch(error => {
            console.error("Error loading HCHO hotspots:", error);

            vayuStatus.hotspotsCount = "Error";
            vayuStatus.threshold = "Error";
            renderStatusPanel();
        });
}

loadHchoHotspots();


// Click location popup with HCHO + AQI + Weather + Forecast
window.vayuMap.on("click", function (event) {

    const lat = event.latlng.lat;
    const lon = event.latlng.lng;

    showLocationData(
        lat,
        lon,
        "VAYU Location Data",
        ""
    );
});


// Legend
const legend = L.control({ position: "bottomright" });

legend.onAdd = function () {

    const div = L.DomUtil.create("div", "legend");

    div.innerHTML = `
        <h4>HCHO Level</h4>
        <div><span style="background: blue"></span> Low</div>
        <div><span style="background: cyan"></span> Slight</div>
        <div><span style="background: green"></span> Moderate</div>
        <div><span style="background: yellow"></span> High</div>
        <div><span style="background: orange"></span> Very High</div>
        <div><span style="background: red"></span> Hotspot</div>
    `;

    return div;
};

legend.addTo(window.vayuMap);