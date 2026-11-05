import { useEffect, useState, useRef } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import mapImage from "../assets/map.jpg";
import {
  locations,
  IMS_FLAG_MARKERS,
  IMS_TURN_MARKERS,
} from "../utils/locations";

const locationOptions = ["B-Lot", "Indianapolis Motor Speedway"] as const;
type TrackLocation = (typeof locationOptions)[number];

function isValidCoordinate(value: number | null, min: number, max: number) {
  return (
    value !== null && Number.isFinite(value) && value >= min && value <= max
  );
}

function isValidLatLng(latitude: number | null, longitude: number | null) {
  return (
    isValidCoordinate(latitude, -90, 90) &&
    isValidCoordinate(longitude, -180, 180)
  );
}

const MapComponent = ({
  latitude,
  longitude,
  className = "",
}: {
  latitude: number | null;
  longitude: number | null;
  interactive?: boolean;
  className?: string;
}) => {
  const [selectedLocation, setSelectedLocation] = useState<TrackLocation>(
    "Indianapolis Motor Speedway",
  );
  const mapCenter = locations[selectedLocation];
  const hasLivePosition = isValidLatLng(latitude, longitude);
  const position = {
    lat: hasLivePosition ? (latitude as number) : mapCenter.lat,
    lng: hasLivePosition ? (longitude as number) : mapCenter.lng,
  };
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID";

  const [heading, setHeading] = useState(180);
  const [isDragging, setIsDragging] = useState(false);
  const lastX = useRef<number | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);

  const [zoom, setZoom] = useState(16);
  const minZoom = 14;
  const maxZoom = 20;
  const showImsMarkers = selectedLocation === "Indianapolis Motor Speedway";

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    setZoom((prev) => {
      let delta = e.deltaY < 0 ? 0.1 : -0.1;
      let newZoom = prev + delta;
      if (newZoom < minZoom) newZoom = minZoom;
      if (newZoom > maxZoom) newZoom = maxZoom;
      return newZoom;
    });
  };

  useEffect(() => {
    const container = document.getElementById("map-container");
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((prev) => {
        let delta = e.deltaY < 0 ? 0.1 : -0.1;
        let newZoom = prev + delta;
        if (newZoom < minZoom) newZoom = minZoom;
        if (newZoom > maxZoom) newZoom = maxZoom;
        return newZoom;
      });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    if (hasLivePosition) {
      setIsPulsing(true);

      const timeout = setTimeout(() => {
        setIsPulsing(false);
      }, 800); // duration of pulse

      return () => clearTimeout(timeout);
    }
  }, [hasLivePosition, latitude, longitude]);

  if (!apiKey) {
    return (
      <div
        className={`relative h-full w-full overflow-hidden rounded-[1.1rem] ${className}`}
      >
        <img
          src={mapImage}
          alt="Track map fallback"
          className="h-full w-full object-cover opacity-80"
        />
        <div
          className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1 text-sm text-white"
          data-testid="map-position"
          data-live={hasLivePosition ? "true" : "false"}
        >
          {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div
        id="map-container"
        className={`relative h-full w-full overflow-hidden rounded-[1.1rem] cursor-grab hover:cursor-grabbing ${className}`}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDragging(true);
          lastX.current = e.clientX;
          if (e.button === 2) {
            e.preventDefault();
            setSelectedLocation((prev) =>
              prev === "B-Lot" ? "Indianapolis Motor Speedway" : "B-Lot",
            );
          }
        }}
        onMouseUp={() => {
          setIsDragging(false);
          lastX.current = null;
        }}
        onMouseLeave={() => setIsDragging(false)}
        onMouseMove={(e) => {
          if (!isDragging || lastX.current === null) return;

          const deltaX = e.clientX - lastX.current;
          lastX.current = e.clientX;

          setHeading((h) => (h + deltaX * 0.5) % 360); // sensitivity tweak
        }}
        onWheel={handleWheel}
      >
        <Map
          center={mapCenter}
          defaultZoom={16}
          zoom={zoom}
          gestureHandling="none"
          disableDefaultUI
          keyboardShortcuts={false}
          streetViewControl={false}
          mapTypeControl={false}
          fullscreenControl={false}
          defaultHeading={180}
          heading={heading}
          tilt={25}
          mapId={mapId}
          options={{
            clickableIcons: false,
          }}
        >
          {showImsMarkers
            ? IMS_TURN_MARKERS.map((marker) => (
                <AdvancedMarker
                  key={`turn-${marker.id}`}
                  position={{ lat: marker.lat, lng: marker.lng }}
                  anchorLeft="-50%"
                  anchorTop="-50%"
                >
                  <TurnMarkerLabel turn={marker.id} zoom={zoom} />
                </AdvancedMarker>
              ))
            : null}
          {showImsMarkers
            ? IMS_FLAG_MARKERS.map((marker) => (
                <AdvancedMarker
                  key={marker.id}
                  position={{ lat: marker.lat, lng: marker.lng }}
                  anchorLeft="-50%"
                  anchorTop="-85%"
                >
                  <FlagMarker
                    label={marker.label}
                    variant={marker.variant}
                    zoom={zoom}
                  />
                </AdvancedMarker>
              ))
            : null}
          <AdvancedMarker
            position={position}
            anchorLeft="-50%"
            anchorTop="-50%"
          >
            <div
              className="relative"
              data-testid="map-marker"
              data-lat={position.lat}
              data-lng={position.lng}
              data-live={hasLivePosition ? "true" : "false"}
            >
              {/* glow */}
              <div
                className={`
                  absolute h-6 w-6 rounded-full
                  bg-blue-400 blur-md transition-all duration-300
                  ${isPulsing ? "opacity-90 scale-105" : "opacity-40 scale-100"}
                `}
              />
              {/* core dot */}
              <div
                className={`
                  ${zoom >= 16 ? "h-3 w-3" : "h-2 w-2"} rounded-full
                  bg-blue-500 border-2 border-white
                  transition-transform duration-300
                  ${isPulsing ? "scale-105" : "scale-100"}
                `}
              />
              {/* ripple effect */}
              {isPulsing && (
                <div className="absolute h-7 w-7 top-1/2 left-1/2 translate-x-[-50%] translate-y-[-50%] rounded-full bg-blue-400 opacity-50 animate-ping" />
              )}
            </div>
          </AdvancedMarker>
        </Map>
      </div>
    </APIProvider>
  );
};

