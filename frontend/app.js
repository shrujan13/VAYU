// Remove old map if live reload runs script again
if (window.vayuMap) {
    window.vayuMap.remove();
}

// App status memory
const vayuStatus = {
    hchoLayer: "Loading...",
    hotspotStatus: "Starting...",
    hotspotsCount: "Scanning...",
    threshold: "Loading...",
    dataWindow: "Loading...",
    message: "Initializing VAYU satellite services..."
};

// Create map
window.vayuMap = L.map("map").setView([22.5, 79], 5);

// Base map
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
}).addTo(window.vayuMap);

// Layers
const hotspotLayer = L.layerGroup().addTo(window.vayuMap);
const selectedLocationLayer = L.layerGroup().addTo(window.vayuMap);


// Print / Save Report as PDF
window.printVayuReport = function () {
    const panel = document.querySelector(".report-panel");

    if (!panel) {
        alert("No report available to print.");
        return;
    }

    const reportContent = panel.innerHTML;

    const printWindow = window.open("", "_blank", "width=900,height=700");

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>VAYU Environmental Report</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 30px;
                    color: #111827;
                    line-height: 1.5;
                }

                h3 {
                    color: #0b3d91;
                    font-size: 24px;
                    margin-bottom: 10px;
                }

                h4 {
                    color: #111827;
                    margin-bottom: 8px;
                }

                .report-section {
                    border-top: 1px solid #ddd;
                    padding-top: 12px;
                    margin-top: 14px;
                }

                .small-text {
                    font-size: 12px;
                    color: #555;
                    margin-top: 4px;
                }

                .metric-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                }

                .metric-card {
                    background: #f4f7fb;
                    border-radius: 10px;
                    padding: 12px;
                    border: 1px solid #dce3ee;
                }

                .metric-label {
                    display: block;
                    font-size: 12px;
                    color: #555;
                }

                .metric-value {
                    display: block;
                    font-size: 26px;
                    font-weight: bold;
                    color: #0b3d91;
                    margin-top: 3px;
                }

                .small-value {
                    font-size: 18px;
                }

                .metric-note {
                    display: block;
                    font-size: 12px;
                    color: #333;
                    margin-top: 3px;
                }

                .data-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    border-bottom: 1px solid #eee;
                    padding: 6px 0;
                    font-size: 14px;
                }

                .analysis-box {
                    background: #eef6ff;
                    border-left: 4px solid #1f6feb;
                    padding: 10px;
                    border-radius: 6px;
                    font-size: 14px;
                }

                .advisory-box {
                    background: #f1fff1;
                    border-left: 4px solid #228b22;
                    padding: 10px;
                    border-radius: 6px;
                    font-size: 14px;
                }

                .forecast-preview {
                    margin-top: 8px;
                    background: #fafafa;
                    border-radius: 8px;
                    padding: 8px;
                    font-size: 13px;
                    border: 1px solid #eee;
                }

                .forecast-chart-box {
                    margin-top: 10px;
                    background: #ffffff;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    padding: 8px;
                }

                .forecast-chart-title {
                    font-size: 13px;
                    font-weight: bold;
                    margin-bottom: 6px;
                    color: #0b3d91;
                }

                .forecast-chart {
                    width: 100%;
                    overflow-x: auto;
                }

                .aqi-svg-chart {
                    width: 100%;
                    min-width: 310px;
                    height: auto;
                }

                .print-report-button {
                    display: none;
                }

                .report-footer {
                    margin-top: 25px;
                    padding-top: 10px;
                    border-top: 1px solid #ddd;
                    font-size: 12px;
                    color: #555;
                }
            </style>
        </head>
        <body>
            ${reportContent}

            <div class="report-footer">
                Generated by VAYU Environmental Intelligence Dashboard
            </div>
        </body>
        </html>
    `);

    printWindow.document.close();

    setTimeout(function () {
        printWindow.focus();
        printWindow.print();
    }, 500);
};


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


// Format time for chart labels
function formatChartTime(timeText) {
    if (!timeText) {
        return "";
    }

    const parts = timeText.split("T");

    if (parts.length < 2) {
        return timeText;
    }

    return parts[1].slice(0, 5);
}


// Create AQI forecast SVG chart with inline styles for PDF export
function createAqiForecastChart(forecast) {
    if (!forecast || forecast.length === 0) {
        return `<div class="small-text">No forecast graph data available.</div>`;
    }

    const pointsData = forecast
        .slice(0, 24)
        .filter(point => point.aqi !== null && point.aqi !== undefined);

    if (pointsData.length === 0) {
        return `<div class="small-text">No valid AQI values available for graph.</div>`;
    }

    const width = 340;
    const height = 155;
    const paddingLeft = 38;
    const paddingRight = 16;
    const paddingTop = 18;
    const paddingBottom = 32;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const values = pointsData.map(point => Number(point.aqi));
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = Math.max(maxValue - minValue, 1);

    const svgPoints = pointsData.map((point, index) => {
        const x = pointsData.length === 1
            ? paddingLeft + chartWidth / 2
            : paddingLeft + (index * chartWidth / (pointsData.length - 1));

        const y = paddingTop + chartHeight - ((Number(point.aqi) - minValue) / range) * chartHeight;

        return {
            x: x,
            y: y,
            aqi: point.aqi,
            time: point.time
        };
    });

    const polylinePoints = svgPoints
        .map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(" ");

    const firstTime = formatChartTime(pointsData[0].time);
    const lastTime = formatChartTime(pointsData[pointsData.length - 1].time);

    const circles = svgPoints.map(point => `
        <circle
            cx="${point.x.toFixed(2)}"
            cy="${point.y.toFixed(2)}"
            r="3.2"
            fill="#1f6feb"
            stroke="#ffffff"
            stroke-width="1.5">
            <title>${formatChartTime(point.time)} AQI ${point.aqi}</title>
        </circle>
    `).join("");

    return `
        <svg
            viewBox="0 0 ${width} ${height}"
            class="aqi-svg-chart"
            role="img"
            xmlns="http://www.w3.org/2000/svg">

            <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#f8fbff"></rect>

            <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + chartHeight}" stroke="#cfd8e3" stroke-width="1"></line>

            <line x1="${paddingLeft}" y1="${paddingTop + chartHeight}" x2="${paddingLeft + chartWidth}" y2="${paddingTop + chartHeight}" stroke="#cfd8e3" stroke-width="1"></line>

            <text x="8" y="${paddingTop + 5}" font-size="10" fill="#526174">${maxValue}</text>

            <text x="8" y="${paddingTop + chartHeight}" font-size="10" fill="#526174">${minValue}</text>

            <polyline
                points="${polylinePoints}"
                fill="none"
                stroke="#1f6feb"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round">
            </polyline>

            ${circles}

            <text x="${paddingLeft}" y="${height - 9}" font-size="10" fill="#526174">${firstTime}</text>

            <text x="${paddingLeft + chartWidth - 35}" y="${height - 9}" font-size="10" fill="#526174">${lastTime}</text>
        </svg>
    `;
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


// Status panel
const statusPanel = L.control({ position: "topleft" });

statusPanel.onAdd = function () {
    const div = L.DomUtil.create("div", "status-panel");
    return div;
};

statusPanel.addTo(window.vayuMap);


function renderStatusPanel() {
    const panel = document.querySelector(".status-panel");

    if (panel) {
        panel.innerHTML = `
            <h4>VAYU Status</h4>
            <div>HCHO Layer: ${vayuStatus.hchoLayer}</div>
            <div>Hotspot Scan: ${vayuStatus.hotspotStatus}</div>
            <div>Hotspots Detected: ${vayuStatus.hotspotsCount}</div>
            <div>Threshold: ${vayuStatus.threshold}</div>
            <div class="small-text">Window: ${vayuStatus.dataWindow}</div>
            <div class="small-text">${vayuStatus.message}</div>
        `;
    }
}

renderStatusPanel();


// Search panel
const searchPanel = L.control({ position: "topright" });

searchPanel.onAdd = function () {
    const div = L.DomUtil.create("div", "search-panel");

    div.innerHTML = `
        <h4>Search Location</h4>
        <input id="cityInput" type="text" placeholder="Enter any Indian city">
        <button id="citySearchButton">Analyze</button>
        <div id="citySearchMessage"></div>
    `;

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
};

searchPanel.addTo(window.vayuMap);


// Report panel
const reportPanel = L.control({ position: "bottomleft" });

reportPanel.onAdd = function () {
    const div = L.DomUtil.create("div", "report-panel");

    div.innerHTML = `
        <h3>VAYU Environmental Report</h3>
        <div class="small-text">
            Search a city or click anywhere on the map to generate a detailed air quality report.
        </div>
    `;

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
};

reportPanel.addTo(window.vayuMap);


function setReportPanelContent(html) {
    const panel = document.querySelector(".report-panel");

    if (panel) {
        panel.innerHTML = html;
    }
}


// Mark selected location
function showSelectedLocation(lat, lon) {
    selectedLocationLayer.clearLayers();

    L.circleMarker([lat, lon], {
        radius: 7,
        color: "blue",
        fillColor: "blue",
        fillOpacity: 0.8,
        weight: 2
    }).addTo(selectedLocationLayer);
}


// Show HCHO + AQI + Weather + Forecast report
function showLocationData(lat, lon, title, addressText) {

    showSelectedLocation(lat, lon);

    const popup = L.popup({
        maxWidth: 280
    })
        .setLatLng([lat, lon])
        .setContent(`
            <b>${title}</b><br>
            Generating VAYU report...
        `)
        .openOn(window.vayuMap);

    setReportPanelContent(`
        <h3>VAYU Environmental Report</h3>
        <div class="loading-box">
            <b>Generating report...</b><br>
            Fetching AQI, pollutants, weather, forecast, and latest satellite HCHO data.
            <br><br>
            Satellite HCHO may take 20-40 seconds on first request because Earth Engine is processing latest Sentinel-5P data.
            Cached locations will load faster.
        </div>
    `);

    const hchoUrl = `/get_hcho_value?lat=${lat}&lon=${lon}`;
    const aqiUrl = `/get_aqi_value?lat=${lat}&lon=${lon}`;
    const weatherUrl = `/get_weather_value?lat=${lat}&lon=${lon}`;
    const forecastUrl = `/get_aqi_forecast?lat=${lat}&lon=${lon}`;

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
                AQI: ${aqiData.aqi}<br>
                HCHO Risk: ${hchoData.risk}<br>
                Full report shown in panel.
            `);

            const hchoWindowText = hchoData.start_date && hchoData.end_date
                ? `${hchoData.start_date} to ${hchoData.end_date}`
                : "Latest available rolling window";

            setReportPanelContent(`
                <h3>VAYU Environmental Report</h3>

                <button class="print-report-button" onclick="printVayuReport()">
                    Print / Save Report as PDF
                </button>

                <div class="report-section">
                    <h4>Selected Location</h4>
                    <div><b>${title}</b></div>
                    ${addressText ? `<div class="small-text">${addressText}</div>` : ""}
                    <div class="small-text">Lat: ${lat.toFixed(5)} | Lon: ${lon.toFixed(5)}</div>
                </div>

                <div class="report-section">
                    <h4>Data Sources</h4>
                    <div class="data-row"><span>HCHO Source</span><b>${hchoData.hcho_source || "Sentinel-5P NRTI HCHO"}</b></div>
                    <div class="data-row"><span>HCHO Window</span><b>${hchoWindowText}</b></div>
                    <div class="data-row"><span>AQI Source</span><b>${aqiData.source || "Open-Meteo Air Quality"}</b></div>
                    <div class="data-row"><span>Weather Source</span><b>${weatherData.source || "Open-Meteo Forecast"}</b></div>
                </div>

                <div class="report-section">
                    <h4>Overall Status</h4>
                    <div class="metric-grid">
                        <div class="metric-card">
                            <span class="metric-label">Current AQI</span>
                            <span class="metric-value">${aqiData.aqi}</span>
                            <span class="metric-note">${aqiData.category}</span>
                        </div>
                        <div class="metric-card">
                            <span class="metric-label">HCHO Risk</span>
                            <span class="metric-value small-value">${hchoData.risk}</span>
                            <span class="metric-note">${hchoText}</span>
                        </div>
                    </div>
                </div>

                <div class="report-section">
                    <h4>AQI & Pollutants</h4>
                    <div class="data-row"><span>PM2.5</span><b>${formatPollutantValue(pollutants.pm2_5)} µg/m³</b></div>
                    <div class="data-row"><span>PM10</span><b>${formatPollutantValue(pollutants.pm10)} µg/m³</b></div>
                    <div class="data-row"><span>NO₂</span><b>${formatPollutantValue(pollutants.nitrogen_dioxide)} µg/m³</b></div>
                    <div class="data-row"><span>SO₂</span><b>${formatPollutantValue(pollutants.sulphur_dioxide)} µg/m³</b></div>
                    <div class="data-row"><span>CO</span><b>${formatPollutantValue(pollutants.carbon_monoxide)} µg/m³</b></div>
                    <div class="data-row"><span>O₃</span><b>${formatPollutantValue(pollutants.ozone)} µg/m³</b></div>
                    <div class="small-text">AQI Time: ${aqiData.time}</div>
                </div>

                <div class="report-section">
                    <h4>Weather Intelligence</h4>
                    <div class="data-row"><span>Temperature</span><b>${formatWeatherValue(weather.temperature_2m, "°C")}</b></div>
                    <div class="data-row"><span>Humidity</span><b>${formatWeatherValue(weather.relative_humidity_2m, "%")}</b></div>
                    <div class="data-row"><span>Wind Speed</span><b>${formatWeatherValue(weather.wind_speed_10m, "km/h")}</b></div>
                    <div class="data-row"><span>Cloud Cover</span><b>${formatWeatherValue(weather.cloud_cover, "%")}</b></div>
                    <div class="data-row"><span>Rainfall</span><b>${formatWeatherValue(weather.precipitation, "mm")}</b></div>
                    <div class="small-text">Weather Time: ${weatherData.time}</div>
                </div>

                <div class="report-section">
                    <h4>24-Hour AQI Forecast</h4>
                    <div class="metric-grid">
                        <div class="metric-card">
                            <span class="metric-label">Average</span>
                            <span class="metric-value">${forecastData.average_aqi}</span>
                        </div>
                        <div class="metric-card">
                            <span class="metric-label">Peak</span>
                            <span class="metric-value">${forecastData.max_aqi}</span>
                        </div>
                    </div>

                    <div class="forecast-chart-box">
                        <div class="forecast-chart-title">AQI Trend Graph</div>
                        <div class="forecast-chart">
                            ${createAqiForecastChart(forecastData.forecast)}
                        </div>
                    </div>

                    <div class="data-row"><span>Minimum AQI</span><b>${forecastData.min_aqi}</b></div>
                    <div class="data-row"><span>Trend</span><b>${forecastData.trend}</b></div>
                    <div class="data-row"><span>Forecast Category</span><b>${forecastData.forecast_category}</b></div>
                    <div class="forecast-preview">
                        <b>Next 6 Hours</b><br>
                        ${formatForecastPreview(forecastData.forecast)}
                    </div>
                </div>

                <div class="report-section">
                    <h4>Smart Analysis</h4>
                    <div class="analysis-box">${analysis}</div>
                </div>

                <div class="report-section">
                    <h4>Health Advisory</h4>
                    <div class="advisory-box">${aqiData.advisory}</div>
                </div>
            `);
        })
        .catch(error => {
            console.error("Error loading location data:", error);

            popup.setContent(`
                <b>${title}</b><br>
                Data loading failed.
            `);

            setReportPanelContent(`
                <h3>VAYU Environmental Report</h3>
                <div class="error-box">
                    Data loading failed. Check backend server and internet connection.
                </div>
            `);
        });
}


