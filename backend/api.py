from flask import Flask, jsonify, request
from flask_cors import CORS
import ee

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