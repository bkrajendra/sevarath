import osmnx as ox
import geopandas as gpd
import pandas as pd
import numpy as np
from shapely.geometry import Point
from sklearn.neighbors import BallTree

LAT = 24.531589
LON = 72.7934584
RADIUS = 500

# ---------------------------------------------------------
# 1. Download walking/driving road network around Shantivan
# ---------------------------------------------------------

G = ox.graph.graph_from_point(
    (LAT, LON),
    dist=RADIUS,
    network_type="drive",
    simplify=True
)

nodes, edges = ox.graph_to_gdfs(G)

# ---------------------------------------------------------
# 2. Create candidate stops from road intersections
# ---------------------------------------------------------

# Nodes having 3+ connected road segments are good
# candidates for pickup/drop points.
degree = dict(G.degree())

intersection_nodes = [
    node for node, d in degree.items()
    if d >= 3
]

intersection_rows = []

for node in intersection_nodes:
    data = G.nodes[node]

    intersection_rows.append({
        "stop_type": "intersection",
        "name": None,
        "latitude": data["y"],
        "longitude": data["x"],
        "osm_id": node,
        "source": "OpenStreetMap"
    })

intersections = pd.DataFrame(intersection_rows)

# ---------------------------------------------------------
# 3. Download mapped OSM places/features
# ---------------------------------------------------------

tags = {
    "name": True,
    "amenity": True,
    "building": True,
    "tourism": True,
    "leisure": True,
    "shop": True,
    "office": True,
    "entrance": True,
    "parking": True,
    "highway": True
}

features = ox.features.features_from_point(
    (LAT, LON),
    tags=tags,
    dist=RADIUS
)

# ---------------------------------------------------------
# 4. Convert OSM features to representative coordinates
# ---------------------------------------------------------

feature_rows = []

for idx, row in features.iterrows():

    geometry = row.geometry

    if geometry is None:
        continue

    # Point -> itself
    # Polygon/LineString -> representative point
    point = geometry if geometry.geom_type == "Point" else geometry.representative_point()

    name = row.get("name")

    if pd.isna(name):
        name = None

    # Determine useful category
    category = None

    for field in [
        "amenity",
        "building",
        "tourism",
        "leisure",
        "shop",
        "office",
        "entrance",
        "parking",
        "highway"
    ]:
        value = row.get(field)

        if pd.notna(value):
            category = f"{field}:{value}"
            break

    feature_rows.append({
        "stop_type": "osm_feature",
        "name": name,
        "category": category,
        "latitude": point.y,
        "longitude": point.x,
        "osm_id": str(idx),
        "source": "OpenStreetMap"
    })

features_df = pd.DataFrame(feature_rows)

# ---------------------------------------------------------
# 5. Combine
# ---------------------------------------------------------

intersections["category"] = "road_intersection"

stops = pd.concat(
    [intersections, features_df],
    ignore_index=True
)

# ---------------------------------------------------------
# 6. Calculate distance from Diamond Hall
# ---------------------------------------------------------

EARTH_RADIUS = 6371000

lat1 = np.radians(LAT)
lon1 = np.radians(LON)

lat2 = np.radians(stops["latitude"])
lon2 = np.radians(stops["longitude"])

dlat = lat2 - lat1
dlon = lon2 - lon1

a = (
    np.sin(dlat / 2) ** 2
    + np.cos(lat1)
    * np.cos(lat2)
    * np.sin(dlon / 2) ** 2
)

stops["distance_m"] = (
    2 * EARTH_RADIUS * np.arcsin(np.sqrt(a))
)

# ---------------------------------------------------------
# 7. Remove duplicate locations
# ---------------------------------------------------------

coords = np.radians(
    stops[["latitude", "longitude"]].values
)

tree = BallTree(coords, metric="haversine")

# Approximately 25 metres duplicate radius
DUPLICATE_RADIUS = 25 / EARTH_RADIUS

groups = tree.query_radius(coords, r=DUPLICATE_RADIUS)

keep = []
removed = set()

for i, neighbours in enumerate(groups):

    if i in removed:
        continue

    keep.append(i)

    for n in neighbours:
        if n != i:
            removed.add(n)

stops = stops.iloc[keep].copy()

# ---------------------------------------------------------
# 8. Sort
# ---------------------------------------------------------

stops = stops.sort_values(
    ["distance_m", "stop_type", "name"],
    na_position="last"
)

# ---------------------------------------------------------
# 9. Assign application stop IDs
# ---------------------------------------------------------

stops.insert(
    0,
    "stop_id",
    [
        f"SVR-{i:03d}"
        for i in range(1, len(stops) + 1)
    ]
)

# ---------------------------------------------------------
# 10. Final columns
# ---------------------------------------------------------

stops = stops[
    [
        "stop_id",
        "stop_type",
        "name",
        "category",
        "latitude",
        "longitude",
        "distance_m",
        "osm_id",
        "source"
    ]
]

stops.to_csv(
    "sevarath_candidate_stops_500m.csv",
    index=False
)

print()
print(f"Generated {len(stops)} candidate stops")
print()
print(stops.to_string(index=False))
print()
print("CSV written to:")
print("sevarath_candidate_stops_500m.csv")