from flask import Flask, jsonify, request
from flask_cors import CORS
import ee
import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
import threading

app = Flask(__name__)
CORS(app)

ee.Initialize(project="vayu-500508")

# -----------------------------
# HCHO SETTINGS
# -----------------------------

HCHO_DATASET_ID = "COPERNICUS/S5P/NRTI/L3_HCHO"
HCHO_BAND = "tropospheric_HCHO_column_number_density"

HCHO_ROLLING_DAYS = 14
HCHO_MAX_CLOUD_FRACTION = 0.5

HCHO_POINT_BUFFER_METERS = 20000
HCHO_POINT_SCALE = 25000

HCHO_HOTSPOT_THRESHOLD = 0.00025
HCHO_HOTSPOT_SCALE = 75000
HCHO_HOTSPOT_NUM_PIXELS = 20

# Cache variables
HCHO_TILE_CACHE = None
HCHO_IMAGE_CACHE = None
HCHO_VALUE_CACHE = {}

HCHO_HOTSPOT_CACHE = []
HOTSPOT_SCAN_STATUS = "idle"
HOTSPOT_SCAN_MESSAGE = "Hotspot scan has not started."
HOTSPOT_SCAN_STARTED_AT = None
HOTSPOT_SCAN_FINISHED_AT = None
HOTSPOT_SCAN_ERROR = None


# -----------------------------
# GENERAL HELPERS
# -----------------------------

def fetch_json_from_url(url):
    with urllib.request.urlopen(url, timeout=20) as response:
        data = response.read().decode("utf-8")
        return json.loads(data)


def get_india_boundary():
    return ee.FeatureCollection("FAO/GAUL/2015/level0") \
        .filter(ee.Filter.eq("ADM0_NAME", "India"))


def get_hcho_date_window():
    end_date = datetime.utcnow().date()
    start_date = end_date - timedelta(days=HCHO_ROLLING_DAYS)
    filter_end_date = end_date + timedelta(days=1)

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "filter_end_date": filter_end_date.isoformat(),
        "rolling_days": HCHO_ROLLING_DAYS
    }


def mask_hcho_clouds(image):
    hcho = image.select(HCHO_BAND)
    cloud_fraction = image.select("cloud_fraction")

    return hcho.updateMask(cloud_fraction.lte(HCHO_MAX_CLOUD_FRACTION)) \
        .copyProperties(image, image.propertyNames())


def get_hcho_collection(region=None):
    india = get_india_boundary()
    date_window = get_hcho_date_window()

    if region is None:
        bounds = india
    else:
        bounds = region

    collection = ee.ImageCollection(HCHO_DATASET_ID) \
        .filterDate(date_window["start_date"], date_window["filter_end_date"]) \
        .filterBounds(bounds) \
        .map(mask_hcho_clouds)

    return collection


def get_hcho_image(region=None):
    global HCHO_IMAGE_CACHE

    if region is None and HCHO_IMAGE_CACHE is not None:
        return HCHO_IMAGE_CACHE

    collection = get_hcho_collection(region)

    # Latest valid pixel composite from the 14-day rolling window
    image = collection.sort("system:time_start").mosaic()

    if region is None:
        india = get_india_boundary()
        image = image.clip(india)
        HCHO_IMAGE_CACHE = image

    return image


def get_hcho_metadata(source_type):
    date_window = get_hcho_date_window()

    return {
        "hcho_source": "Sentinel-5P NRTI HCHO",
        "dataset_id": HCHO_DATASET_ID,
        "data_type": "near-real-time latest valid pixel composite",
        "rolling_days": date_window["rolling_days"],
        "start_date": date_window["start_date"],
        "end_date": date_window["end_date"],
        "cloud_fraction_filter": f"<= {HCHO_MAX_CLOUD_FRACTION}",
        "source": source_type
    }


def classify_hcho(value):
    if value is None:
        return "No data"

    if value < 0.0001:
        return "Low"
    elif value < 0.0002:
        return "Moderate"
    elif value < 0.0003:
        return "High"

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

    return "Hazardous"


def get_aqi_advisory(category):
    advisories = {
        "Good": "Air quality is good. Normal outdoor activity is okay.",
        "Moderate": "Air quality is acceptable. Sensitive people should monitor symptoms.",
        "Unhealthy for Sensitive Groups": "Sensitive people should reduce prolonged outdoor activity.",
        "Unhealthy": "Everyone should reduce prolonged outdoor activity.",
        "Very Unhealthy": "Avoid long outdoor exposure. Limit physical activity outside.",
        "Hazardous": "Avoid outdoor activity. Pollution level is very serious."
    }

    return advisories.get(category, "AQI data unavailable for this location.")


