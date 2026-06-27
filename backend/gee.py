import ee

ee.Initialize(project="vayu-500508")

print("✅ Connected to Google Earth Engine")

# -------------------------------
# INDIA BOUNDARY
# -------------------------------

india = (
    ee.FeatureCollection("FAO/GAUL/2015/level0")
    .filter(ee.Filter.eq("ADM0_NAME", "India"))
)

# -------------------------------
# SENTINEL-5P HCHO
# -------------------------------

hcho = (
    ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_HCHO")
    .filterDate("2025-06-01", "2025-06-20")
    .select("tropospheric_HCHO_column_number_density")
    .mean()
    .clip(india)
)

print("✅ HCHO Dataset Loaded")

# -------------------------------
# VISUALIZATION PARAMETERS
# -------------------------------

vis_params = {
    "min": 0.00005,
    "max": 0.0004,
    "palette": [
        "blue",
        "cyan",
        "green",
        "yellow",
        "orange",
        "red"
    ]
}

# -------------------------------
# MAP ID
# -------------------------------


map_id = hcho.getMapId(vis_params)

print("\nMap Information:\n")
print(map_id)