function TurnMarkerLabel({ turn, zoom }: { turn: number; zoom: number }) {
  const isClose = zoom >= 14;

  return (
    <div
      className={`flex items-center justify-center rounded-full border border-white/80 bg-slate-950/88 font-semibold text-white shadow-[0_4px_14px_rgba(0,0,0,0.32)] backdrop-blur-sm ${
        isClose
          ? "h-3 min-w-3 px-px text-[8px]"
          : "h-3 min-w-3 px-px text-[8px]"
      }`}
      aria-label={`Turn ${turn}`}
      title={`Turn ${turn}`}
    >
      {turn}
    </div>
  );
}

function FlagMarker({
  label,
  variant,
  zoom,
}: {
  label: string;
  variant: "green" | "checkered";
  zoom: number;
}) {
  const isClose = zoom >= 14;
  const badgeClass = isClose ? "h-2.5 w-2.5" : "h-2.5 w-2.5";

  return (
    <div
      className="flex flex-col items-center"
      aria-label={label}
      title={label}
    >
      <div className="relative">
        <div
          className={`relative ml-1 rounded-[3px] border border-white/75 shadow-[0_4px_12px_rgba(0,0,0,0.28)] ${badgeClass} ${
            variant === "green"
              ? "bg-emerald-500"
              : "bg-[conic-gradient(from_90deg,#ffffff_0_25%,#111827_25%_50%,#ffffff_50%_75%,#111827_75%_100%)]"
          }`}
        />
      </div>
    </div>
  );
}

export default MapComponent;