def get_value_from_hourly(hourly_data, variable_name, index):
    values = hourly_data.get(variable_name)

    if values is None or index < 0 or index >= len(values):
        return None

    return values[index]


def find_current_hour_index(times):
    if not times:
        return 0

    current_hour = datetime.now().strftime("%Y-%m-%dT%H:00")

    if current_hour in times:
        return times.index(current_hour)

    return 0


def get_aqi_trend(first_value, last_value):
    if first_value is None or last_value is None:
        return "No data"

    difference = last_value - first_value

    if difference > 10:
        return "Increasing"
    elif difference < -10:
        return "Improving"

    return "Stable"


def get_hcho_cache_key(lat, lon):
    rounded_lat = round(lat, 2)
    rounded_lon = round(lon, 2)

    return f"{rounded_lat},{rounded_lon}"


# -----------------------------
# BACKGROUND HOTSPOT SCAN
# -----------------------------

def run_hcho_hotspot_scan():
    global HCHO_HOTSPOT_CACHE
    global HOTSPOT_SCAN_STATUS
    global HOTSPOT_SCAN_MESSAGE
    global HOTSPOT_SCAN_STARTED_AT
    global HOTSPOT_SCAN_FINISHED_AT
    global HOTSPOT_SCAN_ERROR

    try:
        HOTSPOT_SCAN_STATUS = "scanning"
        HOTSPOT_SCAN_MESSAGE = "Scanning latest Sentinel-5P HCHO satellite data for hotspots. This may take 1-3 minutes on first load."
        HOTSPOT_SCAN_STARTED_AT = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        HOTSPOT_SCAN_FINISHED_AT = None
        HOTSPOT_SCAN_ERROR = None

        india = get_india_boundary().geometry()
        image = get_hcho_image()

        hotspot_mask = image.gt(HCHO_HOTSPOT_THRESHOLD)

        hotspot_points = image.updateMask(hotspot_mask).sample(
            region=india,
            scale=HCHO_HOTSPOT_SCALE,
            numPixels=HCHO_HOTSPOT_NUM_PIXELS,
            seed=42,
            geometries=True,
            tileScale=4
        ).getInfo()

        hotspots = []

        for feature in hotspot_points.get("features", []):
            coords = feature["geometry"]["coordinates"]
            hcho_value = feature["properties"].get(HCHO_BAND)

            hotspots.append({
                "lat": coords[1],
                "lon": coords[0],
                "hcho": hcho_value,
                "risk": classify_hcho(hcho_value)
            })

        HCHO_HOTSPOT_CACHE = hotspots
        HOTSPOT_SCAN_STATUS = "ready"
        HOTSPOT_SCAN_MESSAGE = "Hotspot scan completed using latest available Sentinel-5P HCHO data."
        HOTSPOT_SCAN_FINISHED_AT = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    except Exception as e:
        HOTSPOT_SCAN_STATUS = "error"
        HOTSPOT_SCAN_ERROR = str(e)
        HOTSPOT_SCAN_MESSAGE = "Hotspot scan failed. HCHO layer and point reports still work."
        HOTSPOT_SCAN_FINISHED_AT = datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def start_hotspot_scan_if_needed():
    global HOTSPOT_SCAN_STATUS

    if HOTSPOT_SCAN_STATUS == "idle":
        scan_thread = threading.Thread(target=run_hcho_hotspot_scan)
        scan_thread.daemon = True
        scan_thread.start()


# -----------------------------
# ROUTES
# -----------------------------

@app.route("/")
def home():
    return jsonify({
        "status": "running",
        "project": "VAYU",
        "message": "Backend is active",
        "hcho_source": "Sentinel-5P NRTI latest valid pixel composite",
        "hcho_window_days": HCHO_ROLLING_DAYS,
        "aqi_source": "Open-Meteo Air Quality API",
        "weather_source": "Open-Meteo Forecast API"
    })


@app.route("/get_hcho_metadata")
def get_hcho_metadata_route():
    return jsonify(get_hcho_metadata("metadata"))


