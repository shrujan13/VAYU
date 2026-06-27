// Remove old map if live reload runs script again
if (window.vayuMap) {
    window.vayuMap.remove();
}

// Create map
window.vayuMap = L.map("map").setView([22.5, 79], 5);

// Base map
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
}).addTo(window.vayuMap);

// Load HCHO layer from Flask backend
fetch("http://127.0.0.1:5000/get_hcho_tile")
    .then(response => response.json())
    .then(data => {

        console.log("Earth Engine Tile URL:", data.tile_url);

        L.tileLayer(data.tile_url, {
            opacity: 0.65,
            attribution: "Google Earth Engine | Sentinel-5P HCHO"
        }).addTo(window.vayuMap);

    })
    .catch(error => {
        console.error("Error loading HCHO layer:", error);
    });


// Click location popup with real HCHO value
window.vayuMap.on("click", function (event) {

    const lat = event.latlng.lat.toFixed(5);
    const lon = event.latlng.lng.toFixed(5);

    const popup = L.popup()
        .setLatLng(event.latlng)
        .setContent(`
            <b>VAYU Location Data</b><br>
            Latitude: ${lat}<br>
            Longitude: ${lon}<br>
            HCHO: Loading...<br>
            Risk: Analyzing...
        `)
        .openOn(window.vayuMap);

    fetch(`http://127.0.0.1:5000/get_hcho_value?lat=${lat}&lon=${lon}`)
        .then(response => response.json())
        .then(data => {

            let hchoText = "No data";

            if (data.hcho !== null && data.hcho !== undefined) {
                hchoText = Number(data.hcho).toExponential(3);
            }

            popup.setContent(`
                <b>VAYU Location Data</b><br>
                Latitude: ${lat}<br>
                Longitude: ${lon}<br>
                HCHO: ${hchoText}<br>
                Risk: ${data.risk}<br>
                AQI: Coming soon
            `);
        })
        .catch(error => {
            console.error("Error loading HCHO value:", error);

            popup.setContent(`
                <b>VAYU Location Data</b><br>
                Latitude: ${lat}<br>
                Longitude: ${lon}<br>
                HCHO: Error loading data<br>
                Risk: Unknown
            `);
        });
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