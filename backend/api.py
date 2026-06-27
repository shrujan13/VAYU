from flask import Flask, jsonify, request
from flask_cors import CORS
import ee
import json
import urllib.request
import urllib.parse
from datetime import datetime

app = Flask(__name__)
CORS(app)

ee.Initialize(project="vayu-500508")

# Cache variables
HCHO_TILE_CACHE = None
HCHO_HOTSPOT_CACHE = None


def get_india_boundary():
    return ee.FeatureCollection("FAO/GAUL/2015/level0") \
        .filter(ee.Filter.eq("ADM0_NAME", "India"))


def get_hcho_image():
    india = get_india_boundary()

    image = ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_HCHO") \
        .filterDate("2025-06-01", "2025-06-20") \
        .select("tropospheric_HCHO_column_number_density") \
        .mean() \
        .clip(india)

    return image


def classify_hcho(value):
    if value is None:
        return "No data"

    if value < 0.0001:
        return "Low"
    elif value < 0.0002:
        return "Moderate"
    elif value < 0.0003:
        return "High"
    else:
        return "Hotspot"


def classify_aqi(aqi):
    if aqi is None:
        return "No data"

    if aqi <= 50:
        return "Good"
    elif aqi <= 100:
        return "Moderate"
    elif aqi <= 150:
        return "Unhealthy for Sensitive Groups"
    elif aqi <= 200:
        return "Unhealthy"
    elif aqi <= 300:
        return "Very Unhealthy"
    else:
        return "Hazardous"


def get_aqi_advisory(category):
    if category == "Good":
        return "Air quality is good. Normal outdoor activity is okay."

    if category == "Moderate":
        return "Air quality is acceptable. Sensitive people should monitor symptoms."

    if category == "Unhealthy for Sensitive Groups":
        return "Sensitive people should reduce prolonged outdoor activity."

    if category == "Unhealthy":
        return "Everyone should reduce prolonged outdoor activity."

    if category == "Very Unhealthy":
        return "Avoid long outdoor exposure. Limit physical activity outside."

    if category == "Hazardous":
        return "Avoid outdoor activity. Pollution level is very serious."

    return "AQI data unavailable for this location."


def fetch_json_from_url(url):
    with urllib.request.urlopen(url, timeout=20) as response:
        data = response.read().decode("utf-8")
        return json.loads(data)


def get_value_from_hourly(hourly_data, variable_name, index):
    values = hourly_data.get(variable_name)

    if values is None:
        return None

    if index < 0 or index >= len(values):
        return None

    return values[index]


def find_current_hour_index(times):
    if not times:
        return 0

    current_hour = datetime.now().strftime("%Y-%m-%dT%H:00")

    if current_hour in times:
        return times.index(current_hour)

    return 0


@app.route("/")
def home():
    return {
        "status": "running",
        "project": "VAYU",
        "message": "Backend is active"
    }


@app.route("/get_hcho_tile")
def get_hcho_tile():
    global HCHO_TILE_CACHE

    try:
        if HCHO_TILE_CACHE is not None:
            return jsonify({
                "source": "cache",
                "tile_url": HCHO_TILE_CACHE
            })

        image = get_hcho_image()

        vis = {
            "min": 0.00005,
            "max": 0.0004,
            "palette": ["blue", "cyan", "green", "yellow", "orange", "red"]
        }

        map_id = image.getMapId(vis)
        tile_url = map_id["tile_fetcher"].url_format

        HCHO_TILE_CACHE = tile_url

        return jsonify({
            "source": "earth_engine",
            "tile_url": tile_url
        })

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500


@app.route("/get_hcho_value")
def get_hcho_value():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))

        point = ee.Geometry.Point([lon, lat])
        area = point.buffer(10000)

        image = get_hcho_image()

        result = image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=area,
            scale=10000,
            maxPixels=1e13
        ).getInfo()

        value = result.get("tropospheric_HCHO_column_number_density")
        risk = classify_hcho(value)

        return jsonify({
            "lat": lat,
            "lon": lon,
            "hcho": value,
            "risk": risk
        })

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500


@app.route("/get_hcho_hotspots")
def get_hcho_hotspots():
    global HCHO_HOTSPOT_CACHE

    try:
        hotspot_threshold = 0.00025

        if HCHO_HOTSPOT_CACHE is not None:
            return jsonify({
                "source": "cache",
                "count": len(HCHO_HOTSPOT_CACHE),
                "threshold": hotspot_threshold,
                "hotspots": HCHO_HOTSPOT_CACHE
            })

        india = get_india_boundary().geometry()
        image = get_hcho_image()

        hotspot_mask = image.gt(hotspot_threshold)

        hotspot_points = image.updateMask(hotspot_mask).sample(
            region=india,
            scale=25000,
            numPixels=30,
            seed=42,
            geometries=True
        ).getInfo()

        hotspots = []

        for feature in hotspot_points["features"]:
            coords = feature["geometry"]["coordinates"]
            properties = feature["properties"]

            hcho_value = properties.get("tropospheric_HCHO_column_number_density")

            hotspots.append({
                "lat": coords[1],
                "lon": coords[0],
                "hcho": hcho_value,
                "risk": classify_hcho(hcho_value)
            })

        HCHO_HOTSPOT_CACHE = hotspots

        return jsonify({
            "source": "earth_engine",
            "count": len(hotspots),
            "threshold": hotspot_threshold,
            "hotspots": hotspots
        })

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500


@app.route("/get_aqi_value")
def get_aqi_value():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))

        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
            "timezone": "auto"
        }

        query_string = urllib.parse.urlencode(params)

        url = "https://air-quality-api.open-meteo.com/v1/air-quality?" + query_string

        api_data = fetch_json_from_url(url)

        hourly = api_data.get("hourly", {})
        times = hourly.get("time", [])

        index = find_current_hour_index(times)

        aqi = get_value_from_hourly(hourly, "us_aqi", index)
        pm10 = get_value_from_hourly(hourly, "pm10", index)
        pm25 = get_value_from_hourly(hourly, "pm2_5", index)
        co = get_value_from_hourly(hourly, "carbon_monoxide", index)
        no2 = get_value_from_hourly(hourly, "nitrogen_dioxide", index)
        so2 = get_value_from_hourly(hourly, "sulphur_dioxide", index)
        ozone = get_value_from_hourly(hourly, "ozone", index)

        category = classify_aqi(aqi)
        advisory = get_aqi_advisory(category)

        selected_time = None

        if times and index < len(times):
            selected_time = times[index]

        return jsonify({
            "lat": lat,
            "lon": lon,
            "aqi": aqi,
            "category": category,
            "advisory": advisory,
            "time": selected_time,
            "pollutants": {
                "pm10": pm10,
                "pm2_5": pm25,
                "carbon_monoxide": co,
                "nitrogen_dioxide": no2,
                "sulphur_dioxide": so2,
                "ozone": ozone
            }
        })

    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500


@app.route("/clear_cache")
def clear_cache():
    global HCHO_TILE_CACHE
    global HCHO_HOTSPOT_CACHE

    HCHO_TILE_CACHE = None
    HCHO_HOTSPOT_CACHE = None

    return jsonify({
        "status": "cache cleared"
    })


if __name__ == "__main__":
    app.run(debug=True)