// Search city using OpenStreetMap
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


// Load HCHO satellite layer
fetch("/get_hcho_tile")
    .then(response => response.json())
    .then(data => {

        console.log("Earth Engine Tile URL:", data.tile_url);

        L.tileLayer(data.tile_url, {
            opacity: 0.65,
            attribution: "Google Earth Engine | Sentinel-5P HCHO"
        }).addTo(window.vayuMap);

        vayuStatus.hchoLayer = "Active";
        vayuStatus.dataWindow = `${data.start_date} to ${data.end_date}`;
        vayuStatus.message = "HCHO layer loaded using latest available Sentinel-5P data.";
        renderStatusPanel();

    })
    .catch(error => {
        console.error("Error loading HCHO layer:", error);

        vayuStatus.hchoLayer = "Error";
        vayuStatus.message = "HCHO layer failed to load.";
        renderStatusPanel();
    });


// Render hotspot markers
function renderHotspotMarkers(hotspots) {
    hotspotLayer.clearLayers();

    if (!hotspots || hotspots.length === 0) {
        return;
    }

    hotspots.forEach(point => {

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
}


// Poll hotspot scan status
function pollHchoHotspots() {
    fetch("/get_hcho_hotspots")
        .then(response => response.json())
        .then(data => {

            console.log("HCHO Hotspot Status:", data);

            vayuStatus.threshold = data.threshold;
            vayuStatus.dataWindow = `${data.start_date} to ${data.end_date}`;

            if (data.status === "ready") {
                vayuStatus.hotspotStatus = "Completed";
                vayuStatus.hotspotsCount = data.count;
                vayuStatus.message = data.message || "Hotspot scan completed.";
                renderHotspotMarkers(data.hotspots);
                renderStatusPanel();
                return;
            }

            if (data.status === "scanning") {
                vayuStatus.hotspotStatus = "Scanning...";
                vayuStatus.hotspotsCount = "In progress";
                vayuStatus.message = data.message || "Satellite hotspot scan is in progress.";
                renderStatusPanel();

                setTimeout(pollHchoHotspots, 10000);
                return;
            }

            if (data.status === "error") {
                vayuStatus.hotspotStatus = "Error";
                vayuStatus.hotspotsCount = "Unavailable";
                vayuStatus.message = data.message || "Hotspot scan failed.";
                renderStatusPanel();
                return;
            }

            vayuStatus.hotspotStatus = "Waiting...";
            vayuStatus.hotspotsCount = "Starting";
            vayuStatus.message = "Preparing hotspot scan.";
            renderStatusPanel();

            setTimeout(pollHchoHotspots, 5000);
        })
        .catch(error => {
            console.error("Error loading HCHO hotspots:", error);

            vayuStatus.hotspotStatus = "Error";
            vayuStatus.hotspotsCount = "Unavailable";
            vayuStatus.message = "Could not contact backend for hotspot scan.";
            renderStatusPanel();
        });
}


// Start hotspot background scan
function loadHchoHotspots() {
    vayuStatus.hotspotStatus = "Starting...";
    vayuStatus.hotspotsCount = "Scanning...";
    vayuStatus.message = "Starting background hotspot scan. Dashboard will remain usable.";
    renderStatusPanel();

    fetch("/start_hcho_hotspot_scan")
        .then(response => response.json())
        .then(data => {
            console.log("Started Hotspot Scan:", data);

            vayuStatus.hotspotStatus = "Scanning...";
            vayuStatus.hotspotsCount = "In progress";
            vayuStatus.threshold = data.threshold;
            vayuStatus.dataWindow = `${data.start_date} to ${data.end_date}`;
            vayuStatus.message = data.message || "Satellite hotspot scan is in progress.";
            renderStatusPanel();

            pollHchoHotspots();
        })
        .catch(error => {
            console.error("Error starting hotspot scan:", error);

            vayuStatus.hotspotStatus = "Error";
            vayuStatus.hotspotsCount = "Unavailable";
            vayuStatus.message = "Could not start hotspot scan.";
            renderStatusPanel();
        });
}

loadHchoHotspots();


// Click map to generate report
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


// Fixed HCHO legend overlay
function createFixedHchoLegend() {
    const oldLegend = document.getElementById("fixedHchoLegend");

    if (oldLegend) {
        oldLegend.remove();
    }

    const legend = document.createElement("div");
    legend.id = "fixedHchoLegend";
    legend.className = "fixed-hcho-legend";

    legend.innerHTML = `
        <h4>HCHO Level</h4>
        <div><span style="background: blue"></span> Low</div>
        <div><span style="background: cyan"></span> Slight</div>
        <div><span style="background: green"></span> Moderate</div>
        <div><span style="background: yellow"></span> High</div>
        <div><span style="background: orange"></span> Very High</div>
        <div><span style="background: red"></span> Hotspot</div>
    `;

    document.body.appendChild(legend);
}

createFixedHchoLegend();