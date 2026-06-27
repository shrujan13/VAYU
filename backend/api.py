from flask import Flask, jsonify
from flask_cors import CORS
import ee

app = Flask(__name__)
CORS(app)

ee.Initialize(project="vayu-500508")


@app.route("/")
def home():
    return {
        "status": "running",
        "project": "VAYU"
    }


@app.route("/get_hcho_tile")
def get_hcho_tile():

    india = ee.FeatureCollection("FAO/GAUL/2015/level0") \
        .filter(ee.Filter.eq("ADM0_NAME", "India"))

    image = ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_HCHO") \
        .filterDate("2025-06-01", "2025-06-20") \
        .select("tropospheric_HCHO_column_number_density") \
        .mean() \
        .clip(india)

    vis = {
        "min": 0.00005,
        "max": 0.0004,
        "palette": ["blue", "cyan", "green", "yellow", "orange", "red"]
    }

    map_id = image.getMapId(vis)

    return jsonify({
        "tile_url": map_id["tile_fetcher"].url_format
    })


if __name__ == "__main__":
    app.run(debug=True)