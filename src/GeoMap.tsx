import { useMemo } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fond « Plan IGN » de la Géoplateforme (public, sans clé).
const PLAN_IGN =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2" +
  "&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const STYLE = { color: "#000091", weight: 2, fillOpacity: 0.2 };

// Affiche les zones d'un champ Carte. Les points sont dessinés en cercles,
// ce qui évite les icônes de marqueur Leaflet que Vite ne sait pas résoudre.
export function GeoMap({ areas }: { areas: any[] }) {
  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: areas.map((a) => ({
        type: "Feature" as const,
        geometry: a.geometry,
        properties: { description: a.description },
      })),
    }),
    [areas],
  );
  const bounds = useMemo(() => L.geoJSON(data).getBounds().pad(0.2), [data]);
  const isSinglePoint = areas.length === 1 && areas[0].geometry.type === "Point";

  return (
    <MapContainer
      {...(isSinglePoint ? { center: bounds.getCenter(), zoom: 15 } : { bounds })}
      style={{ height: "20rem", width: "100%", maxWidth: "40rem", margin: "8px 0" }}
    >
      <TileLayer url={PLAN_IGN} attribution="© IGN – Géoplateforme" maxZoom={19} />
      <GeoJSON
        data={data}
        style={STYLE}
        pointToLayer={(_, latlng) => L.circleMarker(latlng, { ...STYLE, radius: 8, fillOpacity: 0.6 })}
        onEachFeature={(f, layer) => f.properties.description && layer.bindTooltip(f.properties.description)}
      />
    </MapContainer>
  );
}