@app.route("/get_hcho_tile")
def get_hcho_tile():
    global HCHO_TILE_CACHE

    try:
        if HCHO_TILE_CACHE is not None:
            metadata = get_hcho_metadata("cache")

            return jsonify({
                **metadata,
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

        metadata = get_hcho_metadata("earth_engine")

        return jsonify({
            **metadata,
            "tile_url": tile_url
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "route": "/get_hcho_tile"
        }), 500


@app.route("/get_hcho_value")
def get_hcho_value():
    global HCHO_VALUE_CACHE

    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))

        cache_key = get_hcho_cache_key(lat, lon)

        if cache_key in HCHO_VALUE_CACHE:
            cached_data = HCHO_VALUE_CACHE[cache_key]
            metadata = get_hcho_metadata("cache")

            return jsonify({
                **metadata,
                **cached_data
            })

        point = ee.Geometry.Point([lon, lat])
        area = point.buffer(HCHO_POINT_BUFFER_METERS)

        image = get_hcho_image(region=area).rename("hcho")

        result = image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=area,
            scale=HCHO_POINT_SCALE,
            maxPixels=1e13,
            bestEffort=True,
            tileScale=2
        ).getInfo()

        value = result.get("hcho")
        risk = classify_hcho(value)

        response_data = {
            "lat": lat,
            "lon": lon,
            "hcho": value,
            "risk": risk,
            "buffer_meters": HCHO_POINT_BUFFER_METERS,
            "scale": HCHO_POINT_SCALE
        }

        HCHO_VALUE_CACHE[cache_key] = response_data

        metadata = get_hcho_metadata("earth_engine")

        return jsonify({
            **metadata,
            **response_data
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "route": "/get_hcho_value"
        }), 500


@app.route("/start_hcho_hotspot_scan")
def start_hcho_hotspot_scan():
    start_hotspot_scan_if_needed()

    metadata = get_hcho_metadata("hotspot_scan")

    return jsonify({
        **metadata,
        "status": HOTSPOT_SCAN_STATUS,
        "message": HOTSPOT_SCAN_MESSAGE,
        "started_at": HOTSPOT_SCAN_STARTED_AT,
        "finished_at": HOTSPOT_SCAN_FINISHED_AT,
        "count": len(HCHO_HOTSPOT_CACHE),
        "threshold": HCHO_HOTSPOT_THRESHOLD
    })


@app.route("/get_hcho_hotspots")
def get_hcho_hotspots():
    try:
        start_hotspot_scan_if_needed()

        metadata = get_hcho_metadata("hotspot_scan")

        return jsonify({
            **metadata,
            "status": HOTSPOT_SCAN_STATUS,
            "message": HOTSPOT_SCAN_MESSAGE,
            "started_at": HOTSPOT_SCAN_STARTED_AT,
            "finished_at": HOTSPOT_SCAN_FINISHED_AT,
            "error": HOTSPOT_SCAN_ERROR,
            "count": len(HCHO_HOTSPOT_CACHE),
            "threshold": HCHO_HOTSPOT_THRESHOLD,
            "sample_scale": HCHO_HOTSPOT_SCALE,
            "hotspots": HCHO_HOTSPOT_CACHE
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "route": "/get_hcho_hotspots"
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

        url = "https://air-quality-api.open-meteo.com/v1/air-quality?" + urllib.parse.urlencode(params)
        api_data = fetch_json_from_url(url)

        hourly = api_data.get("hourly", {})
        times = hourly.get("time", [])
        index = find_current_hour_index(times)

        aqi = get_value_from_hourly(hourly, "us_aqi", index)
        category = classify_aqi(aqi)

        return jsonify({
            "source": "Open-Meteo Air Quality API",
            "data_type": "current-hour model estimate",
            "lat": lat,
            "lon": lon,
            "aqi": aqi,
            "category": category,
            "advisory": get_aqi_advisory(category),
            "time": times[index] if times and index < len(times) else None,
            "pollutants": {
                "pm10": get_value_from_hourly(hourly, "pm10", index),
                "pm2_5": get_value_from_hourly(hourly, "pm2_5", index),
                "carbon_monoxide": get_value_from_hourly(hourly, "carbon_monoxide", index),
                "nitrogen_dioxide": get_value_from_hourly(hourly, "nitrogen_dioxide", index),
                "sulphur_dioxide": get_value_from_hourly(hourly, "sulphur_dioxide", index),
                "ozone": get_value_from_hourly(hourly, "ozone", index)
            }
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "route": "/get_aqi_value"
        }), 500


@app.route("/get_aqi_forecast")
def get_aqi_forecast():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))

        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "us_aqi",
            "timezone": "auto"
        }

        url = "https://air-quality-api.open-meteo.com/v1/air-quality?" + urllib.parse.urlencode(params)
        api_data = fetch_json_from_url(url)

        hourly = api_data.get("hourly", {})
        times = hourly.get("time", [])
        aqi_values = hourly.get("us_aqi", [])

        start_index = find_current_hour_index(times)
        end_index = min(start_index + 24, len(times))

        forecast_points = []

        for i in range(start_index, end_index):
            forecast_points.append({
                "time": times[i],
                "aqi": aqi_values[i]
            })

        valid_values = [
            point["aqi"]
            for point in forecast_points
            if point["aqi"] is not None
        ]

        if len(valid_values) == 0:
            return jsonify({
                "lat": lat,
                "lon": lon,
                "error": "No AQI forecast data available"
            }), 404

        average_aqi = round(sum(valid_values) / len(valid_values), 2)
        max_aqi = max(valid_values)
        min_aqi = min(valid_values)

        first_aqi = valid_values[0]
        last_aqi = valid_values[-1]

        trend = get_aqi_trend(first_aqi, last_aqi)
        forecast_category = classify_aqi(max_aqi)

        return jsonify({
            "source": "Open-Meteo Air Quality API",
            "data_type": "24-hour air quality forecast",
            "lat": lat,
            "lon": lon,
            "hours": len(forecast_points),
            "average_aqi": average_aqi,
            "max_aqi": max_aqi,
            "min_aqi": min_aqi,
            "trend": trend,
            "forecast_category": forecast_category,
            "advisory": get_aqi_advisory(forecast_category),
            "forecast": forecast_points
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "route": "/get_aqi_forecast"
        }), 500


@app.route("/get_weather_value")
def get_weather_value():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))

        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m",
            "timezone": "auto"
        }

        url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)
        weather_data = fetch_json_from_url(url)

        hourly = weather_data.get("hourly", {})
        times = hourly.get("time", [])
        index = find_current_hour_index(times)

        temperature = get_value_from_hourly(hourly, "temperature_2m", index)
        humidity = get_value_from_hourly(hourly, "relative_humidity_2m", index)
        precipitation = get_value_from_hourly(hourly, "precipitation", index)
        cloud_cover = get_value_from_hourly(hourly, "cloud_cover", index)
        wind_speed = get_value_from_hourly(hourly, "wind_speed_10m", index)

        return jsonify({
            "source": "Open-Meteo Forecast API",
            "data_type": "current-hour weather model estimate",
            "lat": lat,
            "lon": lon,
            "time": times[index] if times and index < len(times) else None,
            "weather": {
                "temperature_2m": temperature,
                "relative_humidity_2m": humidity,
                "precipitation": precipitation,
                "cloud_cover": cloud_cover,
                "wind_speed_10m": wind_speed
            }
        })

    except Exception as e:
        return jsonify({
            "error": str(e),
            "route": "/get_weather_value"
        }), 500


@app.route("/clear_cache")
def clear_cache():
    global HCHO_TILE_CACHE
    global HCHO_IMAGE_CACHE
    global HCHO_VALUE_CACHE
    global HCHO_HOTSPOT_CACHE
    global HOTSPOT_SCAN_STATUS
    global HOTSPOT_SCAN_MESSAGE
    global HOTSPOT_SCAN_STARTED_AT
    global HOTSPOT_SCAN_FINISHED_AT
    global HOTSPOT_SCAN_ERROR

    HCHO_TILE_CACHE = None
    HCHO_IMAGE_CACHE = None
    HCHO_VALUE_CACHE = {}

    HCHO_HOTSPOT_CACHE = []
    HOTSPOT_SCAN_STATUS = "idle"
    HOTSPOT_SCAN_MESSAGE = "Hotspot scan has not started."
    HOTSPOT_SCAN_STARTED_AT = None
    HOTSPOT_SCAN_FINISHED_AT = None
    HOTSPOT_SCAN_ERROR = None

    return jsonify({
        "status": "cache cleared",
        "message": "HCHO tile, image, point value, and hotspot cache cleared"
    })


if __name__ == "__main__":
    app.run(debug=